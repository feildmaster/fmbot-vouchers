const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');

const createFetchPlans = require('../src/remotePlans');

const LIVE = {
  month: {
    amount: 100, currency: 'FMC', months: 1, price: 100,
  },
  slot: {
    amount: 25, currency: 'FMC', slots: 1, price: 25,
  },
};

const fakeFetch = (payload, status = 200) => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return { status, json: async () => payload };
  };
  return { fetch, calls };
};

const load = async (payload, status) => {
  const { fetch } = fakeFetch(payload, status);
  return createFetchPlans({ url: 'https://plans.test', fetch })();
};

test('each live plan becomes a replay plan whose data is the plan name and its other fields', async () => {
  const { fetch, calls } = fakeFetch(LIVE);

  const result = await createFetchPlans({ url: 'https://plans.test/plans', fetch })();

  assert.equal(calls[0].url, 'https://plans.test/plans');
  assert.deepEqual(result, {
    plans: {
      month: {
        price: 100, type: 'replay', data: { plan: 'month', months: 1 }, label: 'month',
      },
      slot: {
        price: 25, type: 'replay', data: { plan: 'slot', slots: 1 }, label: 'slot',
      },
    },
    rejected: [],
  });
});

test('the price is what gets charged during a sale, and neither price is part of the voucher', async () => {
  const { plans } = await load({
    month: {
      amount: 100, price: 80, currency: 'FMC', months: 1,
    },
  });

  assert.equal(plans.month.price, 80);
  assert.deepEqual(plans.month.data, { plan: 'month', months: 1 });
});

test('a sale stays out of the voucher, and its end and the regular price are kept for later', async () => {
  const { plans } = await load({
    month: {
      amount: 100, price: 80, currency: 'FMC', months: 1, sale: { amount: 80, until: 9000 },
    },
    slot: {
      amount: 25, price: 25, currency: 'FMC', slots: 1,
    },
  });

  assert.deepEqual(plans.month, {
    price: 80, regular: 100, until: 9000, type: 'replay', data: { plan: 'month', months: 1 }, label: 'month',
  });
  assert.equal('until' in plans.slot, false);
});

test('a sale that makes no sense is ignored, and the price the endpoint gives is still used', async () => {
  const month = { amount: 100, price: 80, months: 1 };
  const { plans } = await load({
    a: { ...month, sale: { amount: 100, until: 9000 } },
    b: { ...month, sale: { amount: 80 } },
    c: { ...month, sale: { amount: 80, until: 'soon' } },
    d: { ...month, sale: 'half price' },
    e: { ...month, sale: { amount: 0.5, until: 9000 } },
  });

  Object.values(plans).forEach((plan) => {
    assert.equal(plan.price, 80);
    assert.equal('until' in plan, false);
    assert.equal('sale' in plan.data, false);
  });
  assert.equal(Object.keys(plans).length, 5);
});

test('a price that cannot be charged rejects the plan even when the regular amount is fine', async () => {
  const { plans, rejected } = await load({
    free: { amount: 100, price: 0, months: 1 },
    half: { amount: 100, price: 0.5, months: 1 },
    text: { amount: 100, price: 'cheap', months: 1 },
  });

  assert.deepEqual(plans, {});
  assert.deepEqual(rejected, ['free', 'half', 'text']);
});

test('an answer that only has an amount is charged that amount', async () => {
  const { plans } = await load({ month: { amount: 100, months: 1 } });

  assert.equal(plans.month.price, 100);
});

test('a plan can name itself and its type, and neither ends up in the data', async () => {
  const { plans } = await load({
    month: {
      amount: 100, label: 'One month', type: 'sub', months: 1,
    },
  });

  assert.deepEqual(plans.month, {
    price: 100, type: 'sub', data: { plan: 'month', months: 1 }, label: 'One month',
  });
});

test('only the plans that are allowed are offered, and the rest are skipped without a report', async () => {
  const { fetch } = fakeFetch(LIVE);

  const result = await createFetchPlans({ url: 'https://plans.test', only: [' Month '], fetch })();

  assert.deepEqual(Object.keys(result.plans), ['month']);
  assert.deepEqual(result.rejected, []);
});

test('an empty list of allowed plans allows them all', async () => {
  const { fetch } = fakeFetch(LIVE);

  const result = await createFetchPlans({ url: 'https://plans.test', only: [], fetch })();

  assert.deepEqual(Object.keys(result.plans), ['month', 'slot']);
});

test('a plan in another currency is ignored and reported, since only FMC can be charged', async () => {
  const { plans, rejected } = await load({
    month: { amount: 100, currency: 'GEM', months: 1 },
    slot: { amount: 25, currency: 'FMC', slots: 1 },
  });

  assert.deepEqual(Object.keys(plans), ['slot']);
  assert.deepEqual(rejected, ['month']);
});

test('a plan with a bad price or name is ignored and reported, the rest still load', async () => {
  const { plans, rejected } = await load({
    free: { amount: 0 },
    'bad name': { amount: 5 },
    junk: 'x',
    slot: { amount: 25, slots: 1 },
  });

  assert.deepEqual(Object.keys(plans), ['slot']);
  assert.deepEqual(rejected, ['free', 'bad name', 'junk']);
});

test('a plan cannot make a credit voucher', async () => {
  const { plans, rejected } = await load({ cash: { amount: 5, type: 'credit' } });

  assert.deepEqual(plans, {});
  assert.deepEqual(rejected, ['cash']);
});

test('an empty answer means there is nothing for sale', async () => {
  assert.deepEqual(await load({}), { plans: {}, rejected: [] });
});

test('an error status or an answer that is not an object of plans is thrown, so the old plans stay', async () => {
  await assert.rejects(load(LIVE, 500), /answered 500/);
  await assert.rejects(load(LIVE, 404), /answered 404/);
  await assert.rejects(load([]), /object of plans/);
  await assert.rejects(load('nope'), /object of plans/);
  await assert.rejects(load(null), /object of plans/);
});

test('it gives up when the address never answers', async () => {
  const server = await new Promise((resolve) => {
    const listener = http.createServer(() => {});
    listener.listen(0, '127.0.0.1', () => resolve(listener));
  });

  try {
    const started = Date.now();
    await assert.rejects(createFetchPlans({
      url: `http://127.0.0.1:${server.address().port}`,
      timeout: 150,
    })());
    assert.ok(Date.now() - started < 2000);
  } finally {
    server.closeAllConnections();
    await new Promise(done => server.close(done));
  }
});

test('it refuses to start without an address', () => {
  assert.throws(() => createFetchPlans({}), /address is required/);
});

const assert = require('node:assert/strict');
const { test } = require('node:test');

const buildMenu = require('../src/menu');

const LIVE = {
  month: {
    price: 100, type: 'replay', data: { plan: 'month', months: 1 }, label: 'month',
  },
  slot: {
    price: 25, type: 'replay', data: { plan: 'slot', slots: 1 }, label: 'slot',
  },
};

test('with no pointers every live plan is offered under its own name', () => {
  assert.deepEqual(buildMenu(LIVE, {}), { plans: LIVE, missing: [] });
});

test('a pointer offers the live plan under its own name and label', () => {
  const { plans, missing } = buildMenu(LIVE, {
    'replay-month': { plan: 'month', label: 'Replay Pro, 1 month' },
  });

  assert.deepEqual(Object.keys(plans), ['replay-month']);
  assert.deepEqual(plans['replay-month'], { ...LIVE.month, label: 'Replay Pro, 1 month' });
  assert.deepEqual(missing, []);
});

test('the price, sale and data are the live ones, so the voucher is what the plans address says', () => {
  const live = {
    month: {
      price: 80, regular: 100, until: 9000, type: 'replay', data: { plan: 'month', months: 1 }, label: 'month',
    },
  };

  const { plans } = buildMenu(live, { pro: { plan: 'month', label: 'Pro' } });

  assert.equal(plans.pro.price, 80);
  assert.equal(plans.pro.regular, 100);
  assert.equal(plans.pro.until, 9000);
  assert.deepEqual(plans.pro.data, { plan: 'month', months: 1 });
});

test('a pointer without a label takes the live plan\'s label', () => {
  const { plans } = buildMenu(LIVE, { pro: { plan: 'month', label: '' } });

  assert.equal(plans.pro.label, 'month');
});

test('only the pointed-at plans are offered, and one that points nowhere is reported', () => {
  const { plans, missing } = buildMenu(LIVE, {
    pro: { plan: 'month', label: 'Pro' },
    gone: { plan: 'year', label: 'Year' },
  });

  assert.deepEqual(Object.keys(plans), ['pro']);
  assert.deepEqual(missing, ['gone']);
});

test('two names can point at the same live plan', () => {
  const { plans } = buildMenu(LIVE, {
    a: { plan: 'month', label: 'A' },
    b: { plan: 'month', label: 'B' },
  });

  assert.deepEqual(Object.keys(plans), ['a', 'b']);
});

const LOCAL = {
  badge: {
    price: 5, type: 'badge', data: { id: 'early' }, label: 'Early badge',
  },
};

test('plans of our own are offered next to every live plan', () => {
  const { plans, missing } = buildMenu(LIVE, {}, LOCAL);

  assert.deepEqual(Object.keys(plans), ['month', 'slot', 'badge']);
  assert.deepEqual(plans.badge, LOCAL.badge);
  assert.deepEqual(missing, []);
});

test('plans of our own are offered next to the pointed-at plans, which still limit the live ones', () => {
  const { plans } = buildMenu(LIVE, { pro: { plan: 'month', label: 'Pro' } }, LOCAL);

  assert.deepEqual(Object.keys(plans), ['pro', 'badge']);
});

test('a plan of our own replaces a live plan with the same name', () => {
  const own = {
    month: {
      price: 5, type: 'badge', data: {}, label: 'Mine',
    },
  };

  const { plans } = buildMenu(LIVE, {}, own);

  assert.deepEqual(plans.month, own.month);
  assert.deepEqual(Object.keys(plans), ['month', 'slot']);
});

test('before the live plans have loaded, only the plans of our own are offered', () => {
  const { plans, missing } = buildMenu(undefined, { pro: { plan: 'month', label: 'Pro' } }, LOCAL);

  assert.deepEqual(plans, LOCAL);
  assert.deepEqual(missing, []);
});

test('a pointer that points nowhere is still reported when there are plans of our own', () => {
  const { plans, missing } = buildMenu(LIVE, { gone: { plan: 'year', label: 'Year' } }, LOCAL);

  assert.deepEqual(Object.keys(plans), ['badge']);
  assert.deepEqual(missing, ['gone']);
});

test('the live plans and the plans of our own are not changed', () => {
  buildMenu(LIVE, {}, LOCAL);

  assert.deepEqual(Object.keys(LIVE), ['month', 'slot']);
  assert.deepEqual(Object.keys(LOCAL), ['badge']);
});

test('the live plans are not changed', () => {
  buildMenu(LIVE, { pro: { plan: 'month', label: 'Pro' } });

  assert.equal(LIVE.month.label, 'month');
});

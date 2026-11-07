const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');

const createService = require('../src/service');
const createStore = require('../src/store');
const createFakeFirestore = require('./helpers/fakeFirestore');

const PLANS = {
  monthly: {
    price: 100, type: 'replay', data: { plan: 'monthly', months: 1 }, label: 'Monthly',
  },
  yearly: {
    price: 1000, type: 'replay', data: { plan: 'yearly', months: 12 }, label: 'Yearly',
  },
  badge: {
    price: 5, type: 'badge', data: { id: 'early' }, label: 'Early badge',
  },
};
const ALAN = { discordId: '111', name: 'Alan' };

let calls;
let errors;
let fake;
let replies;
let service;
let store;

const build = (overrides = {}) => createService({
  store,
  reserve: async (input) => {
    calls.push(['reserve', input]);
    return replies.reserve(input);
  },
  charge: async (input) => {
    calls.push(['charge', input]);
    return replies.charge(input);
  },
  activate: async (input) => {
    calls.push(['activate', input]);
    return replies.activate(input);
  },
  plans: () => PLANS,
  linkURL: 'https://link.test',
  onError: error => errors.push(error),
  ...overrides,
});

beforeEach(() => {
  calls = [];
  errors = [];
  fake = createFakeFirestore();
  store = createStore({ db: fake.db, FieldValue: fake.FieldValue });
  replies = {
    reserve: async () => ({ code: 'AAAA-BBBB-CCCC' }),
    charge: async () => ({ id: 'tx1', status: 'completed' }),
    activate: async () => ({ code: 'AAAA-BBBB-CCCC' }),
  };
  service = build();
});

const purchases = () => [...fake.data.entries()].map(([path, value]) => ({ path, ...value }));

test('a purchase reserves, then charges, then activates, all under one request id', async () => {
  const reply = await service.run('voucher-buy', ALAN, { plan: 'monthly' });

  assert.deepEqual(calls.map(([name]) => name), ['reserve', 'charge', 'activate']);
  const ids = calls.map(([, input]) => input.requestId);
  assert.match(ids[0], /^[\w-]{8,100}$/);
  assert.deepEqual([...new Set(ids)], [ids[0]]);
  assert.deepEqual(calls[0][1].data, { plan: 'monthly', months: 1 });
  assert.equal(calls[0][1].type, 'replay');
  assert.equal(calls[1][1].uid, 'discord.com:::111');
  assert.equal(calls[1][1].amount, 100);
  assert.equal(reply.hidden, true);
  assert.match(reply.text, /AAAA-BBBB-CCCC/);
  assert.equal(purchases()[0].status, 'ready');
});

test('a plan that is not a month count reserves its own type and data', async () => {
  await service.run('voucher-buy', ALAN, { plan: 'badge' });

  assert.equal(calls[0][1].type, 'badge');
  assert.deepEqual(calls[0][1].data, { id: 'early' });
  assert.equal(calls[1][1].amount, 5);
});

test('a resumed purchase reserves what it was bought as, even if the plan changed since', async () => {
  replies.activate = async () => { throw new Error('down'); };
  await service.run('voucher-buy', ALAN, { plan: 'badge' });
  service = build({ plans: () => ({}) });
  replies.activate = async () => ({ code: 'AAAA-BBBB-CCCC' });
  calls = [];

  await service.resume();

  assert.equal(calls[0][1].type, 'badge');
  assert.deepEqual(calls[0][1].data, { id: 'early' });
  assert.equal(calls[1][1].amount, 5);
});

test('the voucher is reserved with a note saying who bought what', async () => {
  await service.run('voucher-buy', ALAN, { plan: 'monthly' });

  assert.equal(calls[0][1].note, 'Monthly (monthly) bought by Alan (Discord 111)');
});

test('a long name cannot make the note longer than the limit', async () => {
  await service.run('voucher-buy', { discordId: '111', name: 'x'.repeat(500) }, { plan: 'monthly' });

  assert.equal(calls[0][1].note.length, 200);
});

test('a resumed purchase reserves with the note it started with', async () => {
  replies.activate = async () => { throw new Error('down'); };
  await service.run('voucher-buy', ALAN, { plan: 'monthly' });
  const first = calls[0][1].note;
  replies.activate = async () => ({ code: 'AAAA-BBBB-CCCC' });
  calls = [];

  await service.resume();

  assert.equal(calls[0][1].note, first);
});

test('the reply points at the place to redeem when one is configured', async () => {
  service = build({ redeemURL: 'https://redeem.test' });

  const reply = await service.run('voucher-buy', ALAN, { plan: 'monthly' });

  assert.match(reply.text, /https:\/\/redeem\.test/);
});

test('an unknown plan costs nothing and is not recorded', async () => {
  const reply = await service.run('voucher-buy', ALAN, { plan: 'weekly' });

  assert.match(reply.text, /no plan called "weekly"/);
  assert.equal(calls.length, 0);
  assert.equal(purchases().length, 0);
});

test('the plan name is not case sensitive', async () => {
  await service.run('voucher-buy', ALAN, { plan: ' Monthly ' });

  assert.equal(calls.length, 3);
});

test('a refused charge fails the purchase and leaves the reservation unactivated', async () => {
  replies.charge = async () => ({ error: 'Balance insufficient' });

  const reply = await service.run('voucher-buy', ALAN, { plan: 'monthly' });

  assert.equal(reply.text, "You don't have enough FMC for that plan.");
  assert.deepEqual(calls.map(([name]) => name), ['reserve', 'charge']);
  assert.equal(purchases()[0].status, 'failed');
  assert.equal(errors.length, 0);
});

test('an account that is not linked is told how to link it', async () => {
  replies.charge = async () => ({ error: 'User not found' });

  const reply = await service.run('voucher-buy', ALAN, { plan: 'monthly' });

  assert.match(reply.text, /https:\/\/link\.test/);
});

test('a charge that did not complete is a failed purchase', async () => {
  replies.charge = async () => ({ id: 'tx1', status: 'refunded' });

  const reply = await service.run('voucher-buy', ALAN, { plan: 'monthly' });

  assert.match(reply.text, /nothing was taken/);
  assert.equal(purchases()[0].status, 'failed');
  assert.equal(errors.length, 1);
});

test('a reservation the service refuses charges nothing', async () => {
  replies.reserve = async () => ({ error: 'Invalid request' });

  const reply = await service.run('voucher-buy', ALAN, { plan: 'monthly' });

  assert.match(reply.text, /nothing was taken/);
  assert.deepEqual(calls.map(([name]) => name), ['reserve']);
  assert.equal(purchases()[0].status, 'failed');
  assert.equal(errors.length, 1);
});

test('a purchase that dies after the charge stays pending and is finished on resume', async () => {
  replies.activate = async () => { throw new Error('The vouchers service answered 503'); };

  const reply = await service.run('voucher-buy', ALAN, { plan: 'monthly' });

  assert.match(reply.text, /retried on its own/);
  assert.equal(purchases()[0].status, 'pending');

  replies.activate = async () => ({ code: 'AAAA-BBBB-CCCC' });
  calls = [];
  assert.equal(await service.resume(), 1);

  assert.deepEqual(calls.map(([name]) => name), ['reserve', 'charge', 'activate']);
  assert.equal(new Set(calls.map(([, input]) => input.requestId)).size, 1);
  assert.equal(purchases()[0].status, 'ready');
});

test('an activation the service refuses keeps the purchase pending', async () => {
  replies.activate = async () => ({ error: 'Invalid request id' });

  const reply = await service.run('voucher-buy', ALAN, { plan: 'monthly' });

  assert.match(reply.text, /retried on its own/);
  assert.equal(purchases()[0].status, 'pending');
  assert.equal(errors.length, 1);
});

test('resume leaves finished and failed purchases alone', async () => {
  await service.run('voucher-buy', ALAN, { plan: 'monthly' });
  replies.charge = async () => ({ error: 'Balance insufficient' });
  await service.run('voucher-buy', ALAN, { plan: 'yearly' });
  calls = [];

  assert.equal(await service.resume(), 0);
  assert.equal(calls.length, 0);
});

test('a second purchase waits while the first is still going through', async () => {
  let release;
  replies.charge = () => new Promise((resolve) => {
    release = () => resolve({ id: 'tx1', status: 'completed' });
  });

  const first = service.run('voucher-buy', ALAN, { plan: 'monthly' });
  await new Promise(resolve => setImmediate(resolve));
  const second = await service.run('voucher-buy', ALAN, { plan: 'monthly' });
  release();
  await first;

  assert.match(second.text, /still going through/);
  assert.equal(purchases().length, 1);
});

test('resume skips a purchase that is being settled right now', async () => {
  let release;
  replies.charge = () => new Promise((resolve) => {
    release = () => resolve({ id: 'tx1', status: 'completed' });
  });

  const first = service.run('voucher-buy', ALAN, { plan: 'monthly' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await service.resume(), 0);
  release();
  await first;

  assert.equal(calls.filter(([name]) => name === 'charge').length, 1);
});

test('voucher-mine shows your codes privately, newest first, and not failed ones', async () => {
  await service.run('voucher-buy', ALAN, { plan: 'monthly' });
  replies.reserve = async () => ({ code: 'DDDD-EEEE-FFFF' });
  await service.run('voucher-buy', ALAN, { plan: 'yearly' });
  replies.charge = async () => ({ error: 'Balance insufficient' });
  await service.run('voucher-buy', ALAN, { plan: 'yearly' });
  await service.run('voucher-buy', { discordId: '222', name: 'Sam' }, { plan: 'monthly' });
  const bought = await store.purchasesByUser(ALAN.discordId);
  await store.setPurchase(bought.find(p => p.code === 'AAAA-BBBB-CCCC').id, { createdAt: 1700000000000 });
  await store.setPurchase(bought.find(p => p.code === 'DDDD-EEEE-FFFF').id, { createdAt: 1700100000000 });

  const reply = await service.run('voucher-mine', ALAN);

  assert.equal(reply.hidden, true);
  assert.deepEqual(reply.text.split('\n').slice(1), [
    'Yearly: `DDDD-EEEE-FFFF` · bought <t:1700100000:d>',
    'Monthly: `AAAA-BBBB-CCCC` · bought <t:1700000000:d>',
  ]);
  assert.equal(reply.pages.length, 1);
});

test('a purchase without a usable date is listed without one', async () => {
  await service.run('voucher-buy', ALAN, { plan: 'monthly' });
  const [purchase] = await store.purchasesByUser(ALAN.discordId);
  await store.setPurchase(purchase.id, { createdAt: null });

  const reply = await service.run('voucher-mine', ALAN);

  assert.equal(reply.text.split('\n')[1], 'Monthly: `AAAA-BBBB-CCCC`');
});

test('the purchase reply is an embed with the code on its own line, and keeps a plain text version', async () => {
  const reply = await service.run('voucher-buy', ALAN, { plan: 'monthly' });

  assert.match(reply.text, /AAAA-BBBB-CCCC/);
  assert.equal(reply.embed.title, 'Voucher purchased');
  assert.equal(reply.embed.description, '```\nAAAA-BBBB-CCCC\n```');
  assert.deepEqual(reply.embed.fields, [
    { name: 'Plan', value: 'Monthly', inline: true },
    { name: 'Paid', value: '100 FMC', inline: true },
  ]);
  assert.match(reply.embed.footer.text, /voucher-mine/);
});

test('the purchase embed says where to redeem when that is configured', async () => {
  service = build({ redeemURL: 'https://redeem.test' });

  const reply = await service.run('voucher-buy', ALAN, { plan: 'monthly' });

  assert.deepEqual(reply.embed.fields[2], { name: 'Redeem it at', value: 'https://redeem.test' });
});

test('a refused or retried purchase is a plain reply, with no embed', async () => {
  replies.charge = async () => ({ error: 'Balance insufficient' });
  const refused = await service.run('voucher-buy', ALAN, { plan: 'monthly' });
  replies.charge = async () => ({ id: 'tx1', status: 'completed' });
  replies.activate = async () => { throw new Error('down'); };
  const retried = await service.run('voucher-buy', ALAN, { plan: 'monthly' });

  assert.equal('embed' in refused, false);
  assert.equal('embed' in retried, false);
});

test('voucher-mine says when a purchase is still being processed or you have none', async () => {
  assert.match((await service.run('voucher-mine', ALAN)).text, /haven't bought/);

  replies.activate = async () => { throw new Error('down'); };
  await service.run('voucher-buy', ALAN, { plan: 'monthly' });

  assert.match((await service.run('voucher-mine', ALAN)).text, /Monthly: still being processed/);
});

test('voucher-plans lists the plans for everyone to see', async () => {
  const reply = await service.run('voucher-plans', ALAN);

  assert.equal(reply.hidden, false);
  assert.match(reply.text, /Monthly for 100 FMC/);
  assert.match(reply.text, /Yearly for 1,000 FMC/);
  assert.match(reply.text, /Early badge for 5 FMC/);
});

const MENU = {
  'replay-month': {
    price: 100, type: 'replay', data: { plan: 'month', months: 1 }, label: 'Replay Pro, 1 month',
  },
};

test('the plan list shows the labels and never the names behind them', async () => {
  service = build({ plans: () => MENU });

  const reply = await service.run('voucher-plans', ALAN);

  assert.match(reply.text, /Replay Pro, 1 month for 100 FMC/);
  assert.doesNotMatch(reply.text, /replay-month/);
  assert.doesNotMatch(reply.text, /\bmonth:/);
});

test('a plan can be bought by its label as well as by its name', async () => {
  service = build({ plans: () => MENU });

  await service.run('voucher-buy', ALAN, { plan: 'replay-month' });
  await service.run('voucher-buy', ALAN, { plan: '  replay pro, 1 MONTH ' });

  assert.equal(calls.filter(([name]) => name === 'reserve').length, 2);
  assert.deepEqual(calls[0][1].data, { plan: 'month', months: 1 });
});

test('a plan the menu does not have is refused without naming the plans behind it', async () => {
  service = build({ plans: () => MENU });

  const reply = await service.run('voucher-buy', ALAN, { plan: 'month' });

  assert.match(reply.text, /no plan called "month"/);
  assert.equal(calls.length, 0);
});

test('the purchase keeps the label it was bought under, and voucher-mine shows it', async () => {
  service = build({ plans: () => MENU });
  await service.run('voucher-buy', ALAN, { plan: 'replay-month' });
  service = build({ plans: () => ({}) });

  const reply = await service.run('voucher-mine', ALAN);

  assert.match(reply.text, /Replay Pro, 1 month: `AAAA-BBBB-CCCC`/);
  assert.equal(purchases()[0].label, 'Replay Pro, 1 month');
});

const SALE = {
  month: {
    price: 80, regular: 100, until: 10000, type: 'replay', data: { plan: 'month', months: 1 }, label: 'Month',
  },
};

test('during a sale the sale price is charged and the plan list says when it ends', async () => {
  service = build({ plans: () => SALE, now: () => 9000 });

  const listed = await service.run('voucher-plans', ALAN);
  const reply = await service.run('voucher-buy', ALAN, { plan: 'month' });

  assert.match(listed.text, /Month for 80 FMC \(sale ends <t:10:R>, normally 100\)/);
  assert.equal(calls[1][1].amount, 80);
  assert.match(reply.text, /You paid 80 FMC/);
  assert.equal(purchases()[0].amount, 80);
});

test('once the sale has ended the regular price is charged, even before the plans are refreshed', async () => {
  service = build({ plans: () => SALE, now: () => 10000 });

  const listed = await service.run('voucher-plans', ALAN);
  const reply = await service.run('voucher-buy', ALAN, { plan: 'month' });

  assert.match(listed.text, /Month for 100 FMC$/);
  assert.equal(calls[1][1].amount, 100);
  assert.match(reply.text, /You paid 100 FMC/);
});

test('a purchase that was started during a sale is resumed at the price it was started at', async () => {
  let clock = 9000;
  service = build({ plans: () => SALE, now: () => clock });
  replies.activate = async () => { throw new Error('down'); };
  await service.run('voucher-buy', ALAN, { plan: 'month' });
  replies.activate = async () => ({ code: 'AAAA-BBBB-CCCC' });
  clock = 20000;
  calls = [];

  await service.resume();

  assert.equal(calls[1][1].amount, 80);
});

test('plans are refreshed before a purchase, so the price charged is the live one', async () => {
  let current = { month: { ...SALE.month, price: 100, until: undefined } };
  service = build({
    plans: () => current,
    refresh: async () => {
      current = SALE;
    },
    now: () => 9000,
  });

  const reply = await service.run('voucher-buy', ALAN, { plan: 'month' });

  assert.equal(calls[1][1].amount, 80);
  assert.match(reply.text, /You paid 80 FMC/);
});

test('a plan that only exists after the refresh can be bought', async () => {
  let current = {};
  service = build({
    plans: () => current,
    refresh: async () => {
      current = PLANS;
    },
  });

  const reply = await service.run('voucher-buy', ALAN, { plan: 'monthly' });

  assert.match(reply.text, /Here is your Monthly voucher/);
});

test('the plan list is refreshed too', async () => {
  let current = {};
  service = build({
    plans: () => current,
    refresh: async () => {
      current = PLANS;
    },
  });

  assert.match((await service.run('voucher-plans', ALAN)).text, /Monthly for 100 FMC/);
});

test('a refresh that fails does not stop a purchase, and is reported', async () => {
  service = build({
    refresh: async () => {
      throw new Error('The plans address answered 500');
    },
  });

  const reply = await service.run('voucher-buy', ALAN, { plan: 'monthly' });

  assert.match(reply.text, /Here is your Monthly voucher/);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /answered 500/);
});

test('looking at your own vouchers does not refresh the plans', async () => {
  let refreshed = 0;
  service = build({
    refresh: async () => {
      refreshed += 1;
    },
  });

  await service.run('voucher-mine', ALAN);

  assert.equal(refreshed, 0);
});

test('with no plans configured nothing can be bought', async () => {
  service = build({ plans: () => ({}) });

  assert.match((await service.run('voucher-plans', ALAN)).text, /No plans/);
  assert.match((await service.run('voucher-buy', ALAN, { plan: 'monthly' })).text, /No plans/);
});

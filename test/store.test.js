const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');

const createStore = require('../src/store');
const createFakeFirestore = require('./helpers/fakeFirestore');

let fake;
let store;

const input = (overrides = {}) => ({
  discordId: '111',
  name: 'Alan',
  plan: 'monthly',
  type: 'replay',
  data: { months: 1 },
  amount: 100,
  memo: 'Voucher: Monthly',
  ...overrides,
});

beforeEach(() => {
  fake = createFakeFirestore();
  store = createStore({ db: fake.db, FieldValue: fake.FieldValue });
});

test('a new purchase is pending and remembers what was asked for', async () => {
  const purchase = await store.createPurchase(input());

  assert.equal(purchase.status, 'pending');
  assert.deepEqual(fake.data.get(`voucher-purchases/${purchase.id}`), {
    ...input(), status: 'pending', createdAt: 1,
  });
});

test('a purchase can be updated, and the pending ones are found by status', async () => {
  const first = await store.createPurchase(input());
  const second = await store.createPurchase(input({ discordId: '222' }));

  await store.setPurchase(first.id, { status: 'ready', code: 'AAAA-BBBB-CCCC' });

  assert.deepEqual((await store.pendingPurchases()).map(item => item.id), [second.id]);
  assert.equal(fake.data.get(`voucher-purchases/${first.id}`).code, 'AAAA-BBBB-CCCC');
});

test('purchases are found by the person who made them', async () => {
  await store.createPurchase(input());
  await store.createPurchase(input({ discordId: '222' }));
  await store.createPurchase(input());

  assert.equal((await store.purchasesByUser('111')).length, 2);
  assert.equal((await store.purchasesByUser('333')).length, 0);
});

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

test('the live plans are not changed', () => {
  buildMenu(LIVE, { pro: { plan: 'month', label: 'Pro' } });

  assert.equal(LIVE.month.label, 'month');
});

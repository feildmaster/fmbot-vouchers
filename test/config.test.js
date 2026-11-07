const assert = require('node:assert/strict');
const { test } = require('node:test');

const { parseConfig } = require('../src/config');

test('a plan has a whole price, and its type and data default to replay and nothing', () => {
  const { plans, rejected } = parseConfig({
    plans: {
      monthly: { price: 100, label: 'Monthly', data: { months: 1 } },
      Yearly: { price: '1000' },
    },
  });

  assert.deepEqual(plans, {
    monthly: {
      price: 100, type: 'replay', data: { months: 1 }, label: 'Monthly',
    },
    yearly: {
      price: 1000, type: 'replay', data: {}, label: 'yearly',
    },
  });
  assert.deepEqual(rejected, []);
});

test('a plan can sell any other type with any data the redeemer understands', () => {
  const { plans } = parseConfig({
    plans: { badge: { price: 5, type: 'badge', data: { id: 'early', tags: ['a', 'b'] } } },
  });

  assert.equal(plans.badge.type, 'badge');
  assert.deepEqual(plans.badge.data, { id: 'early', tags: ['a', 'b'] });
});

test('a plan with a bad name, price, type or data is ignored and reported', () => {
  const { plans, rejected } = parseConfig({
    plans: {
      'bad name': { price: 1 },
      free: { price: 0 },
      half: { price: 0.5 },
      none: null,
      money: { price: 5, type: 'credit' },
      upper: { price: 5, type: 'Badge' },
      text: { price: 5, type: 7 },
      listed: { price: 5, data: [] },
      scalar: { price: 5, data: 'x' },
      huge: { price: 5, data: { blob: 'x'.repeat(4000) } },
      fine: { price: 5 },
    },
  });

  assert.deepEqual(Object.keys(plans), ['fine']);
  assert.deepEqual(rejected, [
    'bad name', 'free', 'half', 'none', 'money', 'upper', 'text', 'listed', 'scalar', 'huge',
  ]);
});

test('a name that repeats once lowercased keeps the first plan', () => {
  const { plans, rejected } = parseConfig({
    plans: { Monthly: { price: 1 }, monthly: { price: 2 } },
  });

  assert.equal(plans.monthly.price, 1);
  assert.deepEqual(rejected, ['monthly']);
});

test('a missing or odd config gives no plans', () => {
  [undefined, null, 'x', {}, { plans: [] }, { plans: 'x' }].forEach((config) => {
    assert.deepEqual(parseConfig(config), { plans: {}, rejected: [] });
  });
});

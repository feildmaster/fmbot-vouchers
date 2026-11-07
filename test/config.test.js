const assert = require('node:assert/strict');
const { test } = require('node:test');

const { ADMINS_TEMPLATE, needsAdmins, parseConfig } = require('../src/config');

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

test('an entry that names a plan of the plans address is a pointer, with its own label', () => {
  const { plans, pointers, rejected } = parseConfig({
    plans: {
      'Replay-Month': { plan: ' Month ', label: ' Replay Pro, 1 month ' },
      plain: { plan: 'slot' },
    },
  });

  assert.deepEqual(plans, {});
  assert.deepEqual(pointers, {
    'replay-month': { plan: 'month', label: 'Replay Pro, 1 month' },
    plain: { plan: 'slot', label: '' },
  });
  assert.deepEqual(rejected, []);
});

test('a pointer with a bad name or a bad plan is ignored and reported', () => {
  const { pointers, rejected } = parseConfig({
    plans: {
      'bad name': { plan: 'month' },
      empty: { plan: '' },
      spaced: { plan: 'two words' },
      fine: { plan: 'month' },
    },
  });

  assert.deepEqual(Object.keys(pointers), ['fine']);
  assert.deepEqual(rejected, ['bad name', 'empty', 'spaced']);
});

test('an entry with a price is a plan of its own even if it also names a plan', () => {
  const { plans, pointers } = parseConfig({ plans: { own: { price: 5, plan: 'month' } } });

  assert.deepEqual(Object.keys(plans), ['own']);
  assert.deepEqual(pointers, {});
});

test('a pointer and a plan cannot share a name', () => {
  const { plans, pointers, rejected } = parseConfig({
    plans: { month: { price: 5 }, Month: { plan: 'month' } },
  });

  assert.deepEqual(Object.keys(plans), ['month']);
  assert.deepEqual(pointers, {});
  assert.deepEqual(rejected, ['Month']);
});

test('a missing or odd config gives no plans and no admins', () => {
  [undefined, null, 'x', {}, { plans: [] }, { plans: 'x' }].forEach((config) => {
    assert.deepEqual(parseConfig(config), {
      plans: {}, pointers: {}, rejected: [], admins: new Set(), rejectedAdmins: [],
    });
  });
});

const ALAN = '208562116590960640';

test('admins are Discord ids written as text, in a list, as one id, or in an object', () => {
  assert.deepEqual([...parseConfig({ admins: [ALAN, ' 123456789012345678 '] }).admins], [ALAN, '123456789012345678']);
  assert.deepEqual([...parseConfig({ admins: ALAN }).admins], [ALAN]);
  assert.deepEqual([...parseConfig({ admins: { first: ALAN } }).admins], [ALAN]);
});

test('an admin that is not a Discord id written as text is ignored and reported', () => {
  const { admins, rejectedAdmins } = parseConfig({ admins: [ALAN, '12', 208562116590960640, 'alan', null] });

  assert.deepEqual([...admins], [ALAN]);
  assert.deepEqual(rejectedAdmins, ['12', 208562116590960640, 'alan', null]);
});

test('the same admin twice is one admin, and admins do not touch the plans', () => {
  const { admins, plans, rejected } = parseConfig({
    admins: [ALAN, ALAN],
    plans: { monthly: { price: 100 } },
  });

  assert.equal(admins.size, 1);
  assert.deepEqual(Object.keys(plans), ['monthly']);
  assert.deepEqual(rejected, []);
});

test('the placeholder the plugin writes is nobody, and is not reported as a mistake', () => {
  const { admins, rejectedAdmins } = parseConfig({ admins: ADMINS_TEMPLATE });

  assert.equal(admins.size, 0);
  assert.deepEqual(rejectedAdmins, []);
});

const [PLACEHOLDER] = ADMINS_TEMPLATE;

test('the placeholder can stay next to real admins, in any list shape', () => {
  const list = parseConfig({ admins: [PLACEHOLDER, ALAN, ` ${PLACEHOLDER} `] });
  const map = parseConfig({ admins: { 0: PLACEHOLDER, 1: ALAN } });

  assert.deepEqual([...list.admins], [ALAN]);
  assert.deepEqual(list.rejectedAdmins, []);
  assert.deepEqual([...map.admins], [ALAN]);
  assert.deepEqual(map.rejectedAdmins, []);
});

test('only the placeholder itself is let through, and any other mistake is still reported', () => {
  const { rejectedAdmins } = parseConfig({
    admins: [PLACEHOLDER, PLACEHOLDER.toUpperCase(), `${PLACEHOLDER}2`, 'placeholder', 'alan'],
  });

  assert.deepEqual(rejectedAdmins, [PLACEHOLDER.toUpperCase(), `${PLACEHOLDER}2`, 'placeholder', 'alan']);
});

test('the placeholder is written when the config has no admins at all, and only then', () => {
  [undefined, null, 'x', 5, [], {}, { plans: {} }].forEach((config) => {
    assert.equal(needsAdmins(config), true, JSON.stringify(config));
  });
  [{ admins: ADMINS_TEMPLATE }, { admins: [ALAN] }, { admins: ALAN }, { admins: '' }, { admins: [] }].forEach((config) => {
    assert.equal(needsAdmins(config), false, JSON.stringify(config));
  });
});

test('what is written as a template is a list holding one word that cannot be a username anywhere', () => {
  assert.deepEqual(ADMINS_TEMPLATE, ['<placeholder>']);
  assert.match(PLACEHOLDER, /^<.+>$/);
});

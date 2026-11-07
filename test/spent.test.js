const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');

const createService = require('../src/service');
const createStore = require('../src/store');
const createFakeFirestore = require('./helpers/fakeFirestore');

const DAY = 24 * 60 * 60 * 1000;
const days = count => count * DAY;
const BASE = 1700000000000;
const ALAN = { discordId: '111', name: 'Alan' };

let errors;
let fake;
let replies;
let service;
let statusCalls;
let store;

const build = (overrides = {}) => createService({
  store,
  reserve: async () => ({ code: 'unused' }),
  charge: async () => ({ status: 'completed' }),
  activate: async () => ({ code: 'unused' }),
  plans: () => ({}),
  status: async (input) => {
    statusCalls.push(input);
    return replies.status(input);
  },
  onError: error => errors.push(error),
  ...overrides,
});

beforeEach(() => {
  errors = [];
  statusCalls = [];
  fake = createFakeFirestore();
  store = createStore({ db: fake.db, FieldValue: fake.FieldValue });
  replies = { status: async () => ({ vouchers: {} }) };
  service = build();
});

const code = index => `AAAA-BBBB-${String(index).padStart(4, 'C')}`;

const voucher = async (index, extra = {}) => {
  const made = await store.createPurchase({
    discordId: ALAN.discordId, name: 'Alan', plan: 'p', label: `Plan ${index}`, type: 't', data: {}, amount: 5, memo: 'm', note: 'n',
  });
  await store.setPurchase(made.id, {
    status: 'ready', code: code(index), createdAt: BASE + days(index), ...extra,
  });
  return made.id;
};

const answerWith = states => async ({ codes }) => ({
  vouchers: Object.fromEntries(codes.map(item => [item, states[item] || { status: 'unused', used: 0, uses: 1 }])),
});

const mine = () => service.run('voucher-mine', ALAN);
const lines = reply => reply.text.split('\n').slice(1);
const stored = id => fake.data.get(`voucher-purchases/${id}`);

test('a voucher that has been used moves to the bottom, under its own heading, without its code', async () => {
  await voucher(1);
  await voucher(2);
  await voucher(3);
  replies.status = answerWith({ [code(2)]: { status: 'used', used: 1, uses: 1 } });

  const reply = await mine();

  assert.deepEqual(lines(reply), [
    `Plan 3: \`${code(3)}\` · bought <t:${Math.floor((BASE + days(3)) / 1000)}:d>`,
    `Plan 1: \`${code(1)}\` · bought <t:${Math.floor((BASE + DAY) / 1000)}:d>`,
    '**No longer usable**',
    `Plan 2 · used · bought <t:${Math.floor((BASE + days(2)) / 1000)}:d>`,
  ]);
  assert.equal(reply.text.includes(code(2)), false);
});

test('the list is in the embed as well, with the heading on its own line and the used ones after it', async () => {
  await voucher(1);
  await voucher(2);
  replies.status = answerWith({ [code(1)]: { status: 'used', used: 1, uses: 1 } });

  const { pages } = await mine();

  assert.equal(pages.length, 1);
  const rows = pages[0].description.split('\n');
  assert.match(rows[0], /^- Plan 2: `/);
  assert.equal(rows[1], '**No longer usable**');
  assert.match(rows[2], /^- Plan 1 · used/);
});

test('a voucher that was revoked or has expired is listed there too, with what happened to it', async () => {
  await voucher(1);
  await voucher(2);
  replies.status = answerWith({
    [code(1)]: { status: 'revoked', used: 0, uses: 1 },
    [code(2)]: { status: 'expired', used: 0, uses: 1 },
  });

  const reply = await mine();

  assert.deepEqual(lines(reply).slice(0, 2), ['You have no unused vouchers.', '**No longer usable**']);
  assert.match(lines(reply)[2], /^Plan 2 · expired/);
  assert.match(lines(reply)[3], /^Plan 1 · revoked/);
});

test('both groups are newest first', async () => {
  await voucher(1);
  await voucher(2);
  await voucher(3);
  await voucher(4);
  replies.status = answerWith({
    [code(1)]: { status: 'used' },
    [code(3)]: { status: 'used' },
  });

  const rows = lines(await mine());

  assert.deepEqual(rows.map(row => row.split(/[:·]/)[0].trim()), ['Plan 4', 'Plan 2', '**No longer usable**', 'Plan 3', 'Plan 1']);
});

test('it asks once, for the codes of the purchases that are ready, each code once', async () => {
  await voucher(1);
  await voucher(2);
  await voucher(3, { status: 'pending' });
  await voucher(4, { code: code(1) });

  await mine();

  assert.equal(statusCalls.length, 1);
  assert.deepEqual([...statusCalls[0].codes].sort(), [code(1), code(2)]);
});

test('what it learns is kept, so a voucher that is used is not asked about again', async () => {
  const id = await voucher(1);
  await voucher(2);
  replies.status = answerWith({ [code(1)]: { status: 'used' } });

  await mine();
  statusCalls = [];
  const again = await mine();

  assert.equal(stored(id).spent, 'used');
  assert.deepEqual(statusCalls.map(call => call.codes), [[code(2)]]);
  assert.match(lines(again)[lines(again).length - 1], /^Plan 1 · used/);
});

test('a voucher that is still unused is asked about every time, and nothing is kept for it', async () => {
  const id = await voucher(1);

  await mine();
  await mine();

  assert.equal(statusCalls.length, 2);
  assert.equal('spent' in stored(id), false);
});

test('nothing is asked when every voucher is already known to be spent, or only waiting', async () => {
  await voucher(1, { spent: 'used' });
  await voucher(2, { status: 'pending' });

  const reply = await mine();

  assert.equal(statusCalls.length, 0);
  assert.match(lines(reply)[0], /^Plan 2: still being processed/);
  assert.equal(lines(reply)[1], '**No longer usable**');
  assert.match(lines(reply)[2], /^Plan 1 · used/);
});

test('with nothing left to use, the list says so before the ones that are used', async () => {
  await voucher(1);
  replies.status = answerWith({ [code(1)]: { status: 'used' } });

  const rows = lines(await mine());

  assert.deepEqual(rows.slice(0, 2), ['You have no unused vouchers.', '**No longer usable**']);
});

test('a voucher the service does not know, or has not activated, still shows as one to use, and is not kept', async () => {
  const unknown = await voucher(1);
  const inactive = await voucher(2);
  replies.status = answerWith({
    [code(1)]: { status: 'unknown' },
    [code(2)]: { status: 'inactive', used: 0, uses: 1 },
  });

  const rows = lines(await mine());

  assert.equal(rows.some(row => row.includes('No longer usable')), false);
  assert.equal(rows.length, 2);
  assert.equal('spent' in stored(unknown), false);
  assert.equal('spent' in stored(inactive), false);
});

test('when the service cannot be reached the list is as it was, with a note, and the problem is reported', async () => {
  await voucher(1);
  replies.status = async () => { throw new Error('The vouchers service answered 503'); };

  const reply = await mine();

  assert.match(lines(reply)[0], /^Plan 1: `/);
  assert.match(lines(reply)[1], /couldn't check which of these are used/);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /503/);
});

test('an answer that is an error is treated the same way, and a voucher is never marked used because of it', async () => {
  const id = await voucher(1);
  replies.status = async () => ({ error: 'Invalid request' });

  const reply = await mine();

  assert.match(reply.text, /couldn't check/);
  assert.match(errors[0].message, /Invalid request/);
  assert.equal('spent' in stored(id), false);
});

test('the same problem is reported once, and again when it changes or has gone away in between', async () => {
  await voucher(1);
  replies.status = async () => { throw new Error('down'); };

  await mine();
  await mine();
  assert.equal(errors.length, 1);

  replies.status = async () => { throw new Error('something else'); };
  await mine();
  assert.equal(errors.length, 2);

  replies.status = answerWith({});
  await mine();
  replies.status = async () => { throw new Error('something else'); };
  await mine();
  assert.equal(errors.length, 3);
});

test('a note is not added when the check worked', async () => {
  await voucher(1);

  assert.equal(lines(await mine()).some(row => row.includes("couldn't check")), false);
});

test('codes are asked about 25 at a time', async () => {
  await Promise.all(Array.from({ length: 60 }, (_, i) => voucher(i + 1)));

  await mine();

  assert.deepEqual(statusCalls.map(call => call.codes.length).sort((a, b) => a - b), [10, 25, 25]);
});

test('no more than a hundred codes are asked about', async () => {
  await Promise.all(Array.from({ length: 130 }, (_, i) => voucher(i + 1)));

  await mine();

  assert.equal(statusCalls.reduce((total, call) => total + call.codes.length, 0), 100);
});

test('the heading is not left alone at the bottom of a page', async () => {
  await Promise.all(Array.from({ length: 9 }, (_, i) => voucher(i + 1)));
  await voucher(10);
  replies.status = answerWith({ [code(10)]: { status: 'used' } });

  const { pages } = await mine();

  assert.equal(pages.length, 2);
  assert.equal(pages[0].description.split('\n').length, 9);
  assert.equal(pages[1].description.split('\n')[0], '**No longer usable**');
  assert.equal(pages[1].description.split('\n').length, 2);
});

test('a long list is split into pages of ten, and a heading is not given a bullet', async () => {
  await Promise.all(Array.from({ length: 12 }, (_, i) => voucher(i + 1)));

  const { pages } = await mine();

  assert.deepEqual(pages.map(page => page.description.split('\n').length), [10, 2]);
  assert.equal(pages[0].title, 'Your vouchers');
});

test('a voucher still being processed is listed with the ones to use, not with the used ones', async () => {
  await voucher(1);
  await voucher(2, { status: 'pending' });
  replies.status = answerWith({ [code(1)]: { status: 'used' } });

  const rows = lines(await mine());

  assert.match(rows[0], /^Plan 2: still being processed/);
  assert.equal(rows[1], '**No longer usable**');
});

test('someone else\'s vouchers are never part of the question', async () => {
  await voucher(1);
  const other = await store.createPurchase({
    discordId: '999', name: 'Sam', plan: 'p', label: 'Plan 9', type: 't', data: {}, amount: 5, memo: 'm', note: 'n',
  });
  await store.setPurchase(other.id, { status: 'ready', code: 'ZZZZ-ZZZZ-ZZZZ' });

  await mine();

  assert.deepEqual(statusCalls.map(call => call.codes), [[code(1)]]);
});

test('a purchase that was not confirmed is not asked about either', async () => {
  await voucher(1);
  await voucher(2, { status: 'awaiting' });
  await voucher(3, { status: 'cancelled' });

  await mine();

  assert.deepEqual(statusCalls.map(call => call.codes), [[code(1)]]);
});

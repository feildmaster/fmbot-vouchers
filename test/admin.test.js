const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');

const createService = require('../src/service');
const createStore = require('../src/store');
const createFakeFirestore = require('./helpers/fakeFirestore');

const DAY = 24 * 60 * 60 * 1000;
const BASE = 1700000000000;
const ADMIN = { discordId: '208562116590960640', name: 'Boss' };
const MEMBER = { discordId: '111111111111111111', name: 'Member' };
const TARGET = '333333333333333333';

let admins;
let asked;
let errors;
let fake;
let replies;
let service;
let store;

const build = (overrides = {}) => createService({
  store,
  reserve: async () => ({ code: 'unused' }),
  charge: async () => ({ status: 'completed' }),
  activate: async () => ({ code: 'unused' }),
  plans: () => ({}),
  status: async (input) => {
    asked.push(input);
    return replies.status(input);
  },
  isAdmin: (id) => {
    admins.push(id);
    return id === ADMIN.discordId;
  },
  onError: error => errors.push(error),
  ...overrides,
});

beforeEach(() => {
  admins = [];
  asked = [];
  errors = [];
  fake = createFakeFirestore();
  store = createStore({ db: fake.db, FieldValue: fake.FieldValue });
  replies = { status: async () => ({ vouchers: {} }) };
  service = build();
});

const code = index => `ABCD-EFGH-${String(index).padStart(4, 'J')}`;

const voucher = async (owner, index, extra = {}) => {
  const made = await store.createPurchase({
    discordId: owner, name: 'x', plan: 'p', label: `Plan ${index}`, type: 't', data: {}, amount: 5, memo: 'm', note: 'n',
  });
  await store.setPurchase(made.id, {
    status: 'ready', code: code(index), createdAt: BASE + (index * DAY), ...extra,
  });
  return made.id;
};

const answerWith = states => async ({ codes }) => ({
  vouchers: Object.fromEntries(codes.map(item => [item, states[item] || { status: 'unused', used: 0, uses: 1 }])),
});

const list = (ctx = ADMIN, user = TARGET) => service.run('voucheradmin-list', ctx, { user });
const rows = reply => reply.text.split('\n');

test('someone who is not an admin is refused, and nothing is looked up', async () => {
  await voucher(TARGET, 1);

  const reply = await list(MEMBER);

  assert.equal(reply.text, 'Only admins can do that.');
  assert.equal(reply.hidden, true);
  assert.equal(reply.pages, undefined);
  assert.equal(asked.length, 0);
});

test('whether someone is an admin is decided by who asked, not by who they asked about', async () => {
  await list(MEMBER, ADMIN.discordId);
  await list(ADMIN, MEMBER.discordId);

  assert.deepEqual(admins, [MEMBER.discordId, ADMIN.discordId]);
});

test('an admin sees the vouchers of the person they ask about, with the codes hidden', async () => {
  await voucher(TARGET, 1);
  await voucher(TARGET, 2);

  const reply = await list();

  assert.equal(reply.hidden, true);
  assert.equal(rows(reply)[0], `Vouchers bought by <@${TARGET}>`);
  assert.match(rows(reply)[1], /^Plan 2: `ABCD-••••-••••` · bought </);
  assert.match(rows(reply)[2], /^Plan 1: `ABCD-••••-••••` · bought </);
});

test('a code is never in the answer, in the text or in the embed', async () => {
  await voucher(TARGET, 1);
  await voucher(TARGET, 2, { code: 'ZZZZ-YYYY-XXXX' });

  const reply = await list();
  const everything = `${reply.text}\n${reply.pages.map(page => page.description).join('\n')}`;

  [code(1), 'EFGH', 'JJJ1', 'ZZZZ-YYYY-XXXX', 'YYYY', 'XXXX'].forEach((secret) => {
    assert.equal(everything.includes(secret), false, secret);
  });
  assert.equal(everything.includes('ZZZZ-••••-••••'), true);
});

test('only the first group of a code shows, whatever the number of groups', async () => {
  await voucher(TARGET, 1, { code: 'ABCD-EFGH-JKMN-PQRS-TUVW' });
  await voucher(TARGET, 2, { code: 'NODASHES1234' });

  const text = (await list()).text;

  assert.equal(text.includes('`ABCD-••••-••••-••••-••••`'), true);
  assert.equal(text.includes('`NODA••••••••`'), true);
});

test('a voucher that has been used is under the heading at the bottom, with no code at all', async () => {
  await voucher(TARGET, 1);
  await voucher(TARGET, 2);
  replies.status = answerWith({ [code(1)]: { status: 'used', used: 1, uses: 1 } });

  const reply = await list();

  assert.match(rows(reply)[1], /^Plan 2: `ABCD-••••-••••`/);
  assert.equal(rows(reply)[2], '**No longer usable**');
  assert.match(rows(reply)[3], /^Plan 1 · used · bought </);
  assert.equal(rows(reply)[3].includes('`'), false);
  assert.equal(rows(reply)[3].includes('•'), false);
});

test('the embed starts with who it is about, and the vouchers are bullets under it', async () => {
  await voucher(TARGET, 1);

  const { pages } = await list();

  assert.equal(pages.length, 1);
  assert.equal(pages[0].title, 'Vouchers');
  const lines = pages[0].description.split('\n');
  assert.equal(lines[0], `Vouchers bought by <@${TARGET}>`);
  assert.match(lines[1], /^- Plan 1: /);
});

test('a person who has bought nothing is said to have bought nothing, and nothing is asked', async () => {
  const reply = await list();

  assert.equal(reply.text, `<@${TARGET}> hasn't bought a voucher.`);
  assert.equal(reply.hidden, true);
  assert.equal(asked.length, 0);
});

test('only the vouchers of the person asked about are shown, not the admin\'s own', async () => {
  await voucher(TARGET, 1);
  await voucher(ADMIN.discordId, 2);
  await voucher(MEMBER.discordId, 3);

  const text = (await list()).text;

  assert.equal(text.includes('Plan 1'), true);
  assert.equal(text.includes('Plan 2'), false);
  assert.equal(text.includes('Plan 3'), false);
  assert.deepEqual(asked.map(call => call.codes), [[code(1)]]);
});

test('purchases that were not confirmed are not shown', async () => {
  await voucher(TARGET, 1);
  await voucher(TARGET, 2, { status: 'awaiting' });
  await voucher(TARGET, 3, { status: 'failed' });

  const text = (await list()).text;

  assert.equal(text.includes('Plan 1'), true);
  assert.equal(text.includes('Plan 2') || text.includes('Plan 3'), false);
});

test('a user that is not a Discord id is refused, and so is anything that could mention more than one person', async () => {
  const bad = [null, '', '   ', 'alan', '123', '@everyone', '<@333333333333333333>', 5, '333333333333333333 @here'];

  const answers = await Promise.all(bad.map(user => list(ADMIN, user)));

  answers.forEach((reply) => {
    assert.equal(reply.text, 'Pick a user from the list.');
    assert.equal(reply.hidden, true);
  });
  assert.equal(asked.length, 0);
});

test('a user id with spaces around it is accepted', async () => {
  await voucher(TARGET, 1);

  const reply = await list(ADMIN, `  ${TARGET} `);

  assert.equal(rows(reply)[0], `Vouchers bought by <@${TARGET}>`);
});

test('an admin who asks about nobody is told to pick someone, not that they are not an admin', async () => {
  const reply = await service.run('voucheradmin-list', ADMIN, {});

  assert.equal(reply.text, 'Pick a user from the list.');
});

test('when the vouchers service cannot be reached the list is still shown, hidden codes and a note', async () => {
  await voucher(TARGET, 1);
  replies.status = async () => { throw new Error('The vouchers service answered 503'); };

  const reply = await list();

  assert.match(rows(reply)[1], /`ABCD-••••-••••`/);
  assert.match(reply.text, /couldn't check which of these are used/);
  assert.equal(errors.length, 1);
});

test('what the check learns is kept for the person, so their own list is up to date too', async () => {
  const id = await voucher(TARGET, 1);
  replies.status = answerWith({ [code(1)]: { status: 'used' } });

  await list();
  asked.length = 0;
  const theirs = await service.run('voucher-mine', { discordId: TARGET, name: 'T' });

  assert.equal(fake.data.get(`voucher-purchases/${id}`).spent, 'used');
  assert.equal(asked.length, 0);
  assert.match(theirs.text, /No longer usable/);
});

test('the person\'s own list still shows their full codes', async () => {
  await voucher(TARGET, 1);

  const theirs = await service.run('voucher-mine', { discordId: TARGET, name: 'T' });

  assert.equal(theirs.text.includes(code(1)), true);
  assert.equal(theirs.text.includes('•'), false);
});

test('an admin who is not allowed by the list cannot use the menu either, since it is the same command', async () => {
  await voucher(TARGET, 1);
  service = build({ isAdmin: () => false });

  const reply = await service.run('voucheradmin-list', ADMIN, { user: TARGET });

  assert.equal(reply.text, 'Only admins can do that.');
});

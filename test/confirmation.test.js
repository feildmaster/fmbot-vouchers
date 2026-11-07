const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');

const { validateComponents } = require('@basedakp48/plugin-utils');
const createService = require('../src/service');
const createStore = require('../src/store');
const privateReply = require('../src/reply');
const createFakeFirestore = require('./helpers/fakeFirestore');

const minutes = count => count * 60 * 1000;
const START = 1700000000000;
const ALAN = { discordId: '111', name: 'Alan' };
const SAM = { discordId: '222', name: 'Sam' };

const monthly = (overrides = {}) => ({
  price: 100, type: 'replay', data: { plan: 'month', months: 1 }, label: 'Monthly', ...overrides,
});

let calls;
let clock;
let errors;
let fake;
let plans;
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
  plans: () => plans,
  now: () => clock,
  onError: error => errors.push(error),
  ...overrides,
});

beforeEach(() => {
  calls = [];
  clock = START;
  errors = [];
  fake = createFakeFirestore();
  store = createStore({ db: fake.db, FieldValue: fake.FieldValue });
  plans = { monthly: monthly() };
  replies = {
    reserve: async () => ({ code: 'AAAA-BBBB-CCCC' }),
    charge: async () => ({ id: 'tx1', status: 'completed' }),
    activate: async () => ({ code: 'AAAA-BBBB-CCCC' }),
  };
  service = build();
});

const stored = () => [...fake.data.entries()].map(([path, value]) => ({ path, ...value }));
const names = () => calls.map(([name]) => name);
const offer = async (ctx = ALAN, plan = 'monthly') => service.run('voucher-buy', ctx, { plan });
const confirmOf = prompt => prompt.components[0].id;
const cancelOf = prompt => prompt.components[1].id;

test('buying shows an offer, and reserves and charges nothing', async () => {
  const prompt = await offer();

  assert.equal(prompt.hidden, true);
  assert.deepEqual(names(), []);
  assert.equal(prompt.embed.title, 'Confirm your purchase');
  assert.equal(prompt.embed.description, '**Monthly**');
  assert.equal(prompt.embed.fields[0].value, '100 FMC');
  assert.match(prompt.text, /Buy Monthly for 100 FMC\?/);
});

test('the offer is recorded as waiting, with the plan, the price and the voucher it would make', async () => {
  await offer();

  const [purchase] = stored();
  assert.equal(purchase.status, 'awaiting');
  assert.equal(purchase.amount, 100);
  assert.equal(purchase.type, 'replay');
  assert.deepEqual(purchase.data, { plan: 'month', months: 1 });
  assert.equal(purchase.expiresAt, START + minutes(10));
  assert.match(purchase.note, /Monthly \(monthly\) bought by Alan/);
});

test('the offer has a Confirm and a Cancel button that the connector will accept', async () => {
  const prompt = await offer();

  assert.deepEqual(validateComponents(prompt.components), []);
  assert.match(confirmOf(prompt), /^confirm:\w+$/);
  assert.match(cancelOf(prompt), /^cancel:\w+$/);
  assert.equal(prompt.components[0].style, 'success');
  assert.equal(confirmOf(prompt).slice('confirm:'.length), cancelOf(prompt).slice('cancel:'.length));
});

test('the offer is yellow, and the voucher it becomes is green', async () => {
  const prompt = await offer();

  const reply = await service.component(ALAN, confirmOf(prompt));

  assert.equal(prompt.embed.color, 0xfee75c);
  assert.equal(reply.embed.color, 0x57f287);
});

test('the offer says when it ends', async () => {
  const prompt = await offer();

  assert.equal(prompt.embed.fields[1].value, `<t:${Math.floor((START + minutes(10)) / 1000)}:R>`);
});

test('during a sale the offer shows the sale price, what it usually costs, and when it ends', async () => {
  plans = { monthly: monthly({ price: 80, regular: 100, until: START + minutes(5) }) };

  const prompt = await offer();

  assert.equal(
    prompt.embed.fields[0].value,
    `80 FMC (usually 100, ends <t:${Math.floor((START + minutes(5)) / 1000)}:R>)`,
  );
  assert.equal(stored()[0].amount, 80);
});

test('Confirm reserves, charges and activates, and replaces the offer with the voucher', async () => {
  const prompt = await offer();

  const reply = await service.component(ALAN, confirmOf(prompt));

  assert.deepEqual(names(), ['reserve', 'charge', 'activate']);
  assert.equal(reply.update, true);
  assert.equal(reply.hidden, true);
  assert.equal(reply.embed.title, 'Voucher purchased');
  assert.equal(reply.embed.description, '```\nAAAA-BBBB-CCCC\n```');
  assert.match(reply.text, /You paid 100 FMC/);
  assert.equal(stored()[0].status, 'ready');
});

test('the voucher is the one that was offered, even if the plan has changed since', async () => {
  const prompt = await offer();
  plans = { monthly: monthly({ data: { plan: 'month', months: 12 }, type: 'other' }) };

  await service.component(ALAN, confirmOf(prompt));

  assert.deepEqual(calls[0][1].data, { plan: 'month', months: 1 });
  assert.equal(calls[0][1].type, 'replay');
  assert.equal(calls[1][1].amount, 100);
});

test('Cancel closes the offer, takes nothing, and cannot be undone by Confirm', async () => {
  const prompt = await offer();

  const cancelled = await service.component(ALAN, cancelOf(prompt));
  const late = await service.component(ALAN, confirmOf(prompt));

  assert.equal(cancelled.text, 'Cancelled. Nothing was taken.');
  assert.equal(cancelled.update, true);
  assert.match(late.text, /no longer valid/);
  assert.deepEqual(names(), []);
  assert.equal(stored()[0].status, 'cancelled');
});

test('only the person who was offered it can confirm or cancel', async () => {
  const prompt = await offer();

  const confirmed = await service.component(SAM, confirmOf(prompt));
  const cancelled = await service.component(SAM, cancelOf(prompt));

  [confirmed, cancelled].forEach((reply) => {
    assert.equal(reply.text, "That isn't your purchase.");
    assert.equal(reply.hidden, true);
    assert.equal(reply.update, undefined);
  });
  assert.deepEqual(names(), []);
  assert.equal(stored()[0].status, 'awaiting');
});

test('a button for an offer that does not exist is not somebody else\'s secret', async () => {
  const reply = await service.component(ALAN, 'confirm:nothing-here');

  assert.equal(reply.text, "That isn't your purchase.");
  assert.deepEqual(names(), []);
});

test('an offer that has ended cannot be confirmed, and nothing is charged', async () => {
  const prompt = await offer();
  clock = START + minutes(10) + 1;

  const reply = await service.component(ALAN, confirmOf(prompt));

  assert.match(reply.text, /offer ended/);
  assert.equal(reply.update, true);
  assert.deepEqual(names(), []);
  assert.equal(stored()[0].status, 'expired');
});

test('an offer can still be confirmed up to the moment it ends', async () => {
  const prompt = await offer();
  clock = START + minutes(10);

  const reply = await service.component(ALAN, confirmOf(prompt));

  assert.equal(reply.embed.title, 'Voucher purchased');
});

test('if the price changed since the offer, nothing is bought, and the new price is named', async () => {
  const prompt = await offer();
  plans = { monthly: monthly({ price: 80, regular: 100, until: START + minutes(30) }) };

  const reply = await service.component(ALAN, confirmOf(prompt));

  assert.match(reply.text, /price changed to 80 FMC, so nothing was bought/);
  assert.deepEqual(names(), []);
  assert.equal(stored()[0].status, 'expired');
});

test('a sale that ends while the offer is open does not charge the sale price', async () => {
  plans = { monthly: monthly({ price: 80, regular: 100, until: START + minutes(5) }) };
  const prompt = await offer();
  clock = START + minutes(6);

  const reply = await service.component(ALAN, confirmOf(prompt));

  assert.match(reply.text, /price changed to 100 FMC/);
  assert.deepEqual(names(), []);
});

test('if the plan is no longer for sale, nothing is bought', async () => {
  const prompt = await offer();
  plans = {};

  const reply = await service.component(ALAN, confirmOf(prompt));

  assert.match(reply.text, /no longer for sale|not for sale any more/);
  assert.deepEqual(names(), []);
});

test('a new offer replaces the one before it, which can no longer be confirmed', async () => {
  const first = await offer();
  const second = await offer();

  const old = await service.component(ALAN, confirmOf(first));
  const current = await service.component(ALAN, confirmOf(second));

  assert.match(old.text, /no longer valid/);
  assert.equal(current.embed.title, 'Voucher purchased');
  assert.equal(calls.filter(([name]) => name === 'charge').length, 1);
});

test('someone else\'s offer is not replaced by a new offer of yours', async () => {
  const alans = await offer(ALAN);
  await offer(SAM);

  const reply = await service.component(ALAN, confirmOf(alans));

  assert.equal(reply.embed.title, 'Voucher purchased');
});

test('a purchase that is already confirmed is not charged again by another press', async () => {
  const prompt = await offer();
  await service.component(ALAN, confirmOf(prompt));

  const again = await service.component(ALAN, confirmOf(prompt));

  assert.match(again.text, /already confirmed/);
  assert.equal(again.update, true);
  assert.equal(calls.filter(([name]) => name === 'charge').length, 1);
});

test('a refused charge replaces the offer with what went wrong', async () => {
  replies.charge = async () => ({ error: 'Balance insufficient' });
  const prompt = await offer();

  const reply = await service.component(ALAN, confirmOf(prompt));

  assert.equal(reply.text, "You don't have enough FMC for that plan.");
  assert.equal(reply.update, true);
  assert.equal(reply.embed, undefined);
  assert.equal(stored()[0].status, 'failed');
});

test('a purchase that dies after the charge says it will be retried, and is finished on resume', async () => {
  replies.activate = async () => { throw new Error('down'); };
  const prompt = await offer();

  const reply = await service.component(ALAN, confirmOf(prompt));
  replies.activate = async () => ({ code: 'AAAA-BBBB-CCCC' });
  calls = [];
  await service.resume();

  assert.match(reply.text, /retried on its own/);
  assert.equal(reply.update, true);
  assert.equal(stored()[0].status, 'ready');
  assert.equal(names().includes('charge'), true);
});

test('offers that were not confirmed are not listed as vouchers', async () => {
  const kept = await offer(ALAN);
  await offer(ALAN);
  const cancelled = await offer(ALAN);
  await service.component(ALAN, cancelOf(cancelled));

  const reply = await service.run('voucher-mine', ALAN);

  assert.match(reply.text, /haven't bought/);
  assert.ok(kept);
});

test('a button this plugin does not know is answered, and does nothing', async () => {
  ['', 'nothing', 'confirm', 'confirm:', 'refund:abc', undefined].forEach(async (id) => {
    const reply = await service.component(ALAN, id);

    assert.equal(reply.text, 'That button is not available any more.');
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(names(), []);
});

test('offers that ended more than an hour ago are swept away, and nothing else is', async () => {
  const old = await offer(ALAN);
  clock = START + minutes(5);
  const fresh = await offer(SAM);
  const paid = await offer({ discordId: '333', name: 'Kim' });
  await service.component({ discordId: '333', name: 'Kim' }, confirmOf(paid));
  const oldId = confirmOf(old).slice('confirm:'.length);
  const freshId = confirmOf(fresh).slice('confirm:'.length);

  clock = START + minutes(10) + minutes(60) + 1;
  await service.resume();

  const paths = stored().map(item => item.path.split('/')[1]);
  assert.equal(paths.includes(oldId), false);
  assert.equal(paths.includes(freshId), true);
  assert.deepEqual(stored().map(item => item.status).sort(), ['awaiting', 'ready']);
});

test('an offer that has only just ended is kept for a while, so its button can still say so', async () => {
  const prompt = await offer();
  clock = START + minutes(10) + minutes(5);

  await service.resume();

  assert.equal(stored().length, 1);
  const reply = await service.component(ALAN, confirmOf(prompt));
  assert.match(reply.text, /offer ended/);
});

const withProgress = (log = []) => ({
  progress: async (reply) => { log.push(['progress', reply]); },
  log,
});

test('Confirm says it is processing before anything slow starts, and takes the buttons off at once', async () => {
  const events = [];
  replies.reserve = async () => { events.push('reserve'); return { code: 'AAAA-BBBB-CCCC' }; };
  replies.charge = async () => { events.push('charge'); return { status: 'completed' }; };
  replies.activate = async () => { events.push('activate'); return { code: 'AAAA-BBBB-CCCC' }; };
  service = build({ refresh: async () => { events.push('refresh'); } });
  const prompt = await offer();
  events.length = 0;

  await service.component(ALAN, confirmOf(prompt), {
    progress: async () => { events.push('progress'); },
  });

  assert.deepEqual(events, ['progress', 'refresh', 'reserve', 'charge', 'activate']);
});

test('the progress message replaces the offer, with the plan and the price and no buttons', async () => {
  const { progress, log } = withProgress();
  const prompt = await offer();

  await service.component(ALAN, confirmOf(prompt), { progress });

  assert.equal(log.length, 1);
  const reply = log[0][1];
  assert.equal(reply.update, true);
  assert.equal(reply.hidden, true);
  assert.equal(reply.components, undefined);
  assert.equal(reply.embed.title, 'Processing your purchase');
  assert.equal(reply.embed.description, '**Monthly**');
  assert.equal(reply.embed.fields[0].value, '100 FMC');
  assert.match(reply.text, /Processing your Monthly purchase/);
});

test('the result still comes back as its own reply after the progress message', async () => {
  const { progress } = withProgress();
  const prompt = await offer();

  const reply = await service.component(ALAN, confirmOf(prompt), { progress });

  assert.equal(reply.embed.title, 'Voucher purchased');
  assert.equal(reply.update, true);
});

test('nothing starts until the progress message has gone out', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const prompt = await offer();

  const pending = service.component(ALAN, confirmOf(prompt), { progress: () => gate });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(names(), []);
  release();
  await pending;

  assert.deepEqual(names(), ['reserve', 'charge', 'activate']);
});

test('a progress message that cannot be sent is reported and does not stop the purchase', async () => {
  const prompt = await offer();

  const reply = await service.component(ALAN, confirmOf(prompt), {
    progress: async () => { throw new Error('could not send'); },
  });

  assert.equal(reply.embed.title, 'Voucher purchased');
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /could not send/);
});

test('a press that is refused sends no progress message, only the refusal', async () => {
  const prompt = await offer();
  const { progress, log } = withProgress();
  clock = START + minutes(10) + 1;

  const late = await service.component(ALAN, confirmOf(prompt), { progress });
  const stranger = await service.component(SAM, confirmOf(prompt), { progress });
  const nothing = await service.component(ALAN, 'confirm:missing', { progress });

  assert.match(late.text, /offer ended/);
  assert.equal(stranger.text, "That isn't your purchase.");
  assert.equal(nothing.text, "That isn't your purchase.");
  assert.equal(log.length, 0);
});

test('pressing Confirm again after it was pressed sends no second progress message', async () => {
  const prompt = await offer();
  const { progress, log } = withProgress();

  await service.component(ALAN, confirmOf(prompt), { progress });
  const again = await service.component(ALAN, confirmOf(prompt), { progress });

  assert.equal(log.length, 1);
  assert.match(again.text, /already confirmed/);
});

test('if the price changed after the offer, the progress message is replaced by the refusal', async () => {
  const prompt = await offer();
  plans = { monthly: monthly({ price: 80, regular: 100, until: START + minutes(30) }) };
  const { progress, log } = withProgress();

  const reply = await service.component(ALAN, confirmOf(prompt), { progress });

  assert.equal(log.length, 1);
  assert.match(reply.text, /price changed to 80 FMC/);
  assert.equal(reply.update, true);
  assert.deepEqual(names(), []);
});

test('Cancel is quick and sends no progress message', async () => {
  const prompt = await offer();
  const { progress, log } = withProgress();

  const reply = await service.component(ALAN, cancelOf(prompt), { progress });

  assert.equal(reply.text, 'Cancelled. Nothing was taken.');
  assert.equal(log.length, 0);
});

test('a refused charge is a reply after the progress message, not instead of it', async () => {
  replies.charge = async () => ({ error: 'Balance insufficient' });
  const prompt = await offer();
  const { progress, log } = withProgress();

  const reply = await service.component(ALAN, confirmOf(prompt), { progress });

  assert.equal(log.length, 1);
  assert.equal(reply.text, "You don't have enough FMC for that plan.");
  assert.equal(reply.update, true);
});

test('claiming a purchase works once, and only from the state it is in', async () => {
  const made = await store.createPurchase({
    discordId: '1', name: 'A', plan: 'p', label: 'P', type: 't', data: {}, amount: 5, memo: 'm', note: 'n', status: 'awaiting', expiresAt: 1,
  });

  const first = await store.claimPurchase(made.id, 'awaiting', 'pending', { extra: true });
  const second = await store.claimPurchase(made.id, 'awaiting', 'pending');
  const wrong = await store.claimPurchase(made.id, 'awaiting', 'cancelled');

  assert.equal(first.status, 'pending');
  assert.equal(first.extra, true);
  assert.equal(second, null);
  assert.equal(wrong, null);
  assert.equal((await store.getPurchase(made.id)).status, 'pending');
});

test('a purchase that does not exist is null, cannot be claimed, and can be deleted without trouble', async () => {
  assert.equal(await store.getPurchase('nothing'), null);
  assert.equal(await store.claimPurchase('nothing', 'awaiting', 'pending'), null);
  const made = await store.createPurchase({
    discordId: '1', name: 'A', plan: 'p', label: 'P', type: 't', data: {}, amount: 5, memo: 'm', note: 'n',
  });

  await store.deletePurchase(made.id);

  assert.equal(await store.getPurchase(made.id), null);
});

test('a purchase made without a state is pending, and has no end time', async () => {
  const made = await store.createPurchase({
    discordId: '1', name: 'A', plan: 'p', label: 'P', type: 't', data: {}, amount: 5, memo: 'm', note: 'n',
  });

  assert.equal(made.status, 'pending');
  assert.equal('expiresAt' in made, false);
});

test('a private reply can carry buttons, and say that it replaces the message the button was on', () => {
  const msg = { cid: 'connector', uid: '1', data: { interactionId: 'i1' } };
  const components = [{ id: 'go', label: 'Go' }];

  const reply = privateReply({ cid: 'me' }, msg, 'text', { components, update: true });

  assert.deepEqual(reply.data, {
    interactionId: 'i1', discord_components: components, discord_update: true,
  });
});

test('a private reply says nothing about buttons or replacing when it has none', () => {
  const reply = privateReply({ cid: 'me' }, { cid: 'c', uid: '1', data: { interactionId: 'i1' } }, 'text', {});

  assert.deepEqual(reply.data, { interactionId: 'i1' });
});

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { validateCommands } = require('@basedakp48/plugin-utils');
const { buildDefinitions, definitions } = require('../src/commands');
const privateReply = require('../src/reply');

test('the definitions pass the validation plugin-utils applies at startup', () => {
  assert.deepEqual(validateCommands(definitions), []);
});

test('buying and listing your own codes are private, and the plan list is not', () => {
  const privateOnes = Object.keys(definitions).filter(name => definitions[name].private === true);

  assert.deepEqual(privateOnes.sort(), ['voucher-buy', 'voucher-mine']);
});

test('buying takes the plan as its one required argument', () => {
  assert.deepEqual(definitions['voucher-buy'].args.map(arg => [arg.name, arg.required]), [['plan', true]]);
});

const plan = (price, label) => ({
  price, label, type: 'replay', data: {},
});

test('buying offers each configured plan as a choice, named by its label and not its price', () => {
  const offered = buildDefinitions({ monthly: plan(100, 'Monthly'), yearly: plan(1000, 'Yearly') });

  assert.deepEqual(offered['voucher-buy'].args[0].choices, [
    { name: 'Monthly', value: 'monthly' },
    { name: 'Yearly', value: 'yearly' },
  ]);
  assert.deepEqual(validateCommands(offered), []);
});

test('a sale starting or ending does not change the choices, so the commands are not registered again', () => {
  const regular = buildDefinitions({ monthly: plan(100, 'Monthly') });
  const onSale = buildDefinitions({ monthly: { ...plan(80, 'Monthly'), regular: 100, until: 5000 } });

  assert.deepEqual(onSale, regular);
});

test('with no plans, or more than 25, buying offers no choices so any plan name can be typed', () => {
  const many = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`plan-${i}`, plan(1, `Plan ${i}`)]));

  assert.deepEqual(buildDefinitions({})['voucher-buy'].args[0].choices, []);
  assert.deepEqual(buildDefinitions(many)['voucher-buy'].args[0].choices, []);
});

test('exactly 25 plans are all offered', () => {
  const full = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`plan-${i}`, plan(1, `Plan ${i}`)]));

  assert.equal(buildDefinitions(full)['voucher-buy'].args[0].choices.length, 25);
  assert.deepEqual(validateCommands(buildDefinitions(full)), []);
});

test('the other commands and the plain definitions are not changed by the choices', () => {
  const offered = buildDefinitions({ monthly: plan(100, 'Monthly') });

  assert.deepEqual(offered['voucher-plans'], definitions['voucher-plans']);
  assert.deepEqual(offered['voucher-mine'], definitions['voucher-mine']);
  assert.equal('choices' in definitions['voucher-buy'].args[0], false);
});

test('a private reply goes to the person, carrying the interaction id', () => {
  const msg = { cid: 'connector', uid: '1', data: { interactionId: 'int1' } };

  const reply = privateReply({ cid: 'me' }, msg, 'code');

  assert.equal(reply.type, 'private');
  assert.equal(reply.channel, '1');
  assert.deepEqual(reply.data, { interactionId: 'int1' });
});

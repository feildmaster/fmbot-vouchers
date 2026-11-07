const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  contextMenus, groupCommands, subcommandName, validateCommands,
} = require('@basedakp48/plugin-utils');
const { buildDefinitions, definitions } = require('../src/commands');
const privateReply = require('../src/reply');

test('the definitions pass the validation plugin-utils applies at startup', () => {
  assert.deepEqual(validateCommands(definitions), []);
});

test('buying and listing your own codes are private, and the plan list is not', () => {
  const privateOnes = Object.keys(definitions).filter(name => definitions[name].private === true);

  assert.deepEqual(privateOnes.sort(), ['voucher-buy', 'voucher-mine', 'voucheradmin-list']);
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

const named = () => Object.entries(buildDefinitions({}))
  .map(([name, definition]) => ({ name, ...definition }));

test('the three public commands are in the group voucher, as the subcommands buy, mine and plans', () => {
  const { standalone, groups, conflicts } = groupCommands(named());

  const group = groups.find(item => item.name === 'voucher');
  assert.deepEqual(standalone, []);
  assert.deepEqual(conflicts, []);
  assert.equal(group.description, 'Buy and see voucher codes');
  assert.deepEqual(group.subcommands.map(item => item.name).sort(), ['buy', 'mine', 'plans']);
  group.subcommands.forEach(({ command }) => {
    assert.equal(subcommandName(command), command.name.replace('voucher-', ''));
  });
});

test('the group does not change when the plans do', () => {
  const none = buildDefinitions({});
  const some = buildDefinitions({ month: { label: 'Month', price: 1 } });

  Object.keys(none).forEach((name) => {
    assert.equal(some[name].group, none[name].group);
    assert.equal(some[name].groupDescription, none[name].groupDescription);
  });
});

test('the admin command is in a group of its own, so the public group keeps its permissions', () => {
  const { groups } = groupCommands(named());

  const admin = groups.find(item => item.name === 'voucheradmin');
  assert.deepEqual(admin.subcommands.map(item => item.name), ['list']);
  assert.equal(groups.find(item => item.name === 'voucher').subcommands.length, 3);
  ['voucher-plans', 'voucher-buy', 'voucher-mine'].forEach((name) => {
    assert.equal(definitions[name].discord, undefined, name);
  });
});

test('the admin command asks for the user, is hidden from members, and has a right-click menu', () => {
  const admin = definitions['voucheradmin-list'];

  assert.deepEqual(admin.args.map(arg => [arg.name, arg.type, arg.required]), [['user', 'user', true]]);
  assert.deepEqual(admin.discord, { dmPermission: false, defaultMemberPermissions: '32' });
  assert.deepEqual(admin.context, { type: 'user', arg: 'user', name: 'Show vouchers' });
  assert.equal(admin.private, true);
});

test('the right-click menu is the one entry, and runs the admin command', () => {
  const { user, message } = contextMenus(named());

  assert.deepEqual(user.map(item => [item.name, item.command.name, item.arg]), [
    ['Show vouchers', 'voucheradmin-list', 'user'],
  ]);
  assert.deepEqual(message, []);
});

test('a private reply goes to the person, carrying the interaction id', () => {
  const msg = { cid: 'connector', uid: '1', data: { interactionId: 'int1' } };

  const reply = privateReply({ cid: 'me' }, msg, 'code');

  assert.equal(reply.type, 'private');
  assert.equal(reply.channel, '1');
  assert.deepEqual(reply.data, { interactionId: 'int1' });
});

const MAX_CHOICES = 25;
const GROUP = { group: 'voucher', groupDescription: 'Buy and see voucher codes' };
const ADMIN_GROUP = {
  group: 'voucheradmin',
  groupDescription: "Look at other people's vouchers",
};

const definitions = {
  'voucher-plans': {
    ...GROUP,
    description: 'List the plans you can buy a voucher for',
  },
  'voucher-buy': {
    ...GROUP,
    description: 'Buy a voucher code with FMC',
    private: true,
    args: [{
      name: 'plan',
      description: 'Which plan to buy',
      type: 'string',
      required: true,
    }],
  },
  'voucher-mine': {
    ...GROUP,
    description: 'Show the voucher codes you bought',
    private: true,
  },
  'voucheradmin-list': {
    ...ADMIN_GROUP,
    description: 'Show the vouchers a person has bought',
    private: true,
    args: [{
      name: 'user',
      description: 'Whose vouchers',
      type: 'user',
      required: true,
    }],
    context: { type: 'user', arg: 'user', name: 'Show vouchers' },
    discord: { dmPermission: false, defaultMemberPermissions: '32' },
  },
};

function choicesFor(plans) {
  const entries = Object.entries(plans);
  if (!entries.length || entries.length > MAX_CHOICES) return [];
  return entries.map(([key, plan]) => ({ name: plan.label, value: key }));
}

function buildDefinitions(plans) {
  const buy = definitions['voucher-buy'];
  return {
    ...definitions,
    'voucher-buy': {
      ...buy,
      args: buy.args.map(arg => ({ ...arg, choices: choicesFor(plans) })),
    },
  };
}

module.exports = { buildDefinitions, definitions };

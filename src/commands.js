const MAX_CHOICES = 25;

const definitions = {
  'voucher-plans': {
    description: 'List the plans you can buy a voucher for',
  },
  'voucher-buy': {
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
    description: 'Show the voucher codes you bought',
    private: true,
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

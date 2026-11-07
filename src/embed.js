const { fmt } = require('./format');

const DONE_COLOR = 0x57f287;

function purchase({
  label, code, amount, redeemURL,
}) {
  const fields = [
    { name: 'Plan', value: label, inline: true },
    { name: 'Paid', value: `${fmt(amount)} FMC`, inline: true },
  ];
  if (redeemURL) fields.push({ name: 'Redeem it at', value: redeemURL });

  return {
    title: 'Voucher purchased',
    color: DONE_COLOR,
    description: `\`\`\`\n${code}\n\`\`\``,
    fields,
    footer: { text: 'Use /voucher-mine to see your codes again' },
  };
}

module.exports = { purchase };

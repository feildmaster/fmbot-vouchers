const { fmt } = require('./format');

const DONE_COLOR = 0x57f287;
const OFFER_COLOR = 0xfee75c;

const stamp = time => Math.floor(time / 1000);

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

function confirmation({
  label, price, regular, until, expiresAt,
}) {
  const sale = until === undefined
    ? ''
    : ` (usually ${fmt(regular)}, ends <t:${stamp(until)}:R>)`;

  return {
    title: 'Confirm your purchase',
    color: OFFER_COLOR,
    description: `**${label}**`,
    fields: [
      { name: 'Price', value: `${fmt(price)} FMC${sale}`, inline: true },
      { name: 'Offer ends', value: `<t:${stamp(expiresAt)}:R>`, inline: true },
    ],
    footer: { text: 'Your wallet is only charged when you press Confirm' },
  };
}

function processing({ label, price }) {
  return {
    title: 'Processing your purchase',
    color: OFFER_COLOR,
    description: `**${label}**`,
    fields: [{ name: 'Price', value: `${fmt(price)} FMC`, inline: true }],
    footer: { text: 'This takes a few seconds, and this message updates when it is done' },
  };
}

module.exports = { confirmation, processing, purchase };

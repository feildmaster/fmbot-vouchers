const { fmt } = require('./format');

const PROVIDER = 'discord.com';
const PAGE_SIZE = 10;
const COLOR = 0x5865f2;
const RETRY_TEXT = "I couldn't finish your purchase yet. It will be retried on its own, so check voucher-mine in a few minutes before buying again.";

const shown = (text, extra = {}) => ({ text, hidden: false, ...extra });
const hiddenReply = (text, extra = {}) => ({ text, hidden: true, ...extra });

const requestIdOf = purchase => `voucher-${purchase.id}`;
const timeOf = purchase => (purchase.createdAt && purchase.createdAt.toMillis
  ? purchase.createdAt.toMillis()
  : Number(purchase.createdAt) || 0);

function paginate(lines, title) {
  const count = Math.ceil(lines.length / PAGE_SIZE);
  return Array.from({ length: count }, (_, page) => ({
    title,
    color: COLOR,
    description: lines
      .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
      .map(line => `- ${line}`)
      .join('\n'),
  }));
}

function chargeProblem(result) {
  if (!result) return 'The wallet gave no answer';
  if (result.error) return String(result.error);
  return result.status === 'completed' ? '' : `The charge is ${result.status}`;
}

module.exports = function createService({
  store,
  reserve,
  charge,
  activate,
  plans,
  redeemURL,
  linkURL,
  refresh = async () => {},
  now = Date.now,
  onError = console.error,
}) {
  const buying = new Set();
  const settling = new Set();

  const onSale = plan => plan.until !== undefined && now() < plan.until;
  const priceOf = plan => (plan.until !== undefined && !onSale(plan) ? plan.regular : plan.price);

  const notLinked = linkURL
    ? `Your Discord account isn't linked to a wallet yet. Link it here: ${linkURL}`
    : "Your Discord account isn't linked to a wallet yet.";

  const labelOf = plan => (Object.hasOwn(plans(), plan) ? plans()[plan].label : plan);

  async function settle(purchase) {
    settling.add(purchase.id);
    try {
      const requestId = requestIdOf(purchase);
      const reserved = await reserve({ type: purchase.type, data: purchase.data, requestId });
      if (!reserved || reserved.error || typeof reserved.code !== 'string') {
        const reason = reserved && reserved.error ? String(reserved.error) : 'No code was returned';
        await store.setPurchase(purchase.id, { status: 'failed', reason: `Reserve: ${reason}` });
        return { ready: false, error: `Reserve: ${reason}` };
      }
      await store.setPurchase(purchase.id, { code: reserved.code });

      const problem = chargeProblem(await charge({
        uid: `${PROVIDER}:::${purchase.discordId}`,
        amount: purchase.amount,
        requestId,
        memo: purchase.memo,
        extra: { purchaseId: purchase.id, voucherPlan: purchase.plan },
      }));
      if (problem) {
        await store.setPurchase(purchase.id, { status: 'failed', reason: problem });
        return { ready: false, error: problem };
      }

      const activated = await activate({ requestId });
      if (!activated || activated.error) {
        const reason = activated && activated.error ? activated.error : 'no answer';
        throw new Error(`Could not activate the voucher for purchase ${purchase.id}: ${reason}`);
      }
      await store.setPurchase(purchase.id, { status: 'ready' });
      return { ready: true, code: reserved.code };
    } finally {
      settling.delete(purchase.id);
    }
  }

  function refusal(error) {
    switch (error) {
      case 'Balance insufficient': return "You don't have enough FMC for that plan.";
      case 'User not found': return notLinked;
      case 'Invalid wallet': return "You don't have a wallet yet.";
      default:
        onError(new Error(`Unexpected answer while buying a voucher: ${error}`));
        return 'Something went wrong with your purchase, and nothing was taken.';
    }
  }

  const planLine = ([key, plan]) => {
    const line = `${key}: ${plan.label} for ${fmt(priceOf(plan))} FMC`;
    if (!onSale(plan)) return line;
    return `${line} (sale ends <t:${Math.floor(plan.until / 1000)}:R>, normally ${fmt(plan.regular)})`;
  };

  const freshen = () => Promise.resolve().then(refresh).catch(onError);

  async function list() {
    await freshen();
    const lines = Object.entries(plans()).map(planLine);
    if (!lines.length) return shown('No plans are for sale yet.');
    return shown(`Plans you can buy with voucher-buy:\n${lines.join('\n')}`, {
      pages: paginate(lines, 'Voucher plans'),
    });
  }

  async function mine(ctx) {
    const found = (await store.purchasesByUser(ctx.discordId))
      .filter(purchase => purchase.status !== 'failed')
      .sort((a, b) => timeOf(b) - timeOf(a));
    if (!found.length) return hiddenReply("You haven't bought a voucher yet.");

    const lines = found.map((purchase) => {
      const label = labelOf(purchase.plan);
      return purchase.status === 'ready'
        ? `${label}: \`${purchase.code}\``
        : `${label}: still being processed`;
    });
    return hiddenReply(`Your vouchers:\n${lines.join('\n')}`, { pages: paginate(lines, 'Your vouchers') });
  }

  async function buy(ctx, { plan: asked }) {
    const key = String(asked || '').trim().toLowerCase();
    await freshen();
    if (!Object.hasOwn(plans(), key)) {
      const names = Object.keys(plans());
      return hiddenReply(names.length
        ? `There is no plan called "${key}". Use voucher-plans to see them.`
        : 'No plans are for sale yet.');
    }
    if (buying.has(ctx.discordId)) return hiddenReply('Your last purchase is still going through.');

    const entry = plans()[key];
    buying.add(ctx.discordId);
    try {
      const purchase = await store.createPurchase({
        discordId: ctx.discordId,
        name: ctx.name,
        plan: key,
        type: entry.type,
        data: entry.data,
        amount: priceOf(entry),
        memo: `Voucher: ${entry.label}`,
      });

      let outcome;
      try {
        outcome = await settle(purchase);
      } catch (error) {
        onError(error);
        return hiddenReply(RETRY_TEXT);
      }
      if (!outcome.ready) return hiddenReply(refusal(outcome.error));

      const redeem = redeemURL ? ` Redeem it at ${redeemURL}.` : '';
      return hiddenReply(`Here is your ${entry.label} voucher: \`${outcome.code}\`. You paid ${fmt(purchase.amount)} FMC.${redeem} If you lose this message, voucher-mine shows it again.`);
    } finally {
      buying.delete(ctx.discordId);
    }
  }

  const handlers = {
    'voucher-plans': list,
    'voucher-buy': buy,
    'voucher-mine': mine,
  };

  return {
    run: (command, ctx, args = {}) => handlers[command](ctx, args),

    async resume() {
      const pending = (await store.pendingPurchases()).filter(item => !settling.has(item.id));
      await pending.reduce((chain, item) => chain
        .then(() => settle(item))
        .catch(onError), Promise.resolve());
      return pending.length;
    },
  };
};

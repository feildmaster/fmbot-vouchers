const {
  confirmation: confirmationEmbed,
  processing: processingEmbed,
  purchase: purchaseEmbed,
} = require('./embed');
const { fmt } = require('./format');

const PROVIDER = 'discord.com';
const PAGE_SIZE = 10;
const MAX_NOTE = 200;
const COLOR = 0x5865f2;
const OFFER_TTL = 10 * 60 * 1000;
const SWEEP_AFTER = 60 * 60 * 1000;
const RETRY_TEXT = "I couldn't finish your purchase yet. It will be retried on its own, so check voucher-mine in a few minutes before buying again.";
const EXPIRED_TEXT = 'That offer ended, so nothing was bought. Use voucher buy for a new one.';
const GONE_TEXT = 'That offer is no longer valid. Use voucher buy for a new one.';
const DONE_TEXT = 'That purchase was already confirmed. voucher-mine shows your codes.';
const BUTTON = /^(confirm|cancel):(.+)$/;
const SNOWFLAKE = /^\d{15,25}$/;
const SPENT = ['used', 'revoked', 'expired'];
const STATUS_BATCH = 25;
const MAX_CHECKED = 100;
const GONE_HEADING = '**No longer usable**';
const NO_UNUSED = 'You have no unused vouchers.';
const NOT_CHECKED = "_I couldn't check which of these are used right now._";

const shown = (text, extra = {}) => ({ text, hidden: false, ...extra });
const hiddenReply = (text, extra = {}) => ({ text, hidden: true, ...extra });
const update = (text, extra = {}) => ({
  text, hidden: true, update: true, ...extra,
});

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

function paginateRows(rows, title) {
  const pages = [[]];
  rows.forEach((row) => {
    const current = pages[pages.length - 1];
    const room = row.heading ? 2 : 1;
    if (current.length > 0 && current.length + room > PAGE_SIZE) pages.push([row]);
    else current.push(row);
  });
  return pages.map(page => ({
    title,
    color: COLOR,
    description: page.map(row => (row.bullet ? `- ${row.text}` : row.text)).join('\n'),
  }));
}

function maskCode(code) {
  const groups = String(code).split('-');
  if (groups.length < 2) return `${code.slice(0, 4)}${'•'.repeat(Math.max(code.length - 4, 0))}`;
  return [groups[0], ...groups.slice(1).map(group => '•'.repeat(group.length))].join('-');
}

const chunk = (list, size) => Array.from(
  { length: Math.ceil(list.length / size) },
  (_, index) => list.slice(index * size, (index + 1) * size),
);

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
  status = async () => ({ vouchers: {} }),
  isAdmin = () => false,
  refresh = async () => {},
  now = Date.now,
  onError = console.error,
}) {
  const settling = new Set();
  let lastStatusProblem;

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
      const reserved = await reserve({
        type: purchase.type, data: purchase.data, note: purchase.note, requestId,
      });
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

  const findPlan = (asked) => {
    const wanted = String(asked || '').trim().toLowerCase();
    const all = plans();
    if (Object.hasOwn(all, wanted)) return wanted;
    return Object.keys(all).find(key => all[key].label.toLowerCase() === wanted);
  };

  const planLine = (plan) => {
    const line = `${plan.label} for ${fmt(priceOf(plan))} FMC`;
    if (!onSale(plan)) return line;
    return `${line} (sale ends <t:${Math.floor(plan.until / 1000)}:R>, normally ${fmt(plan.regular)})`;
  };

  const freshen = () => Promise.resolve().then(refresh).catch(onError);

  async function list() {
    await freshen();
    const lines = Object.values(plans()).map(planLine);
    if (!lines.length) return shown('No plans are for sale yet.');
    return shown(`Plans you can buy with voucher-buy:\n${lines.join('\n')}`, {
      pages: paginate(lines, 'Voucher plans'),
    });
  }

  async function checkSpent(purchases) {
    const unchecked = purchases
      .filter(purchase => purchase.status === 'ready' && purchase.code && !purchase.spent)
      .slice(0, MAX_CHECKED);
    const codes = [...new Set(unchecked.map(purchase => purchase.code))];
    if (!codes.length) return { spent: new Map(), failed: false };

    try {
      const answers = await Promise.all(chunk(codes, STATUS_BATCH)
        .map(batch => status({ codes: batch })));
      const bad = answers.find(answer => !answer || answer.error || typeof answer.vouchers !== 'object');
      if (bad) {
        const reason = bad && bad.error ? bad.error : 'no answer';
        throw new Error(`The vouchers service could not say which are used: ${reason}`);
      }
      const known = Object.assign({}, ...answers.map(answer => answer.vouchers));

      const spent = new Map();
      unchecked.forEach((purchase) => {
        const answer = known[purchase.code];
        if (answer && SPENT.includes(answer.status)) spent.set(purchase.id, answer.status);
      });
      await Promise.all([...spent].map(([id, state]) => store.setPurchase(id, { spent: state })
        .catch(onError)));
      lastStatusProblem = undefined;
      return { spent, failed: false };
    } catch (error) {
      if (error.message !== lastStatusProblem) onError(error);
      lastStatusProblem = error.message;
      return { spent: new Map(), failed: true };
    }
  }

  async function boughtBy(discordId) {
    return (await store.purchasesByUser(discordId))
      .filter(purchase => ['pending', 'ready'].includes(purchase.status))
      .sort((a, b) => timeOf(b) - timeOf(a));
  }

  async function voucherRows(found, { mask = false } = {}) {
    const { spent, failed } = await checkSpent(found);
    const stateOf = purchase => purchase.spent || spent.get(purchase.id);
    const when = (purchase) => {
      const bought = timeOf(purchase);
      return bought ? ` · bought <t:${Math.floor(bought / 1000)}:d>` : '';
    };
    const labelFor = purchase => purchase.label || labelOf(purchase.plan);
    const codeFor = purchase => (mask ? maskCode(purchase.code) : purchase.code);

    const usable = found.filter(purchase => !stateOf(purchase));
    const gone = found.filter(purchase => stateOf(purchase));
    const rows = [
      ...(usable.length ? [] : [{ text: NO_UNUSED }]),
      ...usable.map(purchase => ({
        bullet: true,
        text: purchase.status === 'ready'
          ? `${labelFor(purchase)}: \`${codeFor(purchase)}\`${when(purchase)}`
          : `${labelFor(purchase)}: still being processed${when(purchase)}`,
      })),
      ...(gone.length ? [{ text: GONE_HEADING, heading: true }] : []),
      ...gone.map(purchase => ({
        bullet: true,
        text: `${labelFor(purchase)} · ${stateOf(purchase)}${when(purchase)}`,
      })),
      ...(failed ? [{ text: NOT_CHECKED }] : []),
    ];
    return rows;
  }

  async function mine(ctx) {
    const found = await boughtBy(ctx.discordId);
    if (!found.length) return hiddenReply("You haven't bought a voucher yet.");

    const rows = await voucherRows(found);
    return hiddenReply(
      `Your vouchers:\n${rows.map(row => row.text).join('\n')}`,
      { pages: paginateRows(rows, 'Your vouchers') },
    );
  }

  async function adminList(ctx, { user }) {
    if (!isAdmin(ctx.discordId)) return hiddenReply('Only admins can do that.');
    const id = String(user === undefined || user === null ? '' : user).trim();
    if (!SNOWFLAKE.test(id)) return hiddenReply('Pick a user from the list.');

    const found = await boughtBy(id);
    if (!found.length) return hiddenReply(`<@${id}> hasn't bought a voucher.`);
    const rows = [
      { text: `Vouchers bought by <@${id}>` },
      ...(await voucherRows(found, { mask: true })),
    ];
    return hiddenReply(
      rows.map(row => row.text).join('\n'),
      { pages: paginateRows(rows, 'Vouchers') },
    );
  }

  async function withdrawOffers(discordId) {
    const open = (await store.purchasesByUser(discordId))
      .filter(purchase => purchase.status === 'awaiting');
    await Promise.all(open.map(purchase => store.claimPurchase(purchase.id, 'awaiting', 'expired')));
  }

  function offer(purchase, entry) {
    const sale = onSale(entry) ? { regular: entry.regular, until: entry.until } : {};
    return hiddenReply(
      `Buy ${purchase.label} for ${fmt(purchase.amount)} FMC? Use the buttons to confirm, or cancel.`,
      {
        embed: confirmationEmbed({
          label: purchase.label, price: purchase.amount, expiresAt: purchase.expiresAt, ...sale,
        }),
        components: [
          { id: `confirm:${purchase.id}`, label: 'Confirm', style: 'success' },
          { id: `cancel:${purchase.id}`, label: 'Cancel' },
        ],
      },
    );
  }

  async function buy(ctx, { plan: asked }) {
    await freshen();
    const key = findPlan(asked);
    if (key === undefined) {
      return hiddenReply(Object.keys(plans()).length
        ? `There is no plan called "${String(asked || '').trim()}". Use voucher-plans to see them.`
        : 'No plans are for sale yet.');
    }

    const entry = plans()[key];
    await withdrawOffers(ctx.discordId);
    const purchase = await store.createPurchase({
      discordId: ctx.discordId,
      name: ctx.name,
      plan: key,
      label: entry.label,
      type: entry.type,
      data: entry.data,
      amount: priceOf(entry),
      memo: `Voucher: ${entry.label}`,
      note: `${entry.label} (${key}) bought by ${ctx.name} (Discord ${ctx.discordId})`.slice(0, MAX_NOTE),
      status: 'awaiting',
      expiresAt: now() + OFFER_TTL,
    });
    return offer(purchase, entry);
  }

  async function openOffer(ctx, id) {
    const purchase = await store.getPurchase(id);
    if (!purchase || purchase.discordId !== ctx.discordId) {
      return { reply: hiddenReply("That isn't your purchase.") };
    }
    if (purchase.status !== 'awaiting') {
      return { reply: update(['pending', 'ready'].includes(purchase.status) ? DONE_TEXT : GONE_TEXT) };
    }
    if (now() > purchase.expiresAt) {
      await store.claimPurchase(id, 'awaiting', 'expired');
      return { reply: update(EXPIRED_TEXT) };
    }
    return { purchase };
  }

  async function confirm(ctx, id, progress) {
    const { purchase, reply } = await openOffer(ctx, id);
    if (reply) return reply;

    await Promise.resolve(progress(update(`Processing your ${purchase.label} purchase…`, {
      embed: processingEmbed({ label: purchase.label, price: purchase.amount }),
    }))).catch(onError);
    await freshen();

    const entry = Object.hasOwn(plans(), purchase.plan) ? plans()[purchase.plan] : undefined;
    if (!entry || priceOf(entry) !== purchase.amount) {
      await store.claimPurchase(id, 'awaiting', 'expired');
      return update(entry
        ? `The price changed to ${fmt(priceOf(entry))} FMC, so nothing was bought. Use voucher buy to see the new offer.`
        : 'That plan is not for sale any more, so nothing was bought.');
    }

    const claimed = await store.claimPurchase(id, 'awaiting', 'pending');
    if (!claimed) return update(DONE_TEXT);

    let outcome;
    try {
      outcome = await settle(claimed);
    } catch (error) {
      onError(error);
      return update(RETRY_TEXT);
    }
    if (!outcome.ready) return update(refusal(outcome.error));

    const redeem = redeemURL ? ` Redeem it at ${redeemURL}.` : '';
    return update(
      `Here is your ${claimed.label} voucher: \`${outcome.code}\`. You paid ${fmt(claimed.amount)} FMC.${redeem} If you lose this message, voucher-mine shows it again.`,
      {
        embed: purchaseEmbed({
          label: claimed.label, code: outcome.code, amount: claimed.amount, redeemURL,
        }),
      },
    );
  }

  async function cancel(ctx, id) {
    const { purchase, reply } = await openOffer(ctx, id);
    if (reply) return reply;
    await store.claimPurchase(purchase.id, 'awaiting', 'cancelled');
    return update('Cancelled. Nothing was taken.');
  }

  async function component(ctx, componentId, { progress = async () => {} } = {}) {
    const match = BUTTON.exec(String(componentId));
    if (!match) return hiddenReply('That button is not available any more.');
    return match[1] === 'confirm' ? confirm(ctx, match[2], progress) : cancel(ctx, match[2]);
  }

  const handlers = {
    'voucher-plans': list,
    'voucher-buy': buy,
    'voucher-mine': mine,
    'voucheradmin-list': adminList,
  };

  return {
    run: (command, ctx, args = {}) => handlers[command](ctx, args),

    component,

    async resume() {
      const pending = (await store.pendingPurchases()).filter(item => !settling.has(item.id));
      await pending.reduce((chain, item) => chain
        .then(() => settle(item))
        .catch(onError), Promise.resolve());

      const stale = (await store.awaitingPurchases())
        .filter(item => now() - (Number(item.expiresAt) || 0) > SWEEP_AFTER);
      await Promise.all(stale.map(item => store.deletePurchase(item.id).catch(onError)));
      return pending.length;
    },
  };
};

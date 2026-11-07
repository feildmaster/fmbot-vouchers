const utils = require('@basedakp48/plugin-utils');
const admin = require('firebase-admin');
const { buildDefinitions, definitions } = require('./src/commands');
const { ADMINS_TEMPLATE, needsAdmins, parseConfig } = require('./src/config');
const buildMenu = require('./src/menu');
const privateReply = require('./src/reply');
const createService = require('./src/service');
const createFetchPlans = require('./src/remotePlans');
const createStore = require('./src/store');
const createReserve = require('./src/vouchers');
const createCharge = require('./src/wallet');

const RESUME_EVERY = 5 * 60 * 1000;
const PLANS_EVERY = 5 * 60 * 1000;
const QUICK_REFRESH = 3000;
const STATUS_TIMEOUT = 3000;

const template = process.env.VOUCHERS_URL;
const vouchers = {
  key: process.env.VOUCHERS_KEY,
  url: template ? name => template.replace('{name}', name.toLowerCase()) : undefined,
};
const reserve = createReserve(vouchers);
const activate = createReserve.createActivate(vouchers);
const status = createReserve.createStatus({ ...vouchers, timeout: STATUS_TIMEOUT });
const charge = createCharge({
  key: process.env.WALLET_VOUCHERS_KEY,
  baseUrl: process.env.WALLET_URL || undefined,
});

const plugin = new utils.Plugin({ dir: __dirname });

const report = error => plugin.sendError(error).then(sent => sent || console.error(error));

const state = {
  configured: {},
  pointers: {},
  admins: new Set(),
  live: undefined,
  published: undefined,
  failing: false,
  ignored: '',
  missing: '',
  refreshing: undefined,
};

const menu = () => buildMenu(state.live, state.pointers, state.configured);

const currentPlans = () => menu().plans;

const ignoredPlans = names => new Error(`Ignored plans that need a short name, then either a whole price in FMC, a valid type that is not credit and data that is an object, or the plan of the plans address they point at: ${names.join(', ')}`);

function reportMissing() {
  const missing = menu().missing.join(', ');
  if (missing === state.missing) return;
  state.missing = missing;
  if (missing) report(new Error(`Not offering plans that point at a plan the plans address does not have: ${missing}`));
}

function publishCommands() {
  reportMissing();
  const offered = buildDefinitions(currentPlans());
  const serialized = JSON.stringify(offered);
  if (serialized === state.published) return;
  state.published = serialized;
  plugin.defaultCommands(offered);
}

const plansURL = process.env.PLANS_URL;
const only = (process.env.PLANS_ONLY || '').split(',').map(name => name.trim()).filter(Boolean);
const fetchPlans = plansURL ? createFetchPlans({ url: plansURL, only }) : undefined;
const fetchQuickly = plansURL
  ? createFetchPlans({ url: plansURL, only, timeout: QUICK_REFRESH })
  : undefined;

async function refreshPlans(fetcher = fetchPlans) {
  try {
    const { plans: live, rejected } = await fetcher();
    state.live = live;
    state.failing = false;
    const ignored = rejected.join(', ');
    if (ignored !== state.ignored) {
      state.ignored = ignored;
      if (rejected.length) report(ignoredPlans(rejected));
    }
    publishCommands();
  } catch (error) {
    if (!state.failing) report(error);
    state.failing = true;
  }
}

function refreshNow() {
  if (!fetchQuickly) return Promise.resolve();
  if (!state.refreshing) {
    state.refreshing = refreshPlans(fetchQuickly).then(() => {
      state.refreshing = undefined;
    });
  }
  return state.refreshing;
}

plugin.on('config', (config) => {
  if (needsAdmins(config)) plugin.config.child('admins').set(ADMINS_TEMPLATE).catch(report);
  const parsed = parseConfig(config);
  state.configured = parsed.plans;
  state.pointers = parsed.pointers;
  state.admins = parsed.admins;
  if (parsed.rejected.length) report(ignoredPlans(parsed.rejected));
  if (parsed.rejectedAdmins.length) {
    const entries = parsed.rejectedAdmins.map(entry => JSON.stringify(entry)).join(', ');
    report(new Error(`Ignored admins that are not Discord IDs written as text: ${entries}`));
  }
  publishCommands();
});

if (fetchPlans) {
  refreshPlans();
  setInterval(refreshPlans, PLANS_EVERY).unref();
}

const service = createService({
  store: createStore({ db: admin.firestore(), FieldValue: admin.firestore.FieldValue }),
  reserve,
  charge,
  activate,
  status,
  isAdmin: discordId => typeof discordId === 'string' && state.admins.has(discordId),
  plans: currentPlans,
  refresh: refreshNow,
  redeemURL: process.env.VOUCHER_REDEEM_URL,
  linkURL: process.env.WALLET_LINK_URL,
  onError: report,
});

plugin.presenceSystem().on('connect', () => {
  service.resume().catch(report);
});
setInterval(() => service.resume().catch(report), RESUME_EVERY).unref();
plugin.defaultCommands(definitions);

function answer(msg, {
  text, hidden, embed, pages, components, update,
}) {
  const system = plugin.messageSystem();
  if (hidden) {
    return system.sendMessage(privateReply(plugin, msg, text, {
      embed, pages, components, update,
    }));
  }
  const data = {};
  if (embed) data.discord_embed = embed;
  if (pages) data.discord_pages = pages;
  if (components) data.discord_components = components;
  return system.sendText(text, msg, Object.keys(data).length ? data : undefined);
}

const contextOf = msg => ({ discordId: msg.uid, name: msg.data.nick || msg.uid });

plugin.onComponent((msg) => {
  if (msg.data.connectorType !== 'discord') return;
  service.component(contextOf(msg), msg.data.componentId, {
    progress: reply => answer(msg, reply),
  })
    .then(reply => answer(msg, reply))
    .catch(report);
});

plugin.messageSystem().on('message/command', (msg) => {
  if (!msg.data || msg.data.connectorType !== 'discord') return;
  if (!Object.hasOwn(definitions, msg.data.command)) return;

  service.run(msg.data.command, contextOf(msg), msg.data.args)
    .then(reply => answer(msg, reply))
    .catch(report);
});

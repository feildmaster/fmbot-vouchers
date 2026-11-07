const KEY = /^[a-z0-9-]{1,32}$/;
const SNOWFLAKE = /^\d{15,25}$/;
const TYPE = /^[a-z][a-z0-9-]{0,31}$/;
const DEFAULT_TYPE = 'replay';
const MAX_LABEL = 60;
const MAX_DATA = 4000;

const positive = value => Number.isSafeInteger(value) && value > 0;
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const asList = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return [value];
  if (isObject(value)) return Object.values(value);
  return [];
};

const ADMINS_TEMPLATE = ['<placeholder>'];

const needsAdmins = config => !isObject(config) || config.admins === undefined;

function parseAdmins(value) {
  const admins = new Set();
  const rejectedAdmins = [];
  asList(value).forEach((entry) => {
    const id = typeof entry === 'string' ? entry.trim() : undefined;
    if (id && SNOWFLAKE.test(id)) admins.add(id);
    else if (!ADMINS_TEMPLATE.includes(id)) rejectedAdmins.push(entry);
  });
  return { admins, rejectedAdmins };
}

function parsePlan(plan) {
  if (!isObject(plan)) return undefined;
  const price = Number(plan.price);
  const type = plan.type === undefined ? DEFAULT_TYPE : plan.type;
  const data = plan.data === undefined ? {} : plan.data;
  const label = typeof plan.label === 'string' ? plan.label.trim().slice(0, MAX_LABEL) : '';
  if (!positive(price)) return undefined;
  if (typeof type !== 'string' || !TYPE.test(type) || type === 'credit') return undefined;
  if (!isObject(data) || JSON.stringify(data).length > MAX_DATA) return undefined;
  return {
    price, type, data, label,
  };
}

function parsePointer(entry) {
  if (!isObject(entry) || typeof entry.plan !== 'string' || entry.price !== undefined) return undefined;
  const plan = entry.plan.trim().toLowerCase();
  const label = typeof entry.label === 'string' ? entry.label.trim().slice(0, MAX_LABEL) : '';
  return KEY.test(plan) ? { plan, label } : undefined;
}

const isPointer = entry => isObject(entry) && typeof entry.plan === 'string' && entry.price === undefined;

function parseConfig(config) {
  const source = config && typeof config === 'object' ? config : {};
  const entries = isObject(source.plans) ? Object.entries(source.plans) : [];

  const plans = {};
  const pointers = {};
  const rejected = [];
  entries.forEach(([name, entry]) => {
    const key = name.trim().toLowerCase();
    const taken = Object.hasOwn(plans, key) || Object.hasOwn(pointers, key);
    if (isPointer(entry)) {
      const pointer = parsePointer(entry);
      if (!KEY.test(key) || !pointer || taken) rejected.push(name);
      else pointers[key] = pointer;
      return;
    }
    const parsed = parsePlan(entry);
    if (!KEY.test(key) || !parsed || taken) {
      rejected.push(name);
      return;
    }
    plans[key] = { ...parsed, label: parsed.label || key };
  });

  return {
    plans, pointers, rejected, ...parseAdmins(source.admins),
  };
}

module.exports = { ADMINS_TEMPLATE, needsAdmins, parseConfig };

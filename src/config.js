const KEY = /^[a-z0-9-]{1,32}$/;
const TYPE = /^[a-z][a-z0-9-]{0,31}$/;
const DEFAULT_TYPE = 'replay';
const MAX_LABEL = 60;
const MAX_DATA = 4000;

const positive = value => Number.isSafeInteger(value) && value > 0;
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

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

function parseConfig(config) {
  const source = config && typeof config === 'object' ? config : {};
  const entries = isObject(source.plans) ? Object.entries(source.plans) : [];

  const plans = {};
  const rejected = [];
  entries.forEach(([name, plan]) => {
    const key = name.trim().toLowerCase();
    const parsed = parsePlan(plan);
    if (!KEY.test(key) || !parsed || Object.hasOwn(plans, key)) {
      rejected.push(name);
      return;
    }
    plans[key] = { ...parsed, label: parsed.label || key };
  });

  return { plans, rejected };
}

module.exports = { parseConfig };

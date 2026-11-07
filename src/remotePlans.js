const { parseConfig } = require('./config');

const CURRENCY = 'FMC';
const TIMEOUT = 10000;

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const positive = value => Number.isSafeInteger(value) && value > 0;

function saleOf(sale, amount) {
  if (!isObject(sale) || !positive(sale.amount) || !positive(amount)) return undefined;
  if (sale.amount >= amount || !Number.isFinite(sale.until)) return undefined;
  return { regular: amount, until: sale.until };
}

function fromRemote(body, only) {
  const foreign = [];
  const plans = {};
  const sales = new Map();
  Object.entries(body).forEach(([name, entry]) => {
    const key = name.trim().toLowerCase();
    if (only && !only.includes(key)) return;
    if (!isObject(entry)) {
      plans[name] = entry;
      return;
    }
    const {
      amount, price, sale, currency, label, type, ...data
    } = entry;
    if (currency !== undefined && currency !== CURRENCY) {
      foreign.push(name);
      return;
    }
    const onSale = saleOf(sale, amount);
    if (onSale) sales.set(key, onSale);
    plans[name] = {
      price: price === undefined ? amount : price,
      label,
      type,
      data: { plan: key, ...data },
    };
  });

  const parsed = parseConfig({ plans });
  const decorated = Object.fromEntries(Object.entries(parsed.plans)
    .map(([key, plan]) => [key, sales.has(key) ? { ...plan, ...sales.get(key) } : plan]));
  return { plans: decorated, rejected: [...foreign, ...parsed.rejected] };
}

module.exports = function createFetchPlans({
  url,
  only,
  fetch: request = fetch,
  timeout = TIMEOUT,
}) {
  if (!url) throw new Error('A plans address is required');
  const allowed = Array.isArray(only) && only.length
    ? only.map(name => String(name).trim().toLowerCase())
    : undefined;

  return async function fetchPlans() {
    const response = await request(url, { signal: AbortSignal.timeout(timeout) });
    if (response.status !== 200) throw new Error(`The plans address answered ${response.status}`);
    const body = await response.json();
    if (!isObject(body)) throw new Error('The plans address did not answer with an object of plans');
    return fromRemote(body, allowed);
  };
};

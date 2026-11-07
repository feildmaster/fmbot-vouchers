const crypto = require('crypto');

const TIMEOUT = 10000;

const defaultUrl = name => `https://vouchers-${name.toLowerCase()}-esvpmf7qta-uc.a.run.app`;

const createCall = (name, fields) => function createVoucherCall({
  key,
  url = defaultUrl,
  fetch: request = fetch,
  timeout = TIMEOUT,
}) {
  if (!key) throw new Error('A voucher key is required');

  return async function call(input) {
    const body = JSON.stringify(fields(input));
    const signature = crypto.createHmac('sha256', key).update(body).digest('hex');
    const response = await request(url(name), {
      method: 'POST',
      headers: { 'content-type': 'application/json', http_x_signature: signature },
      body,
      signal: AbortSignal.timeout(timeout),
    });
    if (response.status >= 500) throw new Error(`The vouchers service answered ${response.status}`);
    return response.json();
  };
};

const createReserve = createCall('clientCreate', ({
  type, data, note, requestId,
}) => ({
  type, data, note, requestId,
}));

createReserve.createActivate = createCall('clientActivate', ({ requestId }) => ({ requestId }));
createReserve.createStatus = createCall('clientStatus', ({ codes }) => ({ codes }));

module.exports = createReserve;

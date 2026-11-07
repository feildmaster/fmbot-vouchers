const crypto = require('crypto');

const DEFAULT_URL = 'https://us-central1-feildbase.cloudfunctions.net';
const TIMEOUT = 10000;

module.exports = createCharge;
module.exports.DEFAULT_URL = DEFAULT_URL;

function createCharge({
  key,
  baseUrl = DEFAULT_URL,
  fetch: request = fetch,
  timeout = TIMEOUT,
}) {
  if (!key) throw new Error('A wallet key is required');

  return async function charge({
    uid, amount, requestId, memo, extra,
  }) {
    const body = JSON.stringify({
      uid, amount, currency: 'FMC', memo, requestId, extra,
    });
    const signature = crypto.createHmac('sha256', key).update(body).digest('hex');
    const response = await request(`${baseUrl}/wallet-charge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', http_x_signature: signature },
      body,
      signal: AbortSignal.timeout(timeout),
    });
    if (response.status >= 500) throw new Error(`The wallet answered ${response.status}`);
    return response.json();
  };
}

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');

const createCharge = require('../src/wallet');

const request = {
  uid: 'discord.com:::1',
  amount: 100,
  requestId: 'voucher-abc12345',
  memo: 'Voucher: Monthly',
  extra: { purchaseId: 'abc12345', voucherPlan: 'monthly' },
};

const fakeFetch = (payload, status = 200) => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return { status, json: async () => payload };
  };
  return { fetch, calls };
};

test('it posts the charge, signed with the key, to the charge endpoint', async () => {
  const { fetch, calls } = fakeFetch({ id: 'tx1', status: 'completed' });
  const charge = createCharge({ key: 'secret', url: 'https://wallet.test/charge', fetch });

  assert.deepEqual(await charge(request), { id: 'tx1', status: 'completed' });

  const [{ url, options }] = calls;
  assert.equal(url, 'https://wallet.test/charge');
  assert.deepEqual(JSON.parse(options.body), { ...request, currency: 'FMC' });
  assert.equal(
    options.headers.http_x_signature,
    crypto.createHmac('sha256', 'secret').update(options.body).digest('hex'),
  );
});

test('a refusal from the wallet is data, and a server error is thrown to be retried', async () => {
  const refusal = fakeFetch({ error: 'Balance insufficient' });
  const broken = fakeFetch({ error: 'Failed' }, 500);

  assert.deepEqual(await createCharge({ key: 'k', fetch: refusal.fetch })(request), { error: 'Balance insufficient' });
  await assert.rejects(createCharge({ key: 'k', fetch: broken.fetch })(request), /answered 500/);
});

test('it refuses to start without a key', () => {
  assert.throws(() => createCharge({}), /key is required/);
});

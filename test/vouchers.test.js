const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');

const createReserve = require('../src/vouchers');

const fakeFetch = (payload, status = 200) => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return { status, json: async () => payload };
  };
  return { fetch, calls };
};

test('a reservation is signed with the key and sends only what the service accepts', async () => {
  const { fetch, calls } = fakeFetch({ code: 'AAAA-BBBB-CCCC' });
  const reserve = createReserve({ key: 'secret', fetch });

  const reply = await reserve({
    type: 'replay', data: { plan: 'monthly' }, requestId: 'voucher-abc12345', uses: 99,
  });

  assert.deepEqual(reply, { code: 'AAAA-BBBB-CCCC' });
  const [{ url, options }] = calls;
  assert.equal(url, 'https://vouchers-clientcreate-esvpmf7qta-uc.a.run.app');
  assert.deepEqual(JSON.parse(options.body), {
    type: 'replay', data: { plan: 'monthly' }, requestId: 'voucher-abc12345',
  });
  assert.equal(
    options.headers.http_x_signature,
    crypto.createHmac('sha256', 'secret').update(options.body).digest('hex'),
  );
});

test('an activation posts only the request id to its own endpoint', async () => {
  const { fetch, calls } = fakeFetch({ code: 'AAAA-BBBB-CCCC' });
  const activate = createReserve.createActivate({ key: 'k', fetch });

  await activate({ requestId: 'voucher-abc12345', type: 'replay' });

  assert.equal(calls[0].url, 'https://vouchers-clientactivate-esvpmf7qta-uc.a.run.app');
  assert.deepEqual(JSON.parse(calls[0].options.body), { requestId: 'voucher-abc12345' });
});

test('the address can be replaced, and a server error is thrown to be retried', async () => {
  const { fetch, calls } = fakeFetch({}, 500);
  const reserve = createReserve({ key: 'k', fetch, url: name => `https://vouchers.test/${name}` });

  await assert.rejects(reserve({ requestId: 'voucher-abc12345' }), /answered 500/);
  assert.equal(calls[0].url, 'https://vouchers.test/clientCreate');
});

test('a refusal is data, and both calls refuse to start without a key', async () => {
  const { fetch } = fakeFetch({ error: 'Invalid request' });

  assert.deepEqual(await createReserve({ key: 'k', fetch })({}), { error: 'Invalid request' });
  assert.throws(() => createReserve({}), /key is required/);
  assert.throws(() => createReserve.createActivate({}), /key is required/);
});

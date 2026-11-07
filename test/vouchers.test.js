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
    type: 'replay', data: { plan: 'monthly' }, note: 'Bought by Alan', requestId: 'voucher-abc12345', uses: 99,
  });

  assert.deepEqual(reply, { code: 'AAAA-BBBB-CCCC' });
  const [{ url, options }] = calls;
  assert.equal(url, 'https://vouchers-clientcreate-esvpmf7qta-uc.a.run.app');
  assert.deepEqual(JSON.parse(options.body), {
    type: 'replay', data: { plan: 'monthly' }, note: 'Bought by Alan', requestId: 'voucher-abc12345',
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

test('a status check posts only the codes, signed, to its own endpoint, and gets the answer back', async () => {
  const answer = { vouchers: { 'AAAA-BBBB-CCCC': { status: 'used', used: 1, uses: 1 } } };
  const { fetch, calls } = fakeFetch(answer);
  const status = createReserve.createStatus({ key: 'secret', fetch });

  const reply = await status({ codes: ['AAAA-BBBB-CCCC'], requestId: 'ignored' });

  assert.deepEqual(reply, answer);
  assert.equal(calls[0].url, 'https://vouchers-clientstatus-esvpmf7qta-uc.a.run.app');
  assert.deepEqual(JSON.parse(calls[0].options.body), { codes: ['AAAA-BBBB-CCCC'] });
  assert.equal(
    calls[0].options.headers.http_x_signature,
    crypto.createHmac('sha256', 'secret').update(calls[0].options.body).digest('hex'),
  );
});

test('a status check gives up after its own timeout, and the address can be replaced for it too', async () => {
  const { fetch, calls } = fakeFetch({}, 503);
  const status = createReserve.createStatus({
    key: 'k', fetch, timeout: 1000, url: name => `https://vouchers.test/${name}`,
  });

  await assert.rejects(status({ codes: ['x'] }), /answered 503/);
  assert.equal(calls[0].url, 'https://vouchers.test/clientStatus');
  assert.ok(calls[0].options.signal);
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
  assert.throws(() => createReserve.createStatus({}), /key is required/);
});

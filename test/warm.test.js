const assert = require('node:assert/strict');
const { test } = require('node:test');

const createWarm = require('../src/warm');

test('sends one unsigned request to every address', async () => {
  const sent = [];
  const warm = createWarm({
    urls: ['https://a.example/one', 'https://b.example/two'],
    fetch: async (url, options) => {
      sent.push([url, options.method, options.headers.http_x_signature]);
      return { status: 401 };
    },
  });

  await warm();

  assert.deepEqual(sent, [
    ['https://a.example/one', 'POST', undefined],
    ['https://b.example/two', 'POST', undefined],
  ]);
});

test('never throws, and still reaches the others when one fails', async () => {
  const sent = [];
  const warm = createWarm({
    urls: ['https://a.example/one', 'https://b.example/two'],
    fetch: async (url) => {
      sent.push(url);
      if (url.includes('one')) throw new Error('down');
      return { status: 401 };
    },
  });

  await warm();

  assert.equal(sent.length, 2);
});

test('gives up on a request after the timeout', async () => {
  const warm = createWarm({
    urls: ['https://a.example/one'],
    timeout: 10,
    fetch: (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }),
  });

  await warm();
});

const TIMEOUT = 10000;

module.exports = function createWarm({ urls, fetch: request = fetch, timeout = TIMEOUT }) {
  return async function warm() {
    await Promise.allSettled(urls.map(url => request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(timeout),
    })));
  };
};

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('content sends only the normal bundle and Black Market purchase parameters', async () => {
  const source = await fs.readFile(new URL('../content.js', import.meta.url), 'utf8');
  const requests = [];
  let listener;
  const chrome = {
    runtime: {
      id: 'extension-id',
      onMessage: { addListener: fn => { listener = fn; } },
      sendMessage: () => Promise.resolve()
    }
  };
  const context = {
    chrome,
    AbortSignal,
    fetch: async (path, options) => {
      requests.push({ path, options });
      return {
        ok: true,
        status: 200,
        json: async () => path === '/api/identity' ? { user: { id: 'account-1' } } : {}
      };
    }
  };
  vm.runInNewContext(source, context);
  const send = message => new Promise(resolve => {
    assert.equal(listener(message, { id: 'extension-id' }, resolve), true);
  });

  await send({ type: 'SITE_BLACK_MARKET' });
  assert.equal(requests.at(-1).path, '/api/black-market');
  assert.equal(requests.at(-1).options.credentials, 'same-origin');

  await send({ type: 'SITE_BUY', accountId: 'account-1', purchase: { item: 'bundle', qty: 1, slot: 12, requestId: 'bundle-request' } });
  const bundleRequest = requests.at(-1);
  assert.equal(bundleRequest.path, '/api/shop/buy');
  assert.equal(bundleRequest.options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(bundleRequest.options.body), {
    item: 'bundle', qty: 1, slot: 12, proto: 2, force: false, requestId: 'bundle-request'
  });

  const beforeInvalidBundle = requests.length;
  const invalid = await send({ type: 'SITE_BUY', accountId: 'account-1', purchase: { item: 'bundle', qty: 2, slot: 12, requestId: 'bad-bundle' } });
  assert.equal(invalid.status, 400);
  assert.equal(requests.length, beforeInvalidBundle + 1, 'invalid bundle is rejected after identity validation, before purchase');

  await send({ type: 'SITE_BUY_BLACK_MARKET', accountId: 'account-1', purchase: { item: 'market_item', requestId: 'market-request' } });
  const blackMarketRequest = requests.at(-1);
  assert.equal(blackMarketRequest.path, '/api/black-market/buy');
  assert.equal(blackMarketRequest.options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(blackMarketRequest.options.body), {
    item: 'market_item', force: false, requestId: 'market-request'
  });
});

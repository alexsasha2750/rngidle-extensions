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

test('content sends Glitch trial and purchase requests exactly like the game, and refuses bad input', async () => {
  const source = await fs.readFile(new URL('../content.js', import.meta.url), 'utf8');
  const requests = [];
  let listener, account = 'account-1';
  const context = {
    chrome: { runtime: { id: 'extension-id', onMessage: { addListener: fn => { listener = fn; } }, sendMessage: () => Promise.resolve() } },
    AbortSignal,
    fetch: async (path, options) => {
      requests.push({ path, options });
      return { ok: true, status: 200, json: async () => path === '/api/identity' ? { user: { id: account } } : {} };
    }
  };
  vm.runInNewContext(source, context);
  const send = message => new Promise(resolve => {
    assert.equal(listener(message, { id: 'extension-id' }, resolve), true);
  });
  const body = request => JSON.parse(request.options.body);

  await send({ type: 'SITE_GLITCH' });
  assert.equal(requests.at(-1).path, '/api/glitch');
  assert.equal(requests.at(-1).options.method, 'GET');
  assert.equal(requests.at(-1).options.credentials, 'same-origin');

  await send({ type: 'SITE_GLITCH_TRIAL', item: 'glitch' });
  assert.equal(requests.at(-1).path, '/api/glitch/trial');
  assert.deepEqual(body(requests.at(-1)), { item: 'glitch' });

  await send({ type: 'SITE_GLITCH_ANSWER', id: 'trial-q1', answer: '42' });
  assert.equal(requests.at(-1).path, '/api/glitch/trial/answer');
  assert.deepEqual(body(requests.at(-1)), { id: 'trial-q1', answer: '42' });
  await send({ type: 'SITE_GLITCH_ANSWER', id: 7, answer: '' });
  assert.deepEqual(body(requests.at(-1)), { id: 7, answer: '' }, 'ids keep their original type; an empty answer closes a late trial');

  await send({ type: 'SITE_GLITCH_BUY', accountId: 'account-1', purchase: { item: 'glitch', trial: 'passed-1', requestId: 'req-1' } });
  assert.equal(requests.at(-1).path, '/api/glitch/buy');
  assert.deepEqual(body(requests.at(-1)), { item: 'glitch', trial: 'passed-1', force: false, requestId: 'req-1' });

  const before = requests.length;
  for (const bad of [
    { type: 'SITE_GLITCH_TRIAL', item: '../admin' }, { type: 'SITE_GLITCH_TRIAL', item: 5 },
    { type: 'SITE_GLITCH_ANSWER', id: {}, answer: 'x' }, { type: 'SITE_GLITCH_ANSWER', id: 'q', answer: 'x'.repeat(201) },
    { type: 'SITE_GLITCH_ANSWER', id: 'q', answer: { a: 1 } },
  ]) {
    assert.equal((await send(bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal(requests.length, before, 'invalid Glitch requests never reach the network');

  const invalidBuy = await send({ type: 'SITE_GLITCH_BUY', accountId: 'account-1', purchase: { item: 'glitch', trial: '', requestId: 'r' } });
  assert.equal(invalidBuy.status, 400);
  assert.equal(requests.at(-1).path, '/api/identity', 'an invalid purchase stops after the identity check');

  account = 'someone-else';
  const switched = await send({ type: 'SITE_GLITCH_BUY', accountId: 'account-1', purchase: { item: 'glitch', trial: 'passed-1', requestId: 'req-2' } });
  assert.equal(switched.ok, false);
  assert.equal(switched.status, 409, 'an account switch is a clean refusal, not a retryable failure');
  assert.equal(requests.at(-1).path, '/api/identity');
});

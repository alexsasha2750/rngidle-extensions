import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('background buys eligible selections safely and recovers a lost response', async () => {
  const catalog = JSON.parse(await fs.readFile(new URL('../catalog.json', import.meta.url)));
  const version = JSON.parse(await fs.readFile(new URL('../catalog-version.json', import.meta.url)));
  const a = catalog.find(item => item.id === 'luck_1');
  const b = catalog.find(item => item.id === 'luck_2');
  let account = 'account-1', openTab = true, lost = false, mismatch = false, rejectRetry = false;
  let walletFromInventory = false;
  let requests = [], completed = new Map();
  let shop = { open: true, slot: 10, reroll: 0, wallet: { effective: 1000000 }, items: [
    { id: a.id, left: 10, perPlayer: 10, bought: 0 },
    { id: b.id, left: 10, perPlayer: 10, bought: 0 }
  ] };
  const clone = value => structuredClone(value);
  const data = { settings: { enabled: true, rules: [
    { uid: 'a', id: a.id, quantity: 2, mode: 'once' },
    { uid: 'b', id: b.id, quantity: 1, mode: 'restock' }
  ] } };
  const events = {};
  const event = name => ({ addListener: fn => { events[name] = fn; } });
  globalThis.chrome = {
    runtime: { getURL: value => value, onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message') },
    alarms: { get: async () => ({}), create: async () => {}, onAlarm: event('alarm') },
    storage: { local: {
      get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(k => k in data).map(k => [k, clone(data[k])])),
      set: async values => Object.assign(data, clone(values)),
      remove: async key => { delete data[key]; }
    } },
    tabs: {
      query: async () => openTab ? [{ id: 1 }] : [],
      sendMessage: async (_tab, message) => {
        if (message.type === 'SITE_IDENTITY') return { ok: true, data: { user: { id: account } } };
        if (message.type === 'SITE_SHOP') {
          const result = clone(shop);
          if (walletFromInventory) delete result.wallet;
          return { ok: true, data: result };
        }
        if (message.type === 'SITE_INVENTORY') return { ok: true, data: { wallet: clone(shop.wallet) } };
        if (message.type === 'SITE_CATALOG_HASH') return { ok: true, data: mismatch ? 'different' : version.sha256 };
        if (message.type === 'SITE_BUY') {
          const p = message.purchase;
          requests.push(clone(p));
          if (rejectRetry && completed.has(p.requestId)) return { ok: false, status: 409, error: 'expired request' };
          if (!completed.has(p.requestId)) {
            const offer = shop.items.find(item => item.id === p.item);
            offer.bought += p.qty;
            offer.left -= p.qty;
            shop.wallet.effective -= catalog.find(item => item.id === p.item).price * p.qty;
            completed.set(p.requestId, { ok: true, data: {} });
          }
          if (lost) { lost = false; return { ok: false, error: 'connection lost' }; }
          return completed.get(p.requestId);
        }
        throw new Error(`Unexpected ${message.type}`);
      }
    }
  };
  globalThis.fetch = async url => ({ json: async () => url === 'catalog.json' ? catalog : version });
  await import('../background.js');
  const check = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Background did not respond')), 3000);
    events.message({ type: 'SETTINGS_CHANGED' }, {}, result => { clearTimeout(timer); resolve(result); });
  });
  await check();
  assert.equal(requests.length, 2, 'both available selections are bought in one check');
  assert.equal(data.progress.a.status, 'complete');
  assert.equal(data.progress.b.status, 'purchased');
  assert.equal(data.pendingPurchase, undefined);
  await check();
  assert.equal(requests.length, 2, 'no repeated purchase in the same shop');
  shop.slot++; shop.items.forEach(item => { item.bought = 0; item.left = 10; });
  walletFromInventory = true;
  lost = true;
  await check();
  assert.ok(data.pendingPurchase, 'lost response retains request ID');
  const id = data.pendingPurchase.requestId;
  assert.equal(requests.length, 3);
  await check();
  assert.equal(requests.at(-1).requestId, id, 'retry uses same ID');
  assert.equal(completed.size, 3, 'retry does not add a duplicate purchase');
  assert.equal(data.pendingPurchase, undefined);
  shop.slot++; account = 'account-2';
  await check();
  assert.match(data.runStatus.message, /different account/i);
  assert.equal(requests.length, 4);
  account = 'account-1'; mismatch = true;
  await check();
  assert.match(data.runStatus.message, /updated its shop catalogue/i);
  assert.equal(requests.length, 4);
  data.settings.enabled = false; mismatch = false;
  await check();
  assert.equal(data.runStatus.state, 'paused');
  assert.equal(requests.length, 4);
  data.settings.enabled = true; openTab = false;
  await check();
  assert.equal(data.runStatus.gameTabOpen, false);
  assert.equal(requests.length, 4);
  openTab = true;
  shop.slot++;
  lost = true;
  await check();
  assert.ok(data.pendingPurchase);
  rejectRetry = true;
  await check();
  assert.equal(data.progress.b.status, 'uncertain');
  assert.equal(data.pendingPurchase, undefined);
  shop.slot++;
  const attempted = requests.length;
  await check();
  assert.equal(requests.length, attempted, 'unknown outcomes stop recurring purchases until rearmed');
});

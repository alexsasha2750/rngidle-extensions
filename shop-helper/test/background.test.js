import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('background buys eligible selections safely and recovers a lost response', async () => {
  const catalog = JSON.parse(await fs.readFile(new URL('../catalog.json', import.meta.url)));
  const version = JSON.parse(await fs.readFile(new URL('../catalog-version.json', import.meta.url)));
  const blackCatalog = [{ id: 'market_item', name: 'Market Item', price: 75 }];
  const a = catalog.find(item => item.id === 'luck_1');
  const b = catalog.find(item => item.id === 'luck_2');
  let account = 'account-1', openTab = true, lost = false, mismatch = false, rejectRetry = false;
  let walletFromInventory = false, removeRemainingBundles = false;
  let requests = [], completed = new Map();
  let market = { open: true, slot: 90, wallet: { effective: 500 }, items: [
    { id: 'market_item', price: 75, left: 1, bought: false }
  ] };
  let blackRequests = [], blackCompleted = new Map(), loseBlackResponse = false;
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
    scripting: { executeScript: async request => {
      assert.equal(request.world, 'MAIN');
      assert.deepEqual(request.args, ['1+2i+3j+4k']);
      // Runs the real in-page function, with the game's engine swapped for globalThis.fakeGameEngine.
      const source = String(request.func);
      assert.ok(source.includes("import('/engine.js')"));
      const func = (0, eval)(`(${source.replace("import('/engine.js')", 'Promise.resolve(globalThis.fakeGameEngine)')})`);
      return [{ result: await func(...request.args) }];
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
        if (message.type === 'SITE_BLACK_MARKET') return { ok: true, data: clone(market) };
        if (message.type === 'SITE_INVENTORY') return { ok: true, data: { wallet: clone(shop.wallet) } };
        if (message.type === 'SITE_CATALOG_HASH') return { ok: true, data: mismatch ? 'different' : version.sha256 };
        if (message.type === 'SITE_BUY') {
          const p = message.purchase;
          requests.push(clone(p));
          if (rejectRetry && completed.has(p.requestId)) return { ok: false, status: 409, error: 'expired request' };
          if (!completed.has(p.requestId)) {
            if (p.item === 'bundle') {
              shop.bundle.bought++;
              shop.bundle.left--;
              if (removeRemainingBundles) shop.bundle.left = 0;
              shop.wallet.effective -= shop.bundle.price;
            } else {
              const offer = shop.items.find(item => item.id === p.item);
              offer.bought += p.qty;
              offer.left -= p.qty;
              shop.wallet.effective -= catalog.find(item => item.id === p.item).price * p.qty;
            }
            completed.set(p.requestId, { ok: true, data: {} });
          }
          if (lost) { lost = false; return { ok: false, error: 'connection lost' }; }
          return completed.get(p.requestId);
        }
        if (message.type === 'SITE_BUY_BLACK_MARKET') {
          const p = message.purchase;
          blackRequests.push(clone(p));
          if (!blackCompleted.has(p.requestId)) {
            const offer = market.items.find(item => item.id === p.item);
            offer.bought = true;
            offer.left = 0;
            market.wallet.effective -= offer.price;
            blackCompleted.set(p.requestId, { ok: true, data: {} });
          }
          if (loseBlackResponse) { loseBlackResponse = false; return { ok: false, error: 'connection lost' }; }
          return blackCompleted.get(p.requestId);
        }
        throw new Error(`Unexpected ${message.type}`);
      }
    }
  };
  globalThis.fetch = async url => ({
    ok: true,
    json: async () => url === 'catalog.json' ? catalog : url === 'catalog-version.json' ? version : blackCatalog
  });
  await import('../background.js');
  const check = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Background did not respond')), 3000);
    events.message({ type: 'SETTINGS_CHANGED' }, {}, result => { clearTimeout(timer); resolve(result); });
  });
  await check();
  assert.equal(requests.length, 2, 'both available selections are bought in one check');
  assert.equal(blackRequests.length, 0, 'legacy settings do not enable Black Market purchases');
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

  data.settings.rules = [{ uid: 'bundle-rule', id: 'bundle', quantity: 1000, mode: 'restock' }];
  shop.slot++;
  shop.bundle = { left: 3, bought: 0, price: 100 };
  const beforeBundles = requests.length;
  await check();
  assert.equal(requests.length, beforeBundles + 3, 'bundle rule buys no more than the three per-shop limit');
  assert.ok(requests.slice(beforeBundles).every(p => p.item === 'bundle' && p.qty === 1));
  assert.equal(shop.bundle.left, 0);
  assert.equal(data.progress['bundle-rule'].slotBought, 3);
  await check();
  assert.equal(requests.length, beforeBundles + 3, 'bundle rule does not repeat in the same shop');
  data.settings.rules = [{ uid: 'partial-bundle', id: 'bundle', quantity: 1000, mode: 'once' }];
  shop.slot++;
  shop.bundle = { left: 2, bought: 0, price: 100 };
  removeRemainingBundles = true;
  await check();
  assert.equal(data.progress['partial-bundle'].status, 'complete', 'a partial one-time bundle purchase completes if stock runs out');
  assert.equal(data.progress['partial-bundle'].totalBought, 1);

  data.settings.rules = [];
  data.settings.blackMarket = {
    enabled: true, mostExpensive: false, selectedOnly: true, itemIds: ['market_item'],
    minimumEnabled: true, minimumPrice: 75
  };
  const walletBeforeBlackPurchase = market.wallet.effective;
  loseBlackResponse = true;
  await check();
  assert.equal(blackRequests.length, 1);
  assert.ok(data.pendingPurchase, 'lost Black Market response retains its request ID');
  assert.equal(data.pendingPurchase.kind, 'blackMarket');
  const blackRequestId = data.pendingPurchase.requestId;
  await check();
  assert.equal(blackRequests.length, 2);
  assert.equal(blackRequests.at(-1).requestId, blackRequestId, 'Black Market retry reuses the original ID');
  assert.equal(blackCompleted.size, 1, 'retry does not repeat the Black Market charge');
  assert.equal(market.wallet.effective, walletBeforeBlackPurchase - 75);
  assert.equal(data.pendingPurchase, undefined);
  const rarityCalls = [];
  const composeRollResult = number => ({ number, totalScore: 42, badges: [{ id: 'A', label: 'Example', emoji: '✦', score: 42, isScoring: true }] });
  globalThis.fakeGameEngine = {
    composeRollResult,
    getCardRarityTier: (...args) => { rarityCalls.push(args); return 'cosmic_horror'; },
    RARITY_PALETTE: { cosmic_horror: { pill: { label: 'COSMIC HORROR' } } },
  };
  const checkNumber = () => new Promise(resolve => events.message({ type: 'CHECK_NUMBER', number: ' 1+2i+3j+4k ' }, {}, resolve));
  const preview = await checkNumber();
  assert.equal(preview.ok, true);
  assert.equal(preview.result.number, '1+2i+3j+4k');
  assert.equal(preview.result.totalScore, 42);
  assert.deepEqual(preview.result.rarity, { tier: 'cosmic_horror', label: 'Cosmic Horror' }, 'the reply carries the game’s own rarity');
  assert.deepEqual(rarityCalls, [[42, '1+2i+3j+4k']], 'rarity is asked for with the roll’s score and number');
  globalThis.fakeGameEngine = { composeRollResult, getCardRarityTier: () => 'transcendant' };
  assert.deepEqual((await checkNumber()).result.rarity, { tier: 'transcendent', label: 'Transcendent' }, 'the old spelling is normalised and labelled from the tier');
  globalThis.fakeGameEngine = { composeRollResult };
  const withoutRarity = await checkNumber();
  assert.equal(withoutRarity.ok, true, 'an engine without rarity still checks numbers');
  assert.equal(withoutRarity.result.rarity, null);
  assert.equal(withoutRarity.result.totalScore, 42);
  for (const getCardRarityTier of [() => { throw new Error('boom'); }, () => 'x" onclick="', () => undefined]) {
    globalThis.fakeGameEngine = { composeRollResult, getCardRarityTier };
    const reply = await checkNumber();
    assert.equal(reply.ok, true);
    assert.equal(reply.result.rarity, null, 'a failing or odd rarity is dropped');
  }
  globalThis.fakeGameEngine = { composeRollResult, getCardRarityTier: () => 'epic', RARITY_PALETTE: { epic: { pill: { label: 'E'.repeat(41) } } } };
  assert.deepEqual((await checkNumber()).result.rarity, { tier: 'epic', label: 'Epic' }, 'an overlong label falls back to the tier name');
  const empty = await new Promise(resolve => events.message({ type: 'CHECK_NUMBER', number: '  ' }, {}, resolve));
  assert.equal(empty.ok, false);
  const tooLong = await new Promise(resolve => events.message({ type: 'CHECK_NUMBER', number: '1'.repeat(251) }, {}, resolve));
  assert.equal(tooLong.ok, false);
  assert.equal(blackCompleted.size, 1, 'a number preview never makes a purchase');
  data.progress['blackMarket:uncertain-item'] = { status: 'uncertain', lastSlot: '89:0' };
  const clear = () => new Promise(resolve => events.message({ type: 'CLEAR_BLACK_MARKET_UNCERTAINTY' }, {}, resolve));
  assert.equal((await clear()).ok, false, 'cannot clear uncertain purchases while automation is enabled');
  data.settings.enabled = false;
  assert.deepEqual(await clear(), { ok: true, cleared: 1 });
  assert.equal(data.progress['blackMarket:uncertain-item'], undefined);
  assert.equal(data.progress['blackMarket:deal'].lastSlot, '90:0', 'clearing preserves the per-market deal guard');
});

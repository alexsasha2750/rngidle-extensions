// The background worker's spending cap, dry run, history, announcements, Black Market watch and
// market status, driven through a scripted game tab. Each test loads a fresh copy of the worker.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { localDay } from '../safety.js';

const catalog = JSON.parse(await fs.readFile(new URL('../catalog.json', import.meta.url)));
const version = JSON.parse(await fs.readFile(new URL('../catalog-version.json', import.meta.url)));
const blackCatalog = [{ id: 'market_item', name: 'Market Item', price: 75 }, { id: 'other_item', name: 'Other Item', price: 50 }];
const priceOf = id => catalog.find(item => item.id === id).price;
const clone = value => (value === undefined ? undefined : structuredClone(value));
const ruleA = { uid: 'a', id: 'luck_3', quantity: 3, mode: 'once' };
const ruleB = { uid: 'b', id: 'luck_2', quantity: 2, mode: 'restock' };
const facts = entry => ({ source: entry.source, result: entry.result, item: entry.item, name: entry.name, qty: entry.qty, price: entry.price, total: entry.total });
let instance = 0;

function area(store, writes) {
  return {
    get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in store).map(key => [key, clone(store[key])])),
    set: async values => { writes?.push(...Object.keys(values)); Object.assign(store, clone(values)); },
    remove: async keys => { for (const key of [].concat(keys)) delete store[key]; },
  };
}

async function waitFor(predicate, ms = 3000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > ms) throw new Error('Timed out waiting');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

async function boot({ storage = {}, session = true } = {}) {
  const data = clone(storage);
  const sessionStore = {};
  const writes = [];
  const sent = [];
  const notifications = [];
  const cleared = [];
  const focused = [];
  const world = {
    account: 'account-1',
    tabs: [{ id: 1, windowId: 7, active: true }],
    shop: { open: true, slot: 10, reroll: 0, wallet: { effective: 10_000_000 }, items: [
      { id: 'luck_3', left: 10, perPlayer: 10, bought: 0 },
      { id: 'luck_2', left: 10, perPlayer: 10, bought: 0 },
      { id: 'luck_4', left: 10, perPlayer: 10, bought: 0 },
    ] },
    market: { open: true, slot: 90, wallet: { effective: 10_000 }, items: [
      { id: 'market_item', price: 75, left: 1, bought: false },
      { id: 'other_item', price: 40, left: 1, bought: false },
    ] },
    // Per message type: a reply, or a function returning one.
    replies: {},
    completed: new Map(),
  };
  const events = {};
  const event = name => ({ addListener: fn => { events[name] = fn; } });
  function answer(message) {
    const override = world.replies[message.type];
    if (override) return typeof override === 'function' ? override(message) : clone(override);
    switch (message.type) {
      case 'SITE_IDENTITY': return { ok: true, data: { user: world.account ? { id: world.account } : null } };
      case 'SITE_SHOP': return { ok: true, data: clone(world.shop) };
      case 'SITE_BLACK_MARKET': return { ok: true, data: clone(world.market) };
      case 'SITE_INVENTORY': return { ok: true, data: { wallet: clone(world.shop.wallet) } };
      case 'SITE_CATALOG_HASH': return { ok: true, data: version.sha256 };
      case 'SITE_BUY': {
        const p = message.purchase;
        if (!world.completed.has(p.requestId)) {
          if (p.item === 'bundle') {
            world.shop.bundle.bought++;
            world.shop.bundle.left--;
            world.shop.wallet.effective -= world.shop.bundle.price;
          } else {
            const offer = world.shop.items.find(item => item.id === p.item);
            offer.bought += p.qty;
            offer.left -= p.qty;
            world.shop.wallet.effective -= priceOf(p.item) * p.qty;
          }
          world.completed.set(p.requestId, { ok: true, data: {} });
        }
        return world.completed.get(p.requestId);
      }
      case 'SITE_BUY_BLACK_MARKET': {
        const offer = world.market.items.find(item => item.id === message.purchase.item);
        offer.bought = true;
        offer.left = 0;
        return { ok: true, data: {} };
      }
      case 'HELPER_SOUND': case 'HELPER_FLASH': return undefined;
      default: throw new Error(`Unexpected ${message.type}`);
    }
  }
  globalThis.chrome = {
    runtime: { getURL: value => value, onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message') },
    alarms: { get: async () => ({}), create: async () => {}, onAlarm: event('alarm') },
    storage: { local: area(data, writes), ...(session ? { session: area(sessionStore) } : {}) },
    notifications: {
      create: async (id, options) => { notifications.push({ id, ...options }); return id; },
      clear: async id => { cleared.push(id); },
      onClicked: event('notificationClick'),
    },
    windows: { update: async (id, info) => { focused.push(['window', id, info]); } },
    tabs: {
      query: async () => clone(world.tabs),
      update: async (id, info) => { focused.push(['tab', id, info]); },
      sendMessage: async (_tab, message) => { sent.push(clone(message)); return answer(message); },
    },
  };
  const files = { 'catalog.json': catalog, 'catalog-version.json': version, 'black-catalog.json': blackCatalog, 'glitch-catalog.json': [] };
  globalThis.fetch = async url => ({ ok: true, json: async () => clone(files[url]) });
  await import(`../background.js?instance=${++instance}`);
  const send = message => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No reply to ${message.type}`)), 4000);
    events.message(message, {}, value => { clearTimeout(timer); resolve(value); });
  });
  return {
    data, sessionStore, writes, sent, notifications, cleared, focused, world, events, send,
    sentOf: type => sent.filter(message => message.type === type),
    check: () => send({ type: 'SETTINGS_CHANGED' }),
    alarm: name => events.alarm({ name }),
  };
}

test('a dry run never sends, saves or spends anything, and logs each would-buy once per shop', async () => {
  const h = await boot({ storage: {
    settings: { enabled: true, rules: [ruleA, ruleB], safety: { dryRun: true } },
    dryRunSeen: { a: '9:0', ghost: '1:0' },
    uiPrefs: { channels: { desktop: true, sound: true }, events: { purchase: true } },
  } });
  await h.check();
  assert.equal(h.sentOf('SITE_BUY').length, 0, 'no purchase request');
  for (const key of ['pendingPurchase', 'progress', 'spend']) assert.ok(!h.writes.includes(key), `${key} is never written`);
  assert.deepEqual(h.data.history.map(facts), [
    { source: 'shop', result: 'dryrun', item: 'luck_3', name: 'Luck Potion III', qty: 3, price: 250000, total: 750000 },
    { source: 'shop', result: 'dryrun', item: 'luck_2', name: 'Luck Potion II', qty: 2, price: 50000, total: 100000 },
  ]);
  assert.deepEqual(h.data.activity.map(entry => entry.message), ['Dry run: would buy 3 × Luck Potion III.', 'Dry run: would buy 2 × Luck Potion II.']);
  assert.deepEqual([h.data.runStatus.state, h.data.runStatus.message], ['watching', 'Dry run: would have bought 2 item(s) — nothing was spent.']);
  assert.deepEqual(h.data.dryRunSeen, { a: '10:0', b: '10:0' }, 'markers from earlier shops are pruned');
  assert.deepEqual(h.notifications.map(note => [note.title, note.message]), [
    ['Dry run: would buy 3 × Luck Potion III', "Would spend 750K EP · Glim's shop · nothing was spent"],
    ['Dry run: would buy 2 × Luck Potion II', "Would spend 100K EP · Glim's shop · nothing was spent"],
  ]);
  assert.deepEqual(h.sentOf('HELPER_SOUND').map(message => message.name), ['success', 'success']);

  await h.check();
  assert.equal(h.data.history.length, 2, 'the same shop is not simulated again');
  assert.match(h.data.runStatus.message, /^Dry run \(nothing is bought\): Watching for selected items/);

  h.data.settings.safety.dryRun = false;
  await h.check();
  assert.deepEqual(h.sentOf('SITE_BUY').map(message => [message.purchase.item, message.purchase.qty]), [['luck_3', 3], ['luck_2', 2]],
    'turning the dry run off buys in the same shop straight away');
  assert.equal(h.data.progress.a.status, 'complete');
  assert.equal(h.data.dryRunSeen, undefined);
  assert.deepEqual(h.data.history.slice(2).map(entry => entry.result), ['bought', 'bought']);
  assert.equal(h.data.spend.dayTotal, 850000);
});

test('a dry run on the Black Market simulates one deal per visit', async () => {
  const h = await boot({ storage: { settings: { enabled: true, rules: [], blackMarket: { enabled: true }, safety: { dryRun: true } } } });
  await h.check();
  assert.equal(h.sentOf('SITE_BUY_BLACK_MARKET').length, 0);
  assert.deepEqual(h.data.history.map(entry => [entry.result, entry.source, entry.item, entry.price]), [['dryrun', 'black', 'market_item', 75]]);
  assert.deepEqual(h.data.dryRunSeen, { 'blackMarket:market_item': '90:0' });
  assert.equal(h.data.progress, undefined);
  assert.equal(h.data.runStatus.message, 'Dry run: would have bought 1 item(s) — nothing was spent.');
  await h.check();
  assert.equal(h.data.history.length, 1);
  h.world.market.slot = 91;
  await h.check();
  assert.equal(h.data.history.length, 2);
  assert.deepEqual(h.data.dryRunSeen, { 'blackMarket:market_item': '91:0' });
});

test('a purchase already sent is still retried for real during a dry run', async () => {
  const pendingPurchase = {
    uid: 'a', item: 'luck_3', name: 'Luck Potion III', qty: 1, price: 250000, ruleQuantity: 1, mode: 'once',
    key: '10:0', slot: 10, accountId: 'account-1', requestId: 'req-old',
  };
  const h = await boot({ storage: {
    settings: { enabled: true, rules: [{ ...ruleA, quantity: 1 }, ruleB], safety: { dryRun: true } }, boundAccount: 'account-1', pendingPurchase,
  } });
  await h.check();
  assert.deepEqual(h.sentOf('SITE_BUY').map(message => message.purchase.requestId), ['req-old']);
  assert.equal(h.data.pendingPurchase, undefined);
  assert.equal(h.data.progress.a.status, 'complete');
  assert.equal(h.data.spend.dayTotal, 250000);
  assert.deepEqual(h.data.history.map(entry => [entry.result, entry.item]), [['bought', 'luck_3'], ['dryrun', 'luck_2']]);
  assert.equal(h.data.runStatus.message, 'Dry run: would have bought 1 item(s) — nothing was spent.');
});

test('a daily cap limits quantities, blames itself only when it blocked something, and resets at midnight', async () => {
  const h = await boot({ storage: {
    settings: { enabled: true, rules: [ruleA, { ...ruleB, quantity: 5 }], safety: { cap: { enabled: true, amount: 600000, period: 'day' } } },
  } });
  await h.check();
  assert.deepEqual(h.sentOf('SITE_BUY').map(message => [message.purchase.item, message.purchase.qty, message.purchase.price]),
    [['luck_3', 2, 250000], ['luck_2', 2, 50000]]);
  assert.deepEqual({ ...h.data.spend, session: typeof h.data.spend.session },
    { day: localDay(Date.now()), dayTotal: 600000, session: 'string', sessionTotal: 600000 });
  assert.equal(h.data.runStatus.state, 'watching');
  assert.doesNotMatch(h.data.runStatus.message, /Spending limit/, 'nothing else was eligible, so the cap is not blamed');

  h.world.shop.slot = 11;
  await h.check();
  assert.equal(h.sentOf('SITE_BUY').length, 2);
  assert.equal(h.data.runStatus.state, 'waiting');
  assert.equal(h.data.runStatus.message, 'Spending limit reached (600K of 600K EP today, resets at midnight). Nothing more will be bought until then.');
  assert.equal(h.data.runStatus.capReached, true);

  h.world.shop.open = false;
  await h.check();
  assert.match(h.data.runStatus.message, /shop is closed/);

  h.world.shop.open = true;
  h.data.spend.day = '2000-01-01';
  await h.check();
  assert.deepEqual(h.sentOf('SITE_BUY').slice(2).map(message => [message.purchase.item, message.purchase.qty]), [['luck_2', 5]]);
  assert.equal(h.data.spend.dayTotal, 250000);
  assert.equal(h.data.spend.sessionTotal, 850000);
});

test('a dry run respects the cap it would run into', async () => {
  const h = await boot({ storage: { settings: {
    enabled: true, rules: [ruleA, { uid: 'c', id: 'luck_4', quantity: 1, mode: 'once' }],
    safety: { dryRun: true, cap: { enabled: true, amount: 600000 } },
  } } });
  await h.check();
  assert.deepEqual(h.data.history.map(entry => [entry.item, entry.qty]), [['luck_3', 2]]);
  assert.equal(h.data.runStatus.message, 'Dry run: would have bought 1 item(s) — nothing was spent. The spending limit would stop anything more.');
  assert.equal(h.data.spend, undefined);
});

test('a session cap resets with the browser session, including the storage.local fallback', async () => {
  for (const session of [true, false]) {
    const h = await boot({ session, storage: {
      settings: { enabled: true, rules: [{ ...ruleB, quantity: 5 }], safety: { cap: { enabled: true, amount: 100000, period: 'session' } } },
    } });
    const store = session ? h.sessionStore : h.data;
    await h.check();
    assert.deepEqual(h.sentOf('SITE_BUY').map(message => message.purchase.qty), [2]);
    const first = store.sessionId;
    assert.equal(typeof first, 'string');
    assert.equal(h.data.spend.session, first);
    h.world.shop.slot = 11;
    await h.check();
    assert.equal(h.sentOf('SITE_BUY').length, 1);
    assert.equal(h.data.runStatus.message,
      'Spending limit reached (100K of 100K EP this browser session, resets when the browser restarts). Nothing more will be bought until then.');
    if (session) delete h.sessionStore.sessionId; // what the browser does to session storage on restart
    h.events.startup();
    await waitFor(() => h.sentOf('SITE_BUY').length === 2);
    await h.check();
    assert.notEqual(store.sessionId, first, `a new session (${session ? 'storage.session' : 'fallback'})`);
    assert.equal(h.data.spend.sessionTotal, 100000);
    assert.equal(h.data.spend.dayTotal, 200000);
  }
});

test('the cap also holds back Black Market deals', async () => {
  const h = await boot({ storage: { settings: {
    enabled: true, rules: [], blackMarket: { enabled: true, selectedOnly: true, itemIds: ['market_item'] }, safety: { cap: { enabled: true, amount: 50 } },
  } } });
  await h.check();
  assert.equal(h.sentOf('SITE_BUY_BLACK_MARKET').length, 0);
  assert.equal(h.data.runStatus.state, 'waiting');
  assert.match(h.data.runStatus.message, /^Spending limit reached \(0 of 50 EP today/);
  h.data.settings.safety.cap.amount = 100;
  await h.check();
  assert.equal(h.sentOf('SITE_BUY_BLACK_MARKET').length, 1);
  assert.equal(h.data.spend.dayTotal, 75);
});

test('switching on a dry run while a purchase is being prepared stops that purchase', async () => {
  const h = await boot({ storage: { settings: { enabled: true, rules: [ruleA] } } });
  h.world.replies.SITE_CATALOG_HASH = () => {
    h.data.settings.safety = { dryRun: true };
    return { ok: true, data: version.sha256 };
  };
  await h.check();
  assert.equal(h.sentOf('SITE_BUY').length, 0);
  assert.equal(h.data.pendingPurchase, undefined);
  assert.match(h.data.runStatus.message, /Settings changed before the next purchase/);
});

test('auto-buy results go into the history and are announced on the picked channels', async () => {
  const h = await boot({ storage: {
    settings: { enabled: true, rules: [{ ...ruleA, quantity: 2 }] },
    uiPrefs: { channels: { desktop: true, sound: true, titleFlash: true }, events: { purchase: true } },
  } });
  await h.check();
  assert.deepEqual(h.data.history.map(facts), [
    { source: 'shop', result: 'bought', item: 'luck_3', name: 'Luck Potion III', qty: 2, price: 250000, total: 500000 },
  ]);
  assert.equal(h.notifications.length, 1);
  assert.match(h.notifications[0].id, /^rngidle-purchase-\d+$/);
  assert.deepEqual({ ...h.notifications[0], id: undefined }, {
    id: undefined, type: 'basic', iconUrl: 'icons/icon-128.png', title: 'Bought 2 × Luck Potion III', message: "Spent 500K EP · Glim's shop",
  });
  assert.deepEqual(h.sentOf('HELPER_SOUND'), [{ type: 'HELPER_SOUND', name: 'success', volume: 0.5 }]);
  assert.deepEqual(h.sentOf('HELPER_FLASH'), [{ type: 'HELPER_FLASH', text: 'Bought 2 × Luck Potion III' }]);
  assert.deepEqual(h.data.activity.map(entry => entry.message), ['Bought 2 × Luck Potion III.'], 'the activity log is unchanged');

  h.data.settings.rules = [{ uid: 'c', id: 'luck_4', quantity: 1, mode: 'once' }];
  h.world.replies.SITE_BUY = { ok: false, status: 409, error: 'Sold out' };
  await h.check();
  const declined = h.data.history.at(-1);
  assert.deepEqual([declined.result, declined.item, declined.price, declined.message], ['declined', 'luck_4', 1000000, 'Purchase declined: Sold out']);
  assert.equal(h.notifications.at(-1).title, 'Purchase declined: Luck Potion IV');
  assert.equal(h.sentOf('HELPER_SOUND').at(-1).name, 'fail');

  h.data.settings.rules = [{ uid: 'd', id: 'luck_2', quantity: 1, mode: 'once' }];
  h.world.replies.SITE_BUY = { ok: false, error: 'connection lost' };
  const logged = h.data.history.length;
  await h.check();
  assert.ok(h.data.pendingPurchase);
  assert.equal(h.data.pendingPurchase.price, 50000, 'pending purchases carry their price');
  assert.equal(h.data.history.length, logged, 'a lost reply is not final, so it is not logged');
  h.world.replies.SITE_BUY = { ok: false, status: 409, error: 'expired request' };
  await h.check();
  const uncertain = h.data.history.at(-1);
  assert.deepEqual([uncertain.result, uncertain.item, uncertain.price], ['uncertain', 'luck_2', 50000]);
  assert.match(h.notifications.at(-1).message, /Check your inventory/);
  assert.equal(h.sentOf('HELPER_SOUND').at(-1).name, 'fail');
  assert.equal(h.data.spend.dayTotal, 500000, 'only successful purchases count toward the cap');

  h.data.uiPrefs.events.purchase = false;
  h.data.settings.rules = [{ uid: 'e', id: 'luck_2', quantity: 1, mode: 'once' }];
  delete h.world.replies.SITE_BUY;
  const announced = h.notifications.length;
  await h.check();
  assert.equal(h.data.history.at(-1).result, 'bought');
  assert.equal(h.notifications.length, announced, 'purchases are not announced when the player turned them off');
});

test('bundles and Black Market deals have their own history source; an old pending purchase without a price is not counted', async () => {
  const h = await boot({ storage: { settings: {
    enabled: true, rules: [{ uid: 'bundle-rule', id: 'bundle', quantity: 1, mode: 'restock' }],
    blackMarket: { enabled: true, selectedOnly: true, itemIds: ['market_item'] },
  } } });
  h.world.shop.bundle = { left: 3, bought: 0, price: 100 };
  await h.check();
  assert.deepEqual(h.data.history.map(entry => [entry.source, entry.item, entry.name, entry.qty, entry.price]),
    [['bundle', 'bundle', 'Glim bundle', 1, 100], ['black', 'market_item', 'Market Item', 1, 75]]);
  assert.equal(h.data.spend.dayTotal, 175);

  h.data.settings.rules.push({ uid: 'old', id: 'luck_2', quantity: 1, mode: 'once' });
  h.data.pendingPurchase = {
    uid: 'old', item: 'luck_2', name: 'Luck Potion II', qty: 1, ruleQuantity: 1, mode: 'once', key: '10:0', slot: 10,
    accountId: 'account-1', requestId: 'old-req',
  };
  await h.check();
  assert.equal(h.data.progress.old.status, 'complete');
  assert.equal(h.data.spend.dayTotal, 175, 'an unknown price is not counted');
  assert.deepEqual(facts(h.data.history.at(-1)),
    { source: 'shop', result: 'bought', item: 'luck_2', name: 'Luck Potion II', qty: 1, price: null, total: null });
});

test('clicking a notification focuses the game tab, and opens the Glitch tab for Glitch alerts', async () => {
  const h = await boot();
  await h.events.notificationClick('rngidle-glitch-1');
  assert.deepEqual(h.focused, [['tab', 1, { active: true }], ['window', 7, { focused: true }]]);
  assert.deepEqual([h.data.uiTab, h.data.uiOpen], ['glitch', true]);
  assert.deepEqual(h.cleared, ['rngidle-glitch-1']);
  delete h.data.uiTab;
  delete h.data.uiOpen;
  await h.events.notificationClick('rngidle-purchase-2');
  assert.equal(h.data.uiTab, undefined);
  assert.equal(h.focused.length, 4);
  await h.events.notificationClick('another-extension-3');
  assert.deepEqual(h.cleared, ['rngidle-glitch-1', 'rngidle-purchase-2']);
  assert.equal(h.focused.length, 4);
});

test('the Black Market watch announces each visit once, only while auto-buy is not buying there', async () => {
  const h = await boot({ storage: {
    settings: { enabled: false, rules: [], blackMarket: { enabled: false, selectedOnly: true, itemIds: ['market_item'] } },
    uiPrefs: { channels: { desktop: true }, events: { black: true } },
  } });
  delete h.world.market.wallet;
  const notes = () => h.notifications.filter(note => note.id.startsWith('rngidle-black-'));
  await h.alarm('check-shop');
  assert.deepEqual(notes().map(note => [note.title, note.message]), [['Black Market has a match', 'Market Item (75 EP)']]);
  assert.deepEqual(h.data.blackAlert, { key: '90:0', ids: ['market_item'] });
  assert.equal(h.sentOf('SITE_INVENTORY').length, 0, 'no wallet is needed to watch');

  await h.alarm('check-shop');
  assert.equal(notes().length, 1, 'one announcement per visit');
  h.data.settings.blackMarket.itemIds.push('other_item');
  await h.alarm('check-shop');
  assert.equal(notes().length, 2, 'a new match during the visit is announced');
  assert.equal(notes()[1].message, 'Market Item (75 EP), Other Item (40 EP)');
  assert.deepEqual(h.data.blackAlert.ids, ['market_item', 'other_item']);
  h.world.market.items[0].bought = true;
  await h.alarm('check-shop');
  assert.equal(notes().length, 2, 'fewer matches is not news');

  h.world.market.open = false;
  await h.alarm('check-shop');
  assert.equal(h.data.blackAlert, undefined, 'cleared when the market closes');
  h.world.market = { open: true, slot: 91, items: [{ id: 'market_item', price: 80, left: 1, bought: false }] };
  await h.alarm('check-shop');
  assert.equal(notes().length, 3, 'the next visit is announced');

  h.data.settings = { enabled: true, rules: [], blackMarket: { enabled: true, selectedOnly: true, itemIds: ['other_item'] } };
  h.world.market = { open: true, slot: 92, wallet: { effective: 1000 }, items: [{ id: 'market_item', price: 80, left: 1, bought: false }] };
  await h.alarm('check-shop');
  assert.equal(notes().length, 3, 'auto-buy owns the Black Market, so the watch stays out');
  assert.equal(h.data.blackAlert.key, '91:0');

  h.data.settings = { enabled: false, rules: [], blackMarket: { enabled: false } };
  h.data.uiPrefs.events.black = false;
  const loads = h.sentOf('SITE_BLACK_MARKET').length;
  await h.alarm('check-shop');
  assert.equal(h.sentOf('SITE_BLACK_MARKET').length, loads, 'the event is off: no requests');
  assert.equal(h.sentOf('SITE_BUY_BLACK_MARKET').length, 0);
});

test('MARKET_STATUS reports both markets and the wallet, and degrades per endpoint', async () => {
  const h = await boot();
  h.world.tabs = [];
  assert.deepEqual(await h.send({ type: 'MARKET_STATUS' }), { ok: true, tab: { open: false, signedIn: false }, wallet: null, shop: null, black: null });

  h.world.tabs = [{ id: 1, windowId: 7 }];
  Object.assign(h.world.shop, { endsAt: 5000, now: 4000, eaten: false });
  Object.assign(h.world.market, { dealt: true, endsAt: 9000, now: 4000 });
  h.world.market.items.push({ id: 'bad id' }, null);
  assert.deepEqual(await h.send({ type: 'MARKET_STATUS' }), {
    ok: true, tab: { open: true, signedIn: true }, wallet: 10_000_000,
    shop: { open: true, eaten: false, endsAt: 5000, now: 4000 },
    black: { open: true, dealt: true, eaten: false, endsAt: 9000, now: 4000, items: [
      { id: 'market_item', price: 75, left: 1, bought: false }, { id: 'other_item', price: 40, left: 1, bought: false },
    ] },
  });

  h.world.replies.SITE_SHOP = { ok: false, status: 500, error: 'HTTP 500' };
  delete h.world.market.wallet;
  const partial = await h.send({ type: 'MARKET_STATUS' });
  assert.deepEqual([partial.ok, partial.shop, partial.black.dealt, partial.wallet], [true, null, true, 10_000_000],
    'the wallet falls back to the inventory');

  h.world.account = null;
  const inventoryCalls = h.sentOf('SITE_INVENTORY').length;
  const signedOut = await h.send({ type: 'MARKET_STATUS' });
  assert.deepEqual([signedOut.tab, signedOut.wallet], [{ open: true, signedIn: false }, null]);
  assert.equal(h.sentOf('SITE_INVENTORY').length, inventoryCalls);

  h.world.replies.SITE_BLACK_MARKET = { ok: false, error: 'HTTP 502' };
  const neither = await h.send({ type: 'MARKET_STATUS' });
  assert.equal(neither.ok, false);
  assert.match(neither.error, /HTTP 500/);
  assert.equal(h.sentOf('SITE_BUY').length + h.sentOf('SITE_BUY_BLACK_MARKET').length, 0, 'a status request never buys');
});

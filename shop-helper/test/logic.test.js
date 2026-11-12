import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBlackMarketPurchase, choosePurchase, shopKey } from '../logic.js';
const catalog = [{ id: 'luck_1', name: 'Luck Potion I', price: 10 }];
const rule = { uid: 'abc', id: 'luck_1', quantity: 10, mode: 'once' };
const shop = { open: true, slot: 123, reroll: 0, wallet: { effective: 1000 }, items: [{ id: 'luck_1', perPlayer: 20, bought: 3, left: 5 }] };
const choose = (s = shop, r = rule, p = {}) => choosePurchase({ rules: [r] }, p, s, catalog);
test('respects stock, remaining player quota and affordable EP', () => {
  assert.equal(choose().quantity, 5);
  assert.equal(choose({ ...shop, items: [{ id: 'luck_1', left: null, perPlayer: 5, bought: 3 }] }).quantity, 2);
  assert.equal(choose({ ...shop, wallet: { effective: 35 } }).quantity, 3);
  assert.equal(choose({ ...shop, wallet: { effective: 9 } }), null);
});
test('does not repeat a completed one-time rule or a restock already processed', () => {
  assert.equal(choose(shop, rule, { abc: { status: 'complete' } }), null);
  assert.equal(choose(shop, rule, { abc: { status: 'uncertain' } }), null);
  const recurring = { ...rule, mode: 'restock' };
  assert.equal(choose(shop, recurring, { abc: { lastSlot: '123:0' } }), null);
  assert.equal(choose({ ...shop, slot: 124 }, recurring, { abc: { lastSlot: '123:0' } }).quantity, 5);
  assert.equal(choose({ ...shop, reroll: 1 }, recurring, { abc: { lastSlot: '123:0' } }).quantity, 5);
});
test('refuses closed shops, unavailable items, missing wallet and invalid quantities', () => {
  assert.equal(choose({ ...shop, open: false }), null);
  assert.equal(choose({ ...shop, eaten: true }), null);
  assert.equal(choose({ ...shop, items: [] }), null);
  assert.equal(choose({ ...shop, wallet: undefined }), null);
  assert.equal(choose(shop, { ...rule, quantity: 1001 }), null);
  assert.equal(choose(shop, { ...rule, quantity: -1 }), null);
  assert.equal(shopKey({}), null);
});

test('buys Glim bundles one at a time within the per-shop cap and wallet', () => {
  const bundleRule = { uid: 'bundle', id: 'bundle', quantity: 1000, mode: 'restock' };
  const bundle = { name: 'Glim bundle', price: 100, left: 8, bought: 0 };
  const selectBundle = (offer = bundle, wallet = 1000, progress = {}, slot = 123) =>
    choosePurchase({ rules: [bundleRule] }, progress, { ...shop, slot, wallet: { effective: wallet }, bundle: offer }, []);

  assert.deepEqual(
    { quantity: selectBundle().quantity, targetQuantity: selectBundle().targetQuantity },
    { quantity: 1, targetQuantity: 3 }
  );
  assert.equal(selectBundle(bundle, 199).targetQuantity, 1);
  assert.equal(selectBundle({ ...bundle, left: 0 }), null);
  assert.equal(selectBundle({ ...bundle, bought: 3 }), null);
  assert.equal(selectBundle(bundle, 1000, { bundle: { lastSlot: '123:0', slotBought: 3, slotTarget: 3 } }), null);
  assert.equal(selectBundle(bundle, 1000, { bundle: { lastSlot: '123:0', slotBought: 2, slotTarget: 3 } }).quantity, 1);
  assert.equal(selectBundle(bundle, 1000, { bundle: { lastSlot: '123:0', slotBought: 3, slotTarget: 3 } }, 124).targetQuantity, 3);
  assert.equal(selectBundle(bundle, 1000, { bundle: { status: 'error', lastSlot: '123:0' } }), null);
  assert.equal(selectBundle(bundle, 1000, { bundle: { status: 'error', lastSlot: '123:0' } }, 124).quantity, 1);
  assert.equal(selectBundle(bundle, 99), null);
});

test('combines Black Market filters with AND and uses the listed purchase price', () => {
  const blackCatalog = [
    { id: 'cheap', name: 'Cheap', price: 300 },
    { id: 'middle', name: 'Middle', price: 1000 },
    { id: 'highest', name: 'Highest', price: 20 }
  ];
  const market = {
    open: true, slot: 55, wallet: { effective: 500 },
    items: [
      { id: 'cheap', price: 30, left: 1 },
      { id: 'middle', price: 90, left: 1 },
      { id: 'highest', price: 100, left: 1 }
    ]
  };
  const settings = {
    blackMarket: {
      enabled: true, mostExpensive: true, selectedOnly: true, itemIds: ['middle', 'highest'],
      minimumEnabled: true, minimumPrice: 90
    }
  };
  const choose = (config = settings.blackMarket, current = market, progress = {}) =>
    chooseBlackMarketPurchase({ blackMarket: config }, progress, current, blackCatalog);

  assert.equal(choose().item.id, 'highest');
  assert.equal(choose({ ...settings.blackMarket, itemIds: ['middle'] }), null, 'all enabled filters must pass');
  assert.equal(choose({ ...settings.blackMarket, minimumPrice: 101 }), null, 'minimum uses the listed market price');
  assert.equal(choose({ ...settings.blackMarket, selectedOnly: false, minimumEnabled: false }, { ...market, wallet: { effective: 99 } }), null, 'most expensive uses the whole shelf, not only affordable offers');
  assert.equal(choose(
    { ...settings.blackMarket, selectedOnly: false, minimumEnabled: false },
    { ...market, items: [{ ...market.items[2], left: 0 }, market.items[1], market.items[0]] }
  ), null, 'most expensive uses listed offers even when the highest is unavailable');
  assert.equal(choose({ ...settings.blackMarket, mostExpensive: false, selectedOnly: false, minimumEnabled: false }).item.id, 'cheap');
  assert.equal(choose({ ...settings.blackMarket, mostExpensive: false, selectedOnly: true, itemIds: ['middle'] }).item.id, 'middle');
  assert.equal(choose(settings.blackMarket, market, { 'blackMarket:deal': { lastSlot: '55:0' } }), null, 'a single deal is allowed even with a stale response');
  assert.equal(choose(settings.blackMarket, { ...market, items: [{ ...market.items[2], price: null }, market.items[1]] }), null, 'unknown live prices fail closed');
  assert.equal(choose({ ...settings.blackMarket, mostExpensive: false }, { ...market, items: [{ ...market.items[2], price: null }] }), null, 'catalog prices are not used for purchases');
  assert.equal(choose(settings.blackMarket, { ...market, items: [{ ...market.items[0], bought: true }] }), null);
  assert.equal(choose(settings.blackMarket, { ...market, items: [{ ...market.items[0], left: 0 }] }), null);
  assert.equal(choose({ ...settings.blackMarket, enabled: false }), null);
});

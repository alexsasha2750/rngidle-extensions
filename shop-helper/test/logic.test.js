import test from 'node:test';
import assert from 'node:assert/strict';
import { blackMarketMatches, bundleRunLength, chooseBlackMarketPurchase, choosePurchase, shopKey } from '../logic.js';
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

test('a spending budget caps item quantities and fails closed', () => {
  const withBudget = (budget, s = shop, r = rule, p = {}) => choosePurchase({ rules: [r] }, p, s, catalog, budget);
  assert.equal(withBudget(35).quantity, 3, 'only what the budget covers');
  assert.equal(withBudget(10).quantity, 1);
  assert.equal(withBudget(9), null, 'skipped when not even one fits');
  assert.equal(withBudget(0), null);
  assert.equal(withBudget(NaN), null, 'an unusable budget allows nothing');
  assert.equal(withBudget(null), null);
  assert.equal(withBudget(1000).quantity, 5, 'a larger budget changes nothing');
  const scenarios = [
    [shop, rule, {}], [{ ...shop, wallet: { effective: 35 } }, rule, {}], [shop, { ...rule, mode: 'restock' }, { abc: { lastSlot: '123:0' } }],
    [{ ...shop, open: false }, rule, {}], [{ ...shop, items: [{ id: 'luck_1', left: null, perPlayer: 5, bought: 3 }] }, rule, {}],
  ];
  for (const [s, r, p] of scenarios) {
    assert.deepEqual(withBudget(Infinity, s, r, p), choose(s, r, p), 'Infinity behaves exactly like no budget');
  }
});

test('a spending budget gates each bundle without shrinking a one-time target', () => {
  const once = { uid: 'bundle', id: 'bundle', quantity: 1000, mode: 'once' };
  const restock = { ...once, mode: 'restock' };
  const offer = { name: 'Glim bundle', price: 100, left: 8, bought: 0 };
  const pick = (r, budget, progress = {}) =>
    choosePurchase({ rules: [r] }, progress, { ...shop, wallet: { effective: 1000 }, bundle: offer }, [], budget);
  assert.equal(pick(restock, 99), null, 'a bundle costing more than the budget is skipped');
  assert.equal(pick(once, 99), null);
  assert.equal(pick(once, 150).targetQuantity, 3, 'target comes from stock and wallet, not the budget');
  assert.equal(pick(once, 100).quantity, 1);
  const partial = { bundle: { status: 'purchased', lastSlot: '123:0', totalBought: 1, targetQuantity: 3 } };
  assert.equal(pick(once, 50, partial), null);
  assert.equal(pick(once, 100, partial).targetQuantity, 3, 'a persisted target is kept as is');
  assert.deepEqual(pick(once, Infinity, partial), pick(once, undefined, partial));
});

test('bundleRunLength counts the bundles a selection would go on to buy', () => {
  const offer = { price: 100, left: 8, bought: 0 };
  const s = { ...shop, wallet: { effective: 1000 }, bundle: offer };
  const selection = r => choosePurchase({ rules: [r] }, {}, s, []);
  const restock = selection({ uid: 'b', id: 'bundle', quantity: 1000, mode: 'restock' });
  assert.equal(bundleRunLength(restock, undefined, s), 3);
  assert.equal(bundleRunLength(restock, { lastSlot: '123:0', slotBought: 1 }, s), 2);
  assert.equal(bundleRunLength(restock, undefined, s, 250), 2, 'the budget limits the run');
  assert.equal(bundleRunLength(restock, undefined, { ...s, wallet: { effective: 150 } }), 1);
  const once = selection({ uid: 'b', id: 'bundle', quantity: 2, mode: 'once' });
  assert.equal(bundleRunLength(once, undefined, s), 2);
  assert.equal(bundleRunLength(once, { totalBought: 1 }, s), 1);
});

test('the Black Market planner skips offers above the budget', () => {
  const blackCatalog = [{ id: 'cheap', name: 'Cheap' }, { id: 'highest', name: 'Highest' }];
  const market = { open: true, slot: 55, wallet: { effective: 500 }, items: [{ id: 'cheap', price: 30, left: 1 }, { id: 'highest', price: 100, left: 1 }] };
  const pick = (filters, budget) => chooseBlackMarketPurchase({ blackMarket: { enabled: true, ...filters } }, {}, market, blackCatalog, budget);
  assert.equal(pick({ mostExpensive: true }, 99), null, 'the most expensive offer is still the only candidate');
  assert.equal(pick({ mostExpensive: true }, 100).item.id, 'highest');
  assert.equal(pick({ selectedOnly: true, itemIds: ['highest'] }, 50), null);
  assert.equal(pick({}, 50).item.id, 'cheap');
  assert.equal(pick({}, 29), null);
  assert.deepEqual(pick({}, Infinity), pick({}));
});

test('blackMarketMatches applies the auto-buy filters but ignores wallet, switch and progress', () => {
  const blackCatalog = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }, { id: 'c' }];
  const market = { open: true, slot: 1, wallet: { effective: 0 }, items: [
    { id: 'c', price: 50, left: 1 }, { id: 'a', price: 90, left: 1 }, { id: 'b', price: 10, left: 1 },
    { id: 'zz', price: 500, left: 1 }, { id: 'b', price: 10, left: 0 },
  ] };
  const ids = (filters, m = market) => blackMarketMatches(filters, m, blackCatalog).map(match => match.id);
  assert.deepEqual(blackMarketMatches({ enabled: false }, market, blackCatalog),
    [{ id: 'c', name: 'c', price: 50, left: 1 }, { id: 'a', name: 'Alpha', price: 90, left: 1 }, { id: 'b', name: 'Beta', price: 10, left: 1 }],
    'market order, with no wallet, catalog names and only listed offers');
  assert.deepEqual(ids(undefined), ['c', 'a', 'b'], 'no filters: everything available');
  assert.deepEqual(ids({ selectedOnly: true, itemIds: ['b', 'zz'] }), ['b']);
  assert.deepEqual(ids({ minimumEnabled: true, minimumPrice: 50 }), ['c', 'a']);
  assert.deepEqual(ids({ minimumEnabled: true, minimumPrice: 'x' }), [], 'a broken minimum matches nothing, as in auto-buy');
  assert.deepEqual(ids({ mostExpensive: true }), [], 'the most expensive listed offer is not in the catalog');
  assert.deepEqual(ids({ mostExpensive: true }, { ...market, items: market.items.slice(0, 3) }), ['a']);
  assert.deepEqual(ids({}, { ...market, items: [{ ...market.items[1], bought: true }] }), []);
  for (const closed of [{ open: false }, { dealt: true }, { eaten: true }, { items: null }]) assert.deepEqual(ids({}, { ...market, ...closed }), []);
  const progress = { 'blackMarket:a': { status: 'uncertain' }, 'blackMarket:deal': { lastSlot: '1:0' } };
  assert.equal(chooseBlackMarketPurchase({ blackMarket: { enabled: true } }, progress, { ...market, wallet: { effective: 1000 } }, blackCatalog), null);
  assert.deepEqual(ids({ enabled: true }), ['c', 'a', 'b'], 'progress does not hide matches');
});

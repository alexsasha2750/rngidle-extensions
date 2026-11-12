import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePurchase, shopKey } from '../logic.js';
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

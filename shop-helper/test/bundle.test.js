import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bundleAllowed, bundleRule, bundleSignature, defaultBundle, discountOf, fromLegacyRule, normalizeBundle, rulesOf, withBundleRule,
} from '../bundle.js';
import { bundleRunLength, choosePurchase } from '../logic.js';

const offer = (over = {}) => ({ type: 'rarity', name: 'Rarity Bundle', tier: 'mythic', items: { rarity_aberration: 5, rarity_otherworldly: 2 }, value: 2_000, price: 1_800, stock: 3, perPlayer: 3, bought: 0, left: 3, ...over });
const shop = (over = {}, bundle = offer()) => ({ open: true, slot: 7, reroll: 0, wallet: { effective: 100_000 }, items: [], bundle, ...over });
const settings = (bundle, rest = {}) => ({ enabled: true, rules: [], bundle: { enabled: true, uid: 'b1', mode: 'restock', quantity: 3, ...bundle }, ...rest });
const pick = (config, progress = {}, theShop = shop()) => choosePurchase(config, progress, theShop, []);

test('bundle settings are cleaned up', () => {
  assert.deepEqual(normalizeBundle(undefined), defaultBundle());
  const clean = normalizeBundle({ enabled: 'yes', mode: 'weird', quantity: 0, maxPrice: -5, minDiscount: 150, contains: ['luck_3', 'luck_3', 'Bad Id', 7, 'dss'], reserve: 'lots', uid: 5 });
  assert.deepEqual(clean, { enabled: false, uid: '', mode: 'restock', quantity: 1, maxPrice: null, minDiscount: 99, contains: ['luck_3', 'dss'], reserve: 0 });
  assert.deepEqual(normalizeBundle({ mode: 'once', quantity: 1000, maxPrice: '2500', reserve: 10, minDiscount: '12.5' }), { ...defaultBundle(), mode: 'once', quantity: 1000, maxPrice: 2500, reserve: 10, minDiscount: 12.5 });
  assert.equal(normalizeBundle({ quantity: 1001 }).quantity, 1, 'above the old 1,000 limit falls back');
});

test('the old “Any bundle” rule carries over with its progress key', () => {
  assert.deepEqual(fromLegacyRule({ uid: 'old-uid', id: 'bundle', quantity: 4, mode: 'once' }), { ...defaultBundle(), enabled: true, uid: 'old-uid', mode: 'once', quantity: 4 });
});

test('the discount is read from the listed value and price', () => {
  assert.equal(discountOf(offer()), 10);
  assert.equal(discountOf(offer({ value: 0 })), 0);
  assert.equal(discountOf(offer({ price: 2_500 })), 0, 'a price above the value is not a discount');
  assert.equal(discountOf({}), 0);
});

test('a bundle must pass every filter the player set', () => {
  assert.deepEqual(bundleAllowed({}, offer()), { ok: true, reason: '' }, 'no filters allow anything');
  assert.deepEqual(bundleAllowed({ maxPrice: 1_800 }, offer()), { ok: true, reason: '' }, 'the limit itself is allowed');
  assert.deepEqual(bundleAllowed({ maxPrice: 1_799 }, offer()), { ok: false, reason: 'price' });
  assert.equal(bundleAllowed({ minDiscount: 10 }, offer()).ok, true, 'exactly the discount asked for');
  assert.deepEqual(bundleAllowed({ minDiscount: 10.5 }, offer()), { ok: false, reason: 'discount' });
  assert.equal(bundleAllowed({ contains: ['luck_3', 'rarity_aberration'] }, offer()).ok, true, 'any one of the wanted items is enough');
  assert.deepEqual(bundleAllowed({ contains: ['luck_3'] }, offer()), { ok: false, reason: 'contains' });
  assert.deepEqual(bundleAllowed({ contains: ['luck_3'] }, offer({ items: undefined })), { ok: false, reason: 'contains' });
  assert.equal(bundleAllowed({ maxPrice: 5_000, minDiscount: 5, contains: ['rarity_otherworldly'] }, offer()).ok, true);
});

test('settings become the rule the planner buys through', () => {
  assert.equal(bundleRule({ enabled: false }), null);
  assert.deepEqual(bundleRule({ enabled: true, uid: 'u', mode: 'once', quantity: 2 }), { uid: 'u', id: 'bundle', quantity: 2, mode: 'once' });
  assert.equal(bundleRule({ enabled: true }).uid, 'bundle:main', 'a fresh setting gets a stable key');
  const legacy = { enabled: true, rules: [{ uid: 'x', id: 'bundle', quantity: 1, mode: 'once' }, { uid: 'y', id: 'luck_3', quantity: 1, mode: 'once' }] };
  assert.deepEqual(rulesOf(legacy), legacy.rules, 'settings without the new field keep their old rule');
  const migrated = { ...legacy, bundle: { enabled: false } };
  assert.deepEqual(rulesOf(migrated).map(rule => rule.id), ['luck_3'], 'the new setting owns the bundle: the old rule is ignored');
  const on = withBundleRule({ rules: [{ uid: 'y', id: 'luck_3', quantity: 1, mode: 'once' }], bundle: { enabled: true, uid: 'b1', quantity: 2 } });
  assert.deepEqual(on.rules.map(rule => rule.id), ['luck_3', 'bundle']);
  assert.deepEqual(withBundleRule(on).rules, on.rules, 'applying it twice changes nothing');
  assert.equal(withBundleRule(undefined), undefined);
});

test('the planner buys a bundle that passes and skips one that does not', () => {
  assert.equal(pick(settings({})).kind, 'bundle');
  assert.equal(pick(settings({ enabled: false })), null, 'switched off');
  assert.equal(pick(settings({ maxPrice: 1_000 })), null, 'too expensive');
  assert.equal(pick(settings({ minDiscount: 20 })), null, 'not discounted enough');
  assert.equal(pick(settings({ contains: ['luck_3'] })), null, 'does not hold what was asked for');
  assert.equal(pick(settings({ contains: ['rarity_aberration'], maxPrice: 2_000, minDiscount: 10 })).kind, 'bundle');
});

test('the EP reserve is never spent on a bundle', () => {
  const small = shop({ wallet: { effective: 5_000 } });
  assert.equal(pick(settings({ quantity: 3 }), {}, small).targetQuantity, 2, 'only two fit in 5,000');
  const kept = pick(settings({ quantity: 3, reserve: 2_000 }), {}, small);
  assert.equal(kept.targetQuantity, 1, 'keeping 2,000 leaves room for one');
  assert.equal(kept.reserve, 2_000);
  assert.equal(pick(settings({ reserve: 4_000 }), {}, small), null, 'nothing is left to spend');
  assert.equal(bundleRunLength(kept, undefined, small), 1);
  const big = shop({ wallet: { effective: 100_000 } });
  const run = pick(settings({ quantity: 3, reserve: 98_000 }), {}, big);
  assert.equal(run.targetQuantity, 1);
  assert.equal(bundleRunLength(pick(settings({ quantity: 3 }), {}, big), undefined, big), 3);
});

test('once-mode and restock-mode keep behaving as before', () => {
  const once = settings({ mode: 'once', quantity: 2 });
  const first = pick(once);
  assert.equal(first.targetQuantity, 2);
  assert.equal(pick(once, { b1: { status: 'complete' } }), null, 'a finished once-rule stops');
  const restock = settings({ mode: 'restock', quantity: 1 });
  assert.ok(pick(restock, { b1: { status: 'purchased', lastSlot: '6:0', slotBought: 1, slotTarget: 1 } }), 'a new shop buys again');
  assert.equal(pick(restock, { b1: { status: 'purchased', lastSlot: '7:0', slotBought: 1, slotTarget: 1 } }), null, 'but not twice in one shop');
});

test('an old settings object with the bundle rule still buys, with no filters', () => {
  const legacy = { enabled: true, rules: [{ uid: 'old', id: 'bundle', quantity: 1, mode: 'restock' }] };
  assert.equal(pick(legacy).kind, 'bundle');
  assert.equal(pick(legacy, {}, shop({}, offer({ price: 1_999 }))).kind, 'bundle');
});

test('the signature notices a change in what would be bought', () => {
  const a = settings({ maxPrice: 100, contains: ['b', 'a'] });
  assert.equal(bundleSignature(a), bundleSignature(settings({ maxPrice: 100, contains: ['a', 'b'] })), 'order does not matter');
  assert.notEqual(bundleSignature(a), bundleSignature(settings({ maxPrice: 101, contains: ['a', 'b'] })));
  assert.notEqual(bundleSignature(a), bundleSignature(settings({ maxPrice: 100, contains: ['a', 'b'], reserve: 1 })));
  assert.equal(bundleSignature({ rules: [] }), 'legacy');
});

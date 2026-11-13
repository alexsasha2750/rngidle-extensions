import test from 'node:test';
import assert from 'node:assert/strict';
import { priceHint, skewOf, slotLeft } from '../market-hints.js';

test('prices are compared with the wallet', () => {
  assert.equal(priceHint(1e6, 1e8).tone, 'ok');
  assert.equal(priceHint(1e6, 1e8).text, '1.0% of your EP');
  assert.equal(priceHint(1e5, 1e8).text, 'Under 1% of your EP');
  assert.equal(priceHint(5e7, 1e8).text, '50% of your EP');
  assert.equal(priceHint(1e9, 4e8).tone, 'short');
  assert.match(priceHint(1e9, 4e8).text, /^Need .+ more$/);
  assert.equal(priceHint(1e6, 1e6).tone, 'ok', 'exactly affordable counts');
  assert.deepEqual(priceHint(1e6, null), { tone: 'unknown', text: '' });
  assert.deepEqual(priceHint(0, 100), { tone: 'unknown', text: '' });
});

test('slot time left follows the game server clock', () => {
  const data = { shop: { now: 10_000, endsAt: 70_000 } };
  assert.equal(skewOf(data), 10_000 - Date.now());
  assert.equal(slotLeft(data.shop, 0, 40_000), 30_000);
  assert.equal(slotLeft(data.shop, 5_000, 40_000), 25_000, 'a game clock that is ahead shortens the wait');
  assert.equal(slotLeft(data.shop, 0, 90_000), 0, 'never negative');
  assert.equal(slotLeft({ endsAt: null }, 0), null);
  assert.equal(slotLeft(null, 0), null);
  assert.equal(skewOf(null), 0);
});

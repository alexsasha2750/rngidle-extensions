import test from 'node:test';
import assert from 'node:assert/strict';
import { blackStatus, MAX_MARKET_ITEMS, marketStatus, shopStatus, walletOf } from '../market.js';

const tab = { signedIn: true };

test('no game tab is a normal answer, not an error', () => {
  assert.deepEqual(marketStatus({ tab: null }), { ok: true, tab: { open: false, signedIn: false }, wallet: null, shop: null, black: null });
  assert.deepEqual(marketStatus(), { ok: true, tab: { open: false, signedIn: false }, wallet: null, shop: null, black: null });
});

test('both markets are trimmed to what the menu needs, with numbers checked', () => {
  const reply = marketStatus({
    tab,
    shop: { ok: true, data: { open: true, eaten: 0, endsAt: '5000', now: 4000, slot: 3, items: [{ id: 'luck_1' }], wallet: { effective: '1200' } } },
    black: { ok: true, data: { open: true, dealt: false, endsAt: 'soon', now: -1, wallet: { effective: 1 }, items: [
      { id: 'market_item', price: '75', left: 1, bought: false, secret: 'x' },
      { id: 'cheap', price: -1, left: 1.5, bought: 1 },
      null, 'junk', { id: 5 }, { id: 'bad id!' }, { price: 3 },
    ] } },
  });
  assert.deepEqual(reply, {
    ok: true,
    tab: { open: true, signedIn: true },
    wallet: 1200,
    shop: { open: true, eaten: false, endsAt: 5000, now: 4000 },
    black: {
      open: true, dealt: false, eaten: false, endsAt: null, now: null,
      items: [{ id: 'market_item', price: 75, left: 1, bought: false }, { id: 'cheap', price: null, left: null, bought: true }],
    },
  });
  const many = blackStatus({ open: true, items: Array.from({ length: 80 }, (_, n) => ({ id: `item_${n}`, price: 1, left: 1 })) });
  assert.equal(many.items.length, MAX_MARKET_ITEMS);
  assert.equal(shopStatus('nope'), null);
  assert.equal(blackStatus(null), null);
});

test('the wallet comes from the shop, then the Black Market, then the inventory', () => {
  assert.equal(walletOf({ wallet: { effective: -5 } }), null);
  assert.equal(walletOf({ wallet: { effective: null } }), null);
  const shop = { ok: true, data: { open: true } };
  const black = { ok: true, data: { open: false, wallet: { effective: 30 } } };
  const inventory = { ok: true, data: { wallet: { effective: 99 } } };
  assert.equal(marketStatus({ tab, shop, black, inventory }).wallet, 30);
  assert.equal(marketStatus({ tab, shop, black: { ok: false }, inventory }).wallet, 99);
  assert.equal(marketStatus({ tab: { signedIn: false }, shop }).wallet, null);
  assert.equal(marketStatus({ tab: { signedIn: false }, shop }).tab.signedIn, false);
});

test('one failing endpoint only blanks its own part; both failing is an error', () => {
  const black = { ok: true, data: { open: false, items: [] } };
  const partly = marketStatus({ tab, shop: { ok: false, error: 'HTTP 500' }, black });
  assert.equal(partly.ok, true);
  assert.equal(partly.shop, null);
  assert.equal(partly.black.open, false);
  const neither = marketStatus({ tab, shop: { ok: false, error: 'HTTP 500' }, black: { ok: false, error: 'HTTP 502' } });
  assert.equal(neither.ok, false);
  assert.match(neither.error, /HTTP 500/);
  assert.deepEqual([neither.shop, neither.black, neither.tab], [null, null, { open: true, signedIn: true }]);
  assert.equal(marketStatus({ tab, shop: { ok: true, data: null }, black: undefined }).ok, false);
});

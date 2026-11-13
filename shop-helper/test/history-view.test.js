import test from 'node:test';
import assert from 'node:assert/strict';
import { entryTitle, resultInfo, sourceLabel, totals, visibleEntries } from '../history-view.js';

const day = new Date(2026, 10, 13, 12, 0).getTime();
const entry = (over = {}) => ({ id: 'x', time: day, source: 'shop', result: 'bought', item: 'luck_6', name: 'Luck Potion VI', qty: 2, price: 100, total: 200, ...over });

test('entries are filtered by shop and shown newest first', () => {
  const list = [entry({ id: 'a', source: 'shop' }), entry({ id: 'b', source: 'black' }), entry({ id: 'c', source: 'bundle' }), entry({ id: 'd', source: 'glitch' }), null, 'junk'];
  assert.deepEqual(visibleEntries(list, 'all').map(e => e.id), ['d', 'c', 'b', 'a']);
  assert.deepEqual(visibleEntries(list, 'shop').map(e => e.id), ['c', 'a'], 'bundles belong to Glim’s shop');
  assert.deepEqual(visibleEntries(list, 'black').map(e => e.id), ['b']);
  assert.equal(visibleEntries(list, 'bogus').length, 4, 'an unknown filter shows everything');
  assert.deepEqual(visibleEntries(undefined, 'all'), []);
});

test('only real purchases count towards what was spent', () => {
  const list = [
    entry({ total: 200 }),
    entry({ total: 300, time: day - 3 * 86400000 }),
    entry({ result: 'declined', total: 999 }),
    entry({ result: 'dryrun', total: 999 }),
    entry({ result: 'uncertain', total: 999 }),
    entry({ total: null }),
  ];
  assert.deepEqual(totals(list, day), { spentToday: 200, boughtToday: 2, spent: 500 });
  assert.deepEqual(totals([], day), { spentToday: 0, boughtToday: 0, spent: 0 });
});

test('labels are readable', () => {
  assert.equal(entryTitle(entry()), '2 × Luck Potion VI');
  assert.equal(entryTitle(entry({ qty: 1 })), 'Luck Potion VI');
  assert.equal(entryTitle({ item: 'x' }), 'x');
  assert.equal(sourceLabel({ source: 'black' }), 'Black Market');
  assert.equal(sourceLabel({ source: 'glitch' }), 'Glitch');
  assert.equal(resultInfo({ result: 'dryrun' }).text, 'Dry run');
  assert.equal(resultInfo({ result: 'weird' }).tone, 'warn');
});

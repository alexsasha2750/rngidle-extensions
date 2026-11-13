import test from 'node:test';
import assert from 'node:assert/strict';
import { addHistory, MAX_HISTORY, normalizeHistory } from '../history.js';

function memory(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    get: async key => (key in data ? { [key]: structuredClone(data[key]) } : {}),
    set: async values => { await new Promise(resolve => setTimeout(resolve, 1)); Object.assign(data, structuredClone(values)); },
  };
}
const entry = (over = {}) => ({ source: 'shop', result: 'bought', item: 'luck_3', name: 'Luck Potion III', qty: 3, price: 250000, ...over });

test('addHistory appends a complete entry with its total', async () => {
  const storage = memory();
  const saved = await addHistory(storage, entry({ message: 'ok' }), { now: 1000, id: 'e1' });
  assert.deepEqual(saved, {
    id: 'e1', time: 1000, source: 'shop', result: 'bought', item: 'luck_3', name: 'Luck Potion III',
    qty: 3, price: 250000, total: 750000, message: 'ok',
  });
  assert.deepEqual(storage.data.history, [saved]);
  const unknown = await addHistory(storage, entry({ source: 'glitch', result: 'uncertain', price: null, qty: 1 }), { now: 2000, id: 'e2' });
  assert.equal(unknown.price, null);
  assert.equal(unknown.total, null);
  assert.ok(!('message' in unknown));
  const generated = await addHistory(storage, entry({ result: 'dryrun' }));
  assert.equal(typeof generated.id, 'string');
  assert.ok(generated.time > 0);
});

test('invalid entries are not written', async () => {
  const storage = memory();
  for (const bad of [entry({ source: 'casino' }), entry({ result: 'maybe' }), entry({ item: '' }), entry({ qty: 0 }), entry({ qty: 1.5 })]) {
    assert.equal(await addHistory(storage, bad, { now: 1, id: 'x' }), null);
  }
  assert.equal(storage.data.history, undefined);
});

test('concurrent writes keep every entry', async () => {
  const storage = memory();
  await Promise.all([1, 2, 3, 4, 5].map(n => addHistory(storage, entry(), { now: n, id: `e${n}` })));
  assert.deepEqual(storage.data.history.map(item => item.id), ['e1', 'e2', 'e3', 'e4', 'e5']);
});

test('normalizeHistory drops junk and keeps the newest entries, oldest first', () => {
  assert.deepEqual(normalizeHistory('nope'), []);
  const list = [];
  for (let n = 1; n <= MAX_HISTORY + 10; n++) list.push({ id: `e${n}`, time: n, ...entry() });
  list.push(null, { id: 'bad', time: 'soon', ...entry() }, { ...entry(), id: 'early', time: 0.5 });
  const kept = normalizeHistory(list.reverse());
  assert.equal(kept.length, MAX_HISTORY);
  assert.equal(kept[0].id, 'e11');
  assert.equal(kept.at(-1).id, `e${MAX_HISTORY + 10}`);
  assert.ok(kept.every((item, index) => index === 0 || kept[index - 1].time <= item.time));
  const [clean] = normalizeHistory([{ ...entry({ price: -3, name: '' }), id: 'z', time: 5, total: 999, extra: true }]);
  assert.deepEqual(clean, { id: 'z', time: 5, source: 'shop', result: 'bought', item: 'luck_3', name: 'luck_3', qty: 3, price: null, total: null });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentSpend, dryRunProgress, ensureSessionId, localDay, normalizeDryRunSeen, normalizeSafety, pruneDryRunSeen,
  purchaseCost, recordSpend, remainingBudget, spentInPeriod,
} from '../safety.js';

// Local-time timestamps, so the tests hold in every time zone.
const lateEvening = new Date(2026, 10, 13, 23, 59).getTime();
const nextMorning = new Date(2026, 10, 14, 0, 1).getTime();
const clock = { now: lateEvening, sessionId: 's1' };
const cap = (amount, period = 'day') => ({ cap: { enabled: true, amount, period } });

test('normalizeSafety fills every field and falls back on bad values', () => {
  const defaults = { dryRun: false, cap: { enabled: false, amount: 0, period: 'day' } };
  for (const value of [undefined, null, 'x', [], {}, { cap: null }]) assert.deepEqual(normalizeSafety(value), defaults);
  assert.deepEqual(normalizeSafety({ dryRun: 'yes', cap: { enabled: 1, amount: -5, period: 'week' } }), defaults);
  for (const amount of [NaN, Infinity, -1, 'abc', '', null, true, {}]) {
    assert.equal(normalizeSafety({ cap: { enabled: true, amount } }).cap.amount, 0, `amount ${String(amount)}`);
  }
  assert.deepEqual(normalizeSafety({ dryRun: true, cap: { enabled: true, amount: '250', period: 'session' } }),
    { dryRun: true, cap: { enabled: true, amount: 250, period: 'session' } });
  assert.equal(normalizeSafety({ cap: { amount: 1.5 } }).cap.amount, 1.5);
});

test('a cap switched on with a broken amount allows nothing', () => {
  assert.equal(remainingBudget({ cap: { enabled: true, amount: 'lots' } }, undefined, clock), 0);
});

test('remainingBudget is Infinity without a cap, else what is left in the period', () => {
  const spend = { day: localDay(lateEvening), dayTotal: 300, session: 's1', sessionTotal: 900 };
  assert.equal(remainingBudget(undefined, spend, clock), Infinity);
  assert.equal(remainingBudget({ cap: { enabled: false, amount: 10 } }, spend, clock), Infinity);
  assert.equal(remainingBudget(cap(1000), spend, clock), 700);
  assert.equal(remainingBudget(cap(1000, 'session'), spend, clock), 100);
  assert.equal(remainingBudget(cap(200), spend, clock), 0, 'never negative');
  assert.equal(remainingBudget(cap(1000), undefined, clock), 1000);
  assert.equal(spentInPeriod(cap(1000, 'session'), spend, clock), 900);
});

test('day totals reset with the local date, session totals with the session id', () => {
  assert.equal(localDay(lateEvening), '2026-11-13');
  assert.equal(localDay(nextMorning), '2026-11-14');
  const spend = { day: '2026-11-13', dayTotal: 500, session: 's1', sessionTotal: 500 };
  assert.equal(remainingBudget(cap(500), spend, clock), 0);
  assert.equal(remainingBudget(cap(500), spend, { now: nextMorning, sessionId: 's1' }), 500, 'a new day');
  assert.equal(remainingBudget(cap(500, 'session'), spend, { now: nextMorning, sessionId: 's1' }), 0, 'same session over midnight');
  assert.equal(remainingBudget(cap(500, 'session'), spend, { now: lateEvening, sessionId: 's2' }), 500, 'a new session');
  assert.equal(remainingBudget(cap(500), spend, { now: lateEvening, sessionId: 's2' }), 0, 'a new session is still the same day');
  assert.deepEqual(currentSpend({ day: '2026-11-13', dayTotal: 'junk', session: 's1', sessionTotal: -4 }, clock),
    { day: '2026-11-13', dayTotal: 0, session: 's1', sessionTotal: 0 });
});

test('recordSpend adds price × quantity and skips unknown prices without failing', () => {
  const first = recordSpend(undefined, { price: 250, qty: 3 }, clock);
  assert.deepEqual(first, { day: '2026-11-13', dayTotal: 750, session: 's1', sessionTotal: 750 });
  const second = recordSpend(first, { price: 75 }, clock);
  assert.deepEqual(second, { day: '2026-11-13', dayTotal: 825, session: 's1', sessionTotal: 825 });
  const tomorrow = recordSpend(second, { price: 10, qty: 1 }, { now: nextMorning, sessionId: 's1' });
  assert.deepEqual(tomorrow, { day: '2026-11-14', dayTotal: 10, session: 's1', sessionTotal: 835 });
  for (const purchase of [undefined, {}, { price: null, qty: 2 }, { price: 'x' }, { price: 10, qty: 0 }, { price: -5 }]) {
    assert.deepEqual(recordSpend(second, purchase, clock), second);
  }
  assert.equal(purchaseCost({ price: 10, qty: 2 }), 20);
  assert.equal(purchaseCost({ price: 10, qty: 1.5 }), null);
});

test('ensureSessionId keeps one id per session area and falls back to local storage', async () => {
  const area = () => {
    const data = {};
    return { data, get: async key => (key in data ? { [key]: data[key] } : {}), set: async values => Object.assign(data, values) };
  };
  let made = 0;
  const create = () => `id-${++made}`;
  const session = area(), local = area();
  assert.equal(await ensureSessionId({ session, local, create }), 'id-1');
  assert.equal(await ensureSessionId({ session, local, create }), 'id-1');
  assert.deepEqual(local.data, {}, 'local storage untouched while session storage works');
  const fallback = area();
  assert.equal(await ensureSessionId({ session: undefined, local: fallback, create }), 'id-2');
  assert.equal(fallback.data.sessionId, 'id-2');
  const broken = { get: async () => { throw new Error('no access'); } };
  assert.equal(await ensureSessionId({ session: broken, local: fallback, create }), 'id-2');
});

test('dry-run markers only apply to the shop they were made in', () => {
  const rules = [{ uid: 'a', id: 'luck_1' }, { uid: 'b', id: 'bundle' }];
  const progress = { a: { status: 'purchased', lastSlot: '1:0' } };
  const seen = normalizeDryRunSeen({ a: '5:0', b: '5:0', 'blackMarket:x': '9:0', junk: 4 });
  assert.deepEqual(seen, { a: '5:0', b: '5:0', 'blackMarket:x': '9:0' });
  const view = dryRunProgress(progress, seen, { rules, shopKey: '5:0' });
  assert.equal(view.a.lastSlot, '5:0');
  assert.equal(view.a.status, 'purchased');
  assert.equal(view.b.status, 'complete');
  assert.equal(view['blackMarket:deal'], undefined);
  assert.deepEqual(progress, { a: { status: 'purchased', lastSlot: '1:0' } }, 'real progress is never changed');
  assert.deepEqual(dryRunProgress(progress, seen, { rules, shopKey: '6:0' }), progress, 'stale markers do nothing');
  assert.deepEqual(dryRunProgress({}, seen, { marketKey: '9:0' })['blackMarket:deal'], { lastSlot: '9:0' });
  assert.deepEqual(pruneDryRunSeen(seen, { shopKey: '6:0' }), { 'blackMarket:x': '9:0' });
  assert.deepEqual(pruneDryRunSeen(seen, { marketKey: '10:0' }), { a: '5:0', b: '5:0' });
  assert.deepEqual(pruneDryRunSeen(seen, { shopKey: null }), { 'blackMarket:x': '9:0' });
  assert.deepEqual(normalizeDryRunSeen(['a']), {});
});

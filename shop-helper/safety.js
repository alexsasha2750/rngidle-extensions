// Auto-buy safety settings: an optional spending cap and a dry run. Pure helpers shared by the
// background worker and the tests, so "how much may still be spent" has one definition.

export const CAP_PERIODS = ['day', 'session'];

function amountOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }
  return null;
}

// A cap that is switched on with a missing or broken amount becomes 0, so it fails closed.
export function normalizeSafety(value) {
  const cap = value?.cap;
  return {
    dryRun: value?.dryRun === true,
    cap: {
      enabled: cap?.enabled === true,
      amount: amountOf(cap?.amount) ?? 0,
      period: CAP_PERIODS.includes(cap?.period) ? cap.period : 'day',
    },
  };
}

export function localDay(now) {
  const date = new Date(Number.isFinite(now) ? now : Date.now());
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const total = value => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);

// The stored `spend` record as it stands now: day totals reset with the local date and session
// totals with the browser session id.
export function currentSpend(spend, { now, sessionId } = {}) {
  const day = localDay(now);
  const session = typeof sessionId === 'string' ? sessionId : '';
  return {
    day,
    dayTotal: spend?.day === day ? total(spend.dayTotal) : 0,
    session,
    sessionTotal: spend?.session === session ? total(spend.sessionTotal) : 0,
  };
}

export function spentInPeriod(safety, spend, clock) {
  const current = currentSpend(spend, clock);
  return normalizeSafety(safety).cap.period === 'session' ? current.sessionTotal : current.dayTotal;
}

export function remainingBudget(safety, spend, clock) {
  const { cap } = normalizeSafety(safety);
  if (!cap.enabled) return Infinity;
  return Math.max(0, cap.amount - spentInPeriod(safety, spend, clock));
}

// EP a purchase cost, or null when its price is unknown (e.g. saved by an older version).
export function purchaseCost(purchase) {
  const price = purchase?.price;
  const qty = purchase?.qty ?? 1;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  if (!Number.isSafeInteger(qty) || qty < 1) return null;
  return price * qty;
}

export function recordSpend(spend, purchase, clock) {
  const current = currentSpend(spend, clock);
  const cost = purchaseCost(purchase);
  if (cost == null) return current;
  return { ...current, dayTotal: current.dayTotal + cost, sessionTotal: current.sessionTotal + cost };
}

// One random id per browser session. chrome.storage.session clears itself when the browser
// closes; the storage.local fallback is reset by the worker on runtime.onStartup.
export async function ensureSessionId({ session, local, create }) {
  for (const area of [session, local]) {
    if (!area) continue;
    try {
      const { sessionId } = await area.get('sessionId');
      if (typeof sessionId === 'string' && sessionId) return sessionId;
      const id = create();
      await area.set({ sessionId: id });
      return id;
    } catch { /* try the next storage area */ }
  }
  return create();
}

// Dry run bookkeeping: `dryRunSeen` maps a selection uid to the shop key it was "bought" in.
export function normalizeDryRunSeen(value) {
  const seen = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return seen;
  for (const [uid, key] of Object.entries(value)) if (uid && typeof key === 'string') seen[uid] = key;
  return seen;
}

const isMarketUid = uid => uid.startsWith('blackMarket:');

// Drops markers from earlier shops. Only the shop(s) passed in are pruned.
export function pruneDryRunSeen(seen, current) {
  const next = {};
  for (const [uid, key] of Object.entries(seen)) {
    const which = isMarketUid(uid) ? 'marketKey' : 'shopKey';
    if (!(which in current) || current[which] === key) next[uid] = key;
  }
  return next;
}

// A throwaway copy of `progress` in which everything already simulated for the current shop
// looks handled, so the planner moves on to the next candidate. Never persisted.
export function dryRunProgress(progress, seen, { rules = [], shopKey = null, marketKey = null } = {}) {
  const view = { ...progress };
  for (const [uid, key] of Object.entries(seen)) {
    if (isMarketUid(uid)) {
      if (marketKey && key === marketKey) view['blackMarket:deal'] = { lastSlot: key };
    } else if (shopKey && key === shopKey) {
      const rule = rules.find(entry => entry?.uid === uid);
      view[uid] = rule?.id === 'bundle' ? { ...view[uid], status: 'complete' } : { ...view[uid], lastSlot: key };
    }
  }
  return view;
}

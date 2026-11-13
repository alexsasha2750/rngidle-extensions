// Structured purchase history (storage key `history`), oldest first, for the menu.

export const MAX_HISTORY = 200;
export const HISTORY_SOURCES = ['shop', 'bundle', 'black', 'glitch'];
export const HISTORY_RESULTS = ['bought', 'declined', 'uncertain', 'dryrun'];

const text = (value, max) => (typeof value === 'string' && value.length ? value.slice(0, max) : null);
const positive = value => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);
const randomId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = text(entry.id, 100);
  const item = text(entry.item, 100);
  const { time, qty } = entry;
  if (!id || !item || typeof time !== 'number' || !Number.isFinite(time) || time <= 0) return null;
  if (!HISTORY_SOURCES.includes(entry.source) || !HISTORY_RESULTS.includes(entry.result)) return null;
  if (!Number.isSafeInteger(qty) || qty < 1) return null;
  const price = positive(entry.price);
  const record = {
    id, time, source: entry.source, result: entry.result, item,
    name: text(entry.name, 200) ?? item, qty, price, total: price == null ? null : price * qty,
  };
  const message = text(entry.message, 300);
  if (message) record.message = message;
  return record;
}

export function normalizeHistory(list) {
  if (!Array.isArray(list)) return [];
  const entries = list.map(normalizeEntry).filter(Boolean);
  entries.sort((a, b) => a.time - b.time);
  return entries.slice(-MAX_HISTORY);
}

// Writes are queued per storage area so concurrent callers never drop each other's entries.
const queues = new WeakMap();

export function addHistory(storage, entry, { now = Date.now(), id = randomId() } = {}) {
  const previous = queues.get(storage) ?? Promise.resolve();
  const task = previous.then(async () => {
    const record = normalizeEntry({ ...entry, id, time: now });
    if (!record) return null;
    const { history } = await storage.get('history');
    await storage.set({ history: normalizeHistory([...normalizeHistory(history), record]) });
    return record;
  });
  queues.set(storage, task.catch(() => null));
  return task;
}

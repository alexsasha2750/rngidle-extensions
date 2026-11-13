// Pure helpers for the History tab.
import { localDay } from './popup-format.js';

export const FILTERS = ['all', 'shop', 'black', 'glitch'];

const SOURCES = {
  shop: 'Glim’s shop',
  bundle: 'Glim’s shop · bundle',
  black: 'Black Market',
  glitch: 'Glitch',
};
const RESULTS = {
  bought: { text: 'Bought', tone: 'ok' },
  declined: { text: 'Declined', tone: 'bad' },
  uncertain: { text: 'Result unknown', tone: 'warn' },
  dryrun: { text: 'Dry run', tone: 'dry' },
};

export const sourceLabel = entry => SOURCES[entry?.source] ?? 'Shop';
export const resultInfo = entry => RESULTS[entry?.result] ?? { text: 'Unknown', tone: 'warn' };

// Entries are stored oldest first; the list shows the newest first.
export function visibleEntries(list, filter) {
  const entries = Array.isArray(list) ? list.filter(entry => entry && typeof entry === 'object') : [];
  const wanted = FILTERS.includes(filter) ? filter : 'all';
  return entries
    .filter(entry => wanted === 'all' || (wanted === 'shop' ? entry.source === 'shop' || entry.source === 'bundle' : entry.source === wanted))
    .slice()
    .reverse();
}

// Only real purchases count towards what was spent.
export function totals(list, now = Date.now()) {
  const today = localDay(now);
  let spentToday = 0, boughtToday = 0, spent = 0;
  for (const entry of Array.isArray(list) ? list : []) {
    if (entry?.result !== 'bought') continue;
    const total = Number(entry.total);
    const amount = Number.isFinite(total) && total > 0 ? total : 0;
    spent += amount;
    if (localDay(entry.time) === today) { spentToday += amount; boughtToday += 1; }
  }
  return { spentToday, boughtToday, spent };
}

export function entryTitle(entry) {
  const name = String(entry?.name || entry?.item || 'Item');
  const qty = Number(entry?.qty);
  return Number.isFinite(qty) && qty > 1 ? `${qty} × ${name}` : name;
}

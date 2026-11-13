// Pure helpers for Glitch's market. Glitch asks a timed trial before every purchase and
// the game keeps the answers on its server, so nothing here answers for the player.

export const ITEM_ID = /^[a-z0-9_]{1,48}$/;
export const MAX_ANSWER_LENGTH = 200;
const MAX_WANTED = 24;

export const REASONS = {
  away: 'Glitch is not here right now.',
  bought: 'You already bought this.',
  sold: 'It is sold out.',
  poor: 'Not enough EP.',
  invalid: 'Glitch is not offering this.',
};

export function walletOf(shop) {
  const value = Number(shop?.wallet?.effective);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

// Same rules as the game's own button: sold out or already bought, too poor, or Glitch away.
export function offerState(offer, shop) {
  const price = Number(offer?.price);
  if (!offer || typeof offer.id !== 'string' || !ITEM_ID.test(offer.id) || !Number.isFinite(price) || price <= 0) {
    return { buyable: false, reason: 'invalid' };
  }
  if (offer.bought) return { buyable: false, reason: 'bought' };
  if (!(Number(offer.left) > 0)) return { buyable: false, reason: 'sold' };
  if (!shop?.open) return { buyable: false, reason: 'away' };
  const wallet = walletOf(shop);
  if (wallet != null && wallet < price) return { buyable: false, reason: 'poor' };
  return { buyable: true, reason: '' };
}

export function normalizePrefs(value) {
  const ids = [];
  for (const id of Array.isArray(value?.itemIds) ? value.itemIds : []) {
    if (typeof id === 'string' && ITEM_ID.test(id) && !ids.includes(id) && ids.length < MAX_WANTED) ids.push(id);
  }
  return { alert: value?.alert === true, itemIds: ids };
}

// Wares worth an alert: buyable now, and ticked if the player ticked any.
export function wantedAvailable(prefs, shop) {
  if (!shop?.open || !Array.isArray(shop.items)) return [];
  const wanted = new Set(normalizePrefs(prefs).itemIds);
  return shop.items
    .filter(offer => offerState(offer, shop).buyable && (wanted.size === 0 || wanted.has(offer.id)))
    .map(offer => offer.id);
}

export const visitKey = shop => (shop?.open ? String(shop.endsAt ?? shop.slot ?? '') : '');

// The public part of /api/glitch, trimmed to what the menu needs.
export function normalizeShop(data, wallet) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.items)) return null;
  const items = [];
  for (const raw of data.items) {
    if (!raw || typeof raw.id !== 'string' || !ITEM_ID.test(raw.id)) continue;
    items.push({
      id: raw.id,
      price: Number(raw.price),
      left: Number(raw.left) || 0,
      bought: raw.bought ? 1 : 0,
      stock: raw.stock == null ? null : Number(raw.stock),
    });
  }
  const effective = Number(wallet?.effective ?? data.wallet?.effective);
  return {
    open: data.open === true,
    slot: data.slot ?? null,
    endsAt: Number.isFinite(Number(data.endsAt)) ? Number(data.endsAt) : null,
    now: Number.isFinite(Number(data.now)) ? Number(data.now) : null,
    wallet: Number.isFinite(effective) && effective >= 0 ? { effective } : null,
    items,
  };
}

const isId = value => (typeof value === 'string' && value.length > 0 && value.length <= 120)
  || (typeof value === 'number' && Number.isFinite(value));
export const isAnswer = value => (typeof value === 'string' && value.length <= MAX_ANSWER_LENGTH)
  || (typeof value === 'number' && Number.isFinite(value));

// A question from /api/glitch/trial[/answer]. Ids and choices keep their original type so they
// are sent back exactly as the server gave them.
export function parseQuestion(data) {
  if (!data || typeof data !== 'object' || !isId(data.id)) return null;
  const step = Number(data.step), steps = Number(data.steps), ms = Number(data.ms);
  if (!Number.isInteger(step) || !Number.isInteger(steps) || steps < 1 || steps > 10 || step < 0 || step >= steps) return null;
  if (!Number.isFinite(ms) || ms <= 0 || ms > 600000) return null;
  if (typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 800) return null;
  let choices = null;
  if (data.choices != null) {
    if (!Array.isArray(data.choices) || data.choices.length < 2 || data.choices.length > 12 || !data.choices.every(isAnswer)) return null;
    choices = [...data.choices];
  }
  return { id: data.id, step, steps, prompt: data.prompt, choices, ms };
}

export function clampRest(value) {
  const rest = Number(value);
  return Number.isFinite(rest) && rest > 0 ? Math.min(rest, 60000) : 8000;
}

// The server's reply to an answer: wrong or late, passed, or the next question.
export function interpretAnswer(data) {
  if (!data || typeof data !== 'object') return { kind: 'bad' };
  if (!data.ok) {
    return {
      kind: 'failed',
      late: data.late === true,
      answer: data.answer == null ? '' : String(data.answer).slice(0, MAX_ANSWER_LENGTH),
      rest: clampRest(data.rest),
    };
  }
  if (data.passed) return isId(data.id) ? { kind: 'passed', id: data.id } : { kind: 'bad' };
  const question = parseQuestion(data);
  return question ? { kind: 'next', question } : { kind: 'bad' };
}

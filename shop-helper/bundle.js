// Glim's bundle as its own auto-buy setting. The planner (logic.js) still buys a bundle through a
// rule of the form { uid, id: 'bundle', quantity, mode }; this module turns the bundle settings
// into that rule and decides whether a particular bundle on offer passes the player's filters.

export const MAX_QUANTITY = 1000;
export const BUNDLE_UID = 'bundle:main';

const money = value => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};
const whole = (value, fallback, min, max) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
};

export function defaultBundle() {
  return { enabled: false, uid: '', mode: 'restock', quantity: 1, maxPrice: null, minDiscount: 0, contains: [], reserve: 0 };
}

export function normalizeBundle(value) {
  const contains = [];
  for (const id of Array.isArray(value?.contains) ? value.contains : []) {
    if (typeof id === 'string' && /^[a-z0-9_]{1,48}$/.test(id) && !contains.includes(id) && contains.length < 40) contains.push(id);
  }
  const discount = Number(value?.minDiscount);
  return {
    enabled: value?.enabled === true,
    uid: typeof value?.uid === 'string' && value.uid.length <= 80 ? value.uid : '',
    mode: value?.mode === 'once' ? 'once' : 'restock',
    quantity: whole(value?.quantity, 1, 1, MAX_QUANTITY),
    maxPrice: money(value?.maxPrice),
    minDiscount: Number.isFinite(discount) ? Math.min(99, Math.max(0, discount)) : 0,
    contains,
    reserve: money(value?.reserve) ?? 0,
  };
}

// The old "Any bundle" rule from the shop list, carried over so nothing the player set up is lost.
export function fromLegacyRule(rule) {
  return normalizeBundle({
    enabled: true,
    uid: typeof rule?.uid === 'string' ? rule.uid : '',
    mode: rule?.mode,
    quantity: rule?.quantity,
  });
}

// Percent off, from the offer's listed value and price (0 when the game lists no value).
export function discountOf(offer) {
  const value = Number(offer?.value), price = Number(offer?.price);
  if (!(value > 0) || !(price >= 0) || price > value) return 0;
  return ((value - price) / value) * 100;
}

// Does this bundle pass the player's filters? Returns { ok, reason } where reason is a short code
// the menu turns into a sentence: 'price' | 'discount' | 'contains'.
export function bundleAllowed(bundle, offer) {
  const settings = normalizeBundle(bundle);
  const price = Number(offer?.price);
  if (settings.maxPrice !== null && price > settings.maxPrice) return { ok: false, reason: 'price' };
  // A hair of slack so a listed 10% off is not rejected as 9.99999% by rounding.
  if (settings.minDiscount > 0 && discountOf(offer) + 1e-9 < settings.minDiscount) return { ok: false, reason: 'discount' };
  if (settings.contains.length) {
    const items = offer?.items && typeof offer.items === 'object' ? Object.keys(offer.items) : [];
    if (!settings.contains.some(id => items.includes(id))) return { ok: false, reason: 'contains' };
  }
  return { ok: true, reason: '' };
}

// The rule the planner buys through, or null when bundle buying is off.
export function bundleRule(bundle) {
  const settings = normalizeBundle(bundle);
  if (!settings.enabled) return null;
  return { uid: settings.uid || BUNDLE_UID, id: 'bundle', quantity: settings.quantity, mode: settings.mode };
}

// New-format settings (`settings.bundle` is an object) own the bundle completely and any old
// 'bundle' rule is ignored; old settings without it keep working through the rule they had.
export function rulesOf(settings) {
  const rules = Array.isArray(settings?.rules) ? settings.rules : [];
  if (!settings?.bundle || typeof settings.bundle !== 'object') return rules;
  const rule = bundleRule(settings.bundle);
  const others = rules.filter(entry => entry?.id !== 'bundle');
  return rule ? [...others, rule] : others;
}

export const withBundleRule = settings => (settings && typeof settings === 'object' ? { ...settings, rules: rulesOf(settings) } : settings);

// The part of the settings that changes what gets bought, to notice edits made mid-purchase.
export function bundleSignature(settings) {
  const bundle = settings?.bundle;
  if (!bundle || typeof bundle !== 'object') return 'legacy';
  const { enabled, mode, quantity, maxPrice, minDiscount, contains, reserve } = normalizeBundle(bundle);
  return JSON.stringify({ enabled, mode, quantity, maxPrice, minDiscount, contains: [...contains].sort(), reserve });
}

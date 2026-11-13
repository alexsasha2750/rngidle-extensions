import { bundleAllowed, rulesOf } from './bundle.js';

export const MAX_BUNDLES_PER_SHOP = 3;

export function shopKey(shop) {
  if (!shop || (typeof shop.slot !== 'number' && typeof shop.slot !== 'string')) return null;
  return `${shop.slot}:${shop.reroll ?? 0}`;
}

function validRule(rule) {
  return rule && typeof rule.uid === 'string' && typeof rule.id === 'string' &&
    ['once', 'restock'].includes(rule.mode) && Number.isSafeInteger(rule.quantity) &&
    rule.quantity >= 1 && rule.quantity <= 1000;
}

// A spending cap allowance: Infinity when there is no cap; anything unusable fails closed.
const allowanceOf = budget => (typeof budget === 'number' && budget >= 0 ? budget : 0);

function chooseBundle(rule, previous, shop, key, wallet, budget = Infinity, filters = null) {
  if (previous?.status === 'complete' || previous?.status === 'uncertain' ||
      (previous?.status === 'error' && previous.lastSlot === key)) return null;
  const offer = shop.bundle ?? shop.items.find(entry => entry.id === 'bundle');
  const left = Number(offer?.left);
  const bought = offer?.bought == null ? 0 : Number(offer.bought);
  const price = Number(offer?.price);
  if (!Number.isSafeInteger(left) || left < 1 || !Number.isSafeInteger(bought) || bought < 0 ||
      !Number.isFinite(price) || price <= 0) return null;

  const stock = Math.min(left, Math.max(0, MAX_BUNDLES_PER_SHOP - bought));
  // EP the player asked to keep is not spent on bundles.
  const reserve = filters ? Math.max(0, Number(filters.reserve) || 0) : 0;
  const affordable = Math.floor(Math.max(0, wallet - reserve) / price);
  if (filters && !bundleAllowed(filters, offer).ok) return null;
  let targetQuantity;
  if (rule.mode === 'once') {
    if (previous?.totalBought > 0 && previous.lastSlot !== key) return null;
    targetQuantity = previous?.targetQuantity ?? Math.min(rule.quantity, stock, affordable);
    if (!Number.isSafeInteger(targetQuantity) || targetQuantity < 1) return null;
    if ((previous?.totalBought ?? 0) >= targetQuantity) return null;
  } else {
    if (previous?.lastSlot === key && previous?.status === 'error') return null;
    targetQuantity = previous?.lastSlot === key && Number.isSafeInteger(previous.slotTarget)
      ? previous.slotTarget
      : Math.min(rule.quantity, stock, affordable);
    if (!Number.isSafeInteger(targetQuantity) || targetQuantity < 1) return null;
    if (previous?.lastSlot === key && (previous.slotBought ?? 0) >= targetQuantity) return null;
  }

  if (stock < 1 || affordable < 1) return null;
  // The cap only gates the next bundle; it never shrinks a once-mode target.
  if (price > budget) return null;
  return {
    rule,
    item: { id: 'bundle', name: typeof offer.name === 'string' ? offer.name : 'Glim bundle', price },
    quantity: 1,
    targetQuantity,
    reserve,
    key,
    kind: 'bundle'
  };
}

export function choosePurchase(settings, progress, shop, catalog, budget = Infinity) {
  const key = shopKey(shop);
  if (!key || !shop.open || shop.eaten || !Array.isArray(shop.items)) return null;
  const wallet = Number(shop.wallet?.effective);
  if (!Number.isFinite(wallet) || wallet < 0) return null;
  const allowance = allowanceOf(budget);

  const filters = settings.bundle && typeof settings.bundle === 'object' ? settings.bundle : null;
  for (const rule of rulesOf(settings)) {
    if (!validRule(rule)) continue;
    const previous = progress[rule.uid];
    if (rule.id === 'bundle') {
      const bundle = chooseBundle(rule, previous, shop, key, wallet, allowance, filters);
      if (bundle) return bundle;
      continue;
    }
    if (previous?.status === 'complete' || previous?.status === 'uncertain' || previous?.lastSlot === key) continue;

    const item = catalog.find(entry => entry.id === rule.id);
    const offer = shop.items.find(entry => entry.id === rule.id);
    if (!item || !offer || !Number.isFinite(item.price) || item.price <= 0) continue;

    const remaining = offer.left == null ? Infinity : Math.max(0, Number(offer.left));
    const limit = offer.perPlayer == null ? Infinity
      : Math.max(0, Number(offer.perPlayer) - Number(offer.bought || 0));
    const quantity = Math.min(rule.quantity, 1000, remaining, limit, Math.floor(wallet / item.price),
      Math.floor(allowance / item.price));

    if (Number.isSafeInteger(quantity) && quantity > 0) return { rule, item, quantity, key };
  }
  return null;
}

// How many bundles a bundle selection would go on to buy in this shop (one request each), for
// the dry run, which simulates the whole run as one entry.
export function bundleRunLength(selection, previous, shop, budget = Infinity) {
  const offer = shop?.bundle ?? shop?.items?.find(entry => entry.id === 'bundle');
  const price = Number(selection?.item?.price);
  if (!offer || !Number.isFinite(price) || price <= 0) return 1;
  const bought = offer.bought == null ? 0 : Number(offer.bought);
  const stock = Math.min(Number(offer.left), Math.max(0, MAX_BUNDLES_PER_SHOP - bought));
  const already = selection.rule?.mode === 'once'
    ? previous?.totalBought ?? 0
    : (previous?.lastSlot === selection.key ? previous.slotBought ?? 0 : 0);
  const count = Math.min(selection.targetQuantity - already, stock,
    Math.floor(Math.max(0, Number(shop.wallet?.effective) - (Number(selection.reserve) || 0)) / price), Math.floor(allowanceOf(budget) / price));
  return Number.isSafeInteger(count) && count > 1 ? count : 1;
}

function listedPrice(offer) {
  const price = Number(offer?.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

// The Black Market filters as one predicate, shared by auto-buy and the match alert. Returns
// null when nothing on this shelf can match, else offer => { id, name, price, left } | null.
// Wallet, the `enabled` flag and per-item progress are left to the caller.
function blackMarketFilter(filters, market, catalog) {
  if (!market?.open || market.dealt || market.eaten || !Array.isArray(market.items) || !Array.isArray(catalog)) return null;
  const minimumPrice = Number(filters?.minimumPrice);
  if (filters?.minimumEnabled === true && (!Number.isFinite(minimumPrice) || minimumPrice < 0)) return null;
  const selected = new Set(Array.isArray(filters?.itemIds) ? filters.itemIds.filter(id => typeof id === 'string') : []);
  const items = new Map(catalog.filter(item => item && typeof item.id === 'string').map(item => [item.id, item]));
  const prices = market.items.map(listedPrice);
  if (filters?.mostExpensive === true && prices.some(price => price == null)) return null;
  const validPrices = prices.filter(Number.isFinite);
  const highestPrice = validPrices.length ? Math.max(...validPrices) : null;

  return offer => {
    if (!offer || typeof offer.id !== 'string') return null;
    const item = items.get(offer.id);
    const price = listedPrice(offer);
    const left = Number(offer.left);
    if (!item || price == null || !Number.isSafeInteger(left) || left < 1 || offer.bought) return null;
    if (filters?.mostExpensive === true && price !== highestPrice) return null;
    if (filters?.selectedOnly === true && !selected.has(offer.id)) return null;
    if (filters?.minimumEnabled === true && price < minimumPrice) return null;
    return { id: item.id, name: typeof item.name === 'string' ? item.name : item.id, price, left };
  };
}

export function blackMarketMatches(filters, market, catalog) {
  const match = blackMarketFilter(filters, market, catalog);
  return match ? market.items.map(match).filter(Boolean) : [];
}

export function chooseBlackMarketPurchase(settings, progress, market, catalog, budget = Infinity) {
  const filters = settings?.blackMarket;
  const key = shopKey(market);
  if (filters?.enabled !== true || !key) return null;
  const match = blackMarketFilter(filters, market, catalog);
  if (!match) return null;
  if (progress['blackMarket:deal']?.lastSlot === key) return null;

  const wallet = Number(market.wallet?.effective);
  if (!Number.isFinite(wallet) || wallet < 0) return null;
  const allowance = allowanceOf(budget);

  for (const offer of market.items) {
    const found = match(offer);
    if (!found) continue;
    const uid = `blackMarket:${offer.id}`;
    const previous = progress[uid];
    if (previous?.lastSlot === key || previous?.status === 'uncertain' || wallet < found.price || found.price > allowance) continue;
    return {
      kind: 'blackMarket',
      uid,
      item: { id: found.id, name: found.name, price: found.price },
      quantity: 1,
      price: found.price,
      key,
      slot: market.slot
    };
  }
  return null;
}

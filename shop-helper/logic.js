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

function chooseBundle(rule, previous, shop, key, wallet) {
  if (previous?.status === 'complete' || previous?.status === 'uncertain' ||
      (previous?.status === 'error' && previous.lastSlot === key)) return null;
  const offer = shop.bundle ?? shop.items.find(entry => entry.id === 'bundle');
  const left = Number(offer?.left);
  const bought = offer?.bought == null ? 0 : Number(offer.bought);
  const price = Number(offer?.price);
  if (!Number.isSafeInteger(left) || left < 1 || !Number.isSafeInteger(bought) || bought < 0 ||
      !Number.isFinite(price) || price <= 0) return null;

  const stock = Math.min(left, Math.max(0, MAX_BUNDLES_PER_SHOP - bought));
  const affordable = Math.floor(wallet / price);
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
  return {
    rule,
    item: { id: 'bundle', name: typeof offer.name === 'string' ? offer.name : 'Glim bundle', price },
    quantity: 1,
    targetQuantity,
    key,
    kind: 'bundle'
  };
}

export function choosePurchase(settings, progress, shop, catalog) {
  const key = shopKey(shop);
  if (!key || !shop.open || shop.eaten || !Array.isArray(shop.items)) return null;
  const wallet = Number(shop.wallet?.effective);
  if (!Number.isFinite(wallet) || wallet < 0) return null;

  for (const rule of settings.rules || []) {
    if (!validRule(rule)) continue;
    const previous = progress[rule.uid];
    if (rule.id === 'bundle') {
      const bundle = chooseBundle(rule, previous, shop, key, wallet);
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
    const quantity = Math.min(rule.quantity, 1000, remaining, limit, Math.floor(wallet / item.price));

    if (Number.isSafeInteger(quantity) && quantity > 0) return { rule, item, quantity, key };
  }
  return null;
}

function listedPrice(offer) {
  const price = Number(offer?.price);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function chooseBlackMarketPurchase(settings, progress, market, catalog) {
  const filters = settings?.blackMarket;
  const key = shopKey(market);
  if (filters?.enabled !== true || !key || !market.open || market.dealt || market.eaten ||
      !Array.isArray(market.items) || !Array.isArray(catalog)) return null;
  if (progress['blackMarket:deal']?.lastSlot === key) return null;

  const wallet = Number(market.wallet?.effective);
  if (!Number.isFinite(wallet) || wallet < 0) return null;
  const minimumPrice = Number(filters.minimumPrice);
  if (filters.minimumEnabled === true && (!Number.isFinite(minimumPrice) || minimumPrice < 0)) return null;
  const selected = new Set(Array.isArray(filters.itemIds) ? filters.itemIds.filter(id => typeof id === 'string') : []);
  const items = new Map(catalog.filter(item => item && typeof item.id === 'string').map(item => [item.id, item]));
  const prices = market.items.map(listedPrice);
  if (filters.mostExpensive === true && prices.some(price => price == null)) return null;
  const validPrices = prices.filter(Number.isFinite);
  const highestPrice = validPrices.length ? Math.max(...validPrices) : null;

  for (const offer of market.items) {
    if (!offer || typeof offer.id !== 'string') continue;
    const item = items.get(offer.id);
    const price = listedPrice(offer);
    const left = Number(offer.left);
    const uid = `blackMarket:${offer.id}`;
    const previous = progress[uid];
    if (!item || price == null || !Number.isSafeInteger(left) || left < 1 || offer.bought || previous?.lastSlot === key ||
        previous?.status === 'uncertain' || wallet < price) continue;
    if (filters.mostExpensive === true && price !== highestPrice) continue;
    if (filters.selectedOnly === true && !selected.has(offer.id)) continue;
    if (filters.minimumEnabled === true && price < minimumPrice) continue;
    return {
      kind: 'blackMarket',
      uid,
      item: { id: item.id, name: typeof item.name === 'string' ? item.name : item.id, price },
      quantity: 1,
      price,
      key,
      slot: market.slot
    };
  }
  return null;
}

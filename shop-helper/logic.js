export function shopKey(shop) {
  if (!shop || (typeof shop.slot !== 'number' && typeof shop.slot !== 'string')) return null;
  return `${shop.slot}:${shop.reroll ?? 0}`;
}

export function choosePurchase(settings, progress, shop, catalog) {
  const key = shopKey(shop);
  if (!key || !shop.open || shop.eaten || !Array.isArray(shop.items)) return null;
  const wallet = Number(shop.wallet?.effective);
  if (!Number.isFinite(wallet) || wallet < 0) return null;
  for (const rule of settings.rules || []) {
    if (!rule || typeof rule.uid !== 'string' || typeof rule.id !== 'string' || !['once', 'restock'].includes(rule.mode)) continue;
    if (!Number.isSafeInteger(rule.quantity) || rule.quantity < 1 || rule.quantity > 1000) continue;
    const previous = progress[rule.uid];
    if (previous?.status === 'complete' || previous?.status === 'uncertain' || previous?.lastSlot === key) continue;
    const item = catalog.find(entry => entry.id === rule.id);
    const offer = shop.items.find(entry => entry.id === rule.id);
    if (!item || !offer || !Number.isFinite(item.price) || item.price <= 0) continue;
    const remaining = offer.left == null ? Infinity : Math.max(0, Number(offer.left));
    const limit = offer.perPlayer == null ? Infinity : Math.max(0, Number(offer.perPlayer) - Number(offer.bought || 0));
    const quantity = Math.min(rule.quantity, 1000, remaining, limit, Math.floor(wallet / item.price));
    if (Number.isSafeInteger(quantity) && quantity > 0) return { rule, item, quantity, key };
  }
  return null;
}

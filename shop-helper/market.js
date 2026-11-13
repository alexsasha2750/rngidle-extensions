// Live state of Glim's shop and the Black Market, trimmed for the menu (MARKET_STATUS).

const ITEM_ID = /^[A-Za-z0-9_:.-]{1,64}$/;
export const MAX_MARKET_ITEMS = 50;

function finite(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function walletOf(data) {
  const value = finite(data?.wallet?.effective);
  return value != null && value >= 0 ? value : null;
}

const time = value => {
  const number = finite(value);
  return number != null && number >= 0 ? number : null;
};

export function shopStatus(data) {
  if (!data || typeof data !== 'object') return null;
  return { open: Boolean(data.open), eaten: Boolean(data.eaten), endsAt: time(data.endsAt), now: time(data.now) };
}

export function blackStatus(data) {
  if (!data || typeof data !== 'object') return null;
  const items = [];
  for (const raw of Array.isArray(data.items) ? data.items : []) {
    if (items.length >= MAX_MARKET_ITEMS) break;
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !ITEM_ID.test(raw.id)) continue;
    const price = finite(raw.price);
    const left = finite(raw.left);
    items.push({
      id: raw.id,
      price: price != null && price > 0 ? price : null,
      left: Number.isSafeInteger(left) && left >= 0 ? left : null,
      bought: raw.bought === true || Number(raw.bought) > 0,
    });
  }
  return {
    open: Boolean(data.open), dealt: Boolean(data.dealt), eaten: Boolean(data.eaten),
    endsAt: time(data.endsAt), now: time(data.now), items,
  };
}

// `shop`, `black` and `inventory` are raw replies from the content script ({ ok, data, error }).
export function marketStatus({ tab, shop, black, inventory } = {}) {
  if (!tab) return { ok: true, tab: { open: false, signedIn: false }, wallet: null, shop: null, black: null };
  const shopData = shop?.ok ? shopStatus(shop.data) : null;
  const blackData = black?.ok ? blackStatus(black.data) : null;
  const wallet = (shop?.ok ? walletOf(shop.data) : null)
    ?? (black?.ok ? walletOf(black.data) : null)
    ?? (inventory?.ok ? walletOf(inventory.data) : null);
  const reply = { ok: true, tab: { open: true, signedIn: tab.signedIn === true }, wallet, shop: shopData, black: blackData };
  if (shopData || blackData) return reply;
  const reason = [shop?.error, black?.error].find(value => typeof value === 'string' && value) || 'unknown error';
  return { ...reply, ok: false, error: `Could not load Glim's shop or the Black Market: ${reason.slice(0, 200)}` };
}

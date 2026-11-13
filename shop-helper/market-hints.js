// Pure helpers for the "Shops right now" card.
import { ep } from './popup-format.js';

// How an offer's price sits against the player's EP.
export function priceHint(price, wallet) {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(wallet)) return { tone: 'unknown', text: '' };
  if (price <= wallet) {
    const share = wallet > 0 ? (price / wallet) * 100 : 100;
    const text = share < 1 ? 'Under 1% of your EP' : `${share >= 10 ? Math.round(share) : share.toFixed(1)}% of your EP`;
    return { tone: 'ok', text };
  }
  return { tone: 'short', text: `Need ${ep(price - wallet)} more` };
}

// Milliseconds left in the current slot, corrected for the game server's clock.
export function slotLeft(part, skew, now = Date.now()) {
  if (!part || !Number.isFinite(part.endsAt)) return null;
  return Math.max(0, part.endsAt - (now + skew));
}

export function skewOf(data) {
  const now = data?.shop?.now ?? data?.black?.now;
  return Number.isFinite(now) ? now - Date.now() : 0;
}

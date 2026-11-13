// "Shops right now": when each shop restocks, and how the live Black Market offers compare
// with the EP you have. Reads through the background worker; never buys anything.
import { clock, ep, make, send } from './popup-format.js';
import { priceHint, skewOf, slotLeft } from './market-hints.js';

const $ = id => document.getElementById(id);
const el = {
  panel: $('panel-autobuy'),
  sub: $('market-sub'), wallet: $('market-wallet'),
  shopState: $('market-shop-state'), shopClock: $('market-shop-clock'),
  blackState: $('market-black-state'), blackClock: $('market-black-clock'),
  offersWrap: $('market-offers-wrap'), offers: $('market-offers'),
};
const POLL_MS = 10000;
const state = { data: null, error: '', names: new Map(), loading: true };

function renderTiles() {
  const { data } = state;
  const skew = skewOf(data);
  const shop = data?.shop, black = data?.black;
  const shopLeft = slotLeft(shop, skew), blackLeft = slotLeft(black, skew);

  el.shopState.textContent = !shop ? '—' : shop.open && !shop.eaten ? 'Open' : 'Closed';
  el.shopState.dataset.tone = !shop ? 'idle' : shop.open && !shop.eaten ? 'good' : 'away';
  el.shopClock.textContent = !shop || shopLeft == null ? '' : shopLeft > 0
    ? `${shop.open && !shop.eaten ? 'Restocks' : 'Next slot'} in ${clock(shopLeft)}` : 'Updating…';

  const blackOpen = !!black && black.open && !black.eaten;
  el.blackState.textContent = !black ? '—' : blackOpen ? (black.dealt ? 'Deal made' : 'Open') : 'Closed';
  el.blackState.dataset.tone = !black ? 'idle' : blackOpen ? 'good' : 'away';
  el.blackClock.textContent = !black || blackLeft == null ? '' : blackLeft > 0
    ? `${blackOpen ? 'Closes' : 'Next slot'} in ${clock(blackLeft)}` : 'Updating…';
}

function renderOffers() {
  const { data } = state;
  const black = data?.black;
  const show = !!black && black.open && !black.eaten && black.items.length > 0;
  el.offersWrap.hidden = !show;
  el.offers.replaceChildren();
  if (!show) return;
  const wallet = data.wallet;
  for (const offer of black.items) {
    const gone = offer.left < 1 || offer.bought > 0;
    const hint = gone ? { tone: 'gone', text: offer.bought > 0 ? 'Already bought' : 'Sold out' } : priceHint(offer.price, wallet);
    const row = make('li', `offer is-${hint.tone}`);
    const top = make('div', 'offer-top');
    top.append(make('span', 'offer-name', state.names.get(offer.id) || offer.id.replace(/_/g, ' ')), make('span', 'offer-price', `${ep(offer.price)} EP`));
    row.append(top, make('span', 'offer-hint', hint.text || 'Sign in to compare with your EP'));
    el.offers.append(row);
  }
}

function render() {
  const { data } = state;
  el.wallet.textContent = data && Number.isFinite(data.wallet) ? `EP ${ep(data.wallet)}` : 'EP —';
  el.sub.textContent = state.error ? state.error
    : state.loading ? 'Checking the game…'
    : data?.tab && !data.tab.open ? 'Open an RNGidle tab to see the shops.'
    : data?.tab && !data.tab.signedIn ? 'Sign in to RNGidle to compare prices with your EP.'
    : 'Live from the game tab.';
  renderTiles();
  renderOffers();
}

async function refresh() {
  const reply = await send({ type: 'MARKET_STATUS' });
  state.loading = false;
  if (reply.ok) { state.error = ''; state.data = reply; } else { state.error = reply.error || 'Could not reach the game.'; }
  render();
}

async function init() {
  fetch(chrome.runtime.getURL('black-catalog.json')).then(r => r.json()).then(list => {
    if (Array.isArray(list)) state.names = new Map(list.filter(i => i && typeof i.id === 'string').map(i => [i.id, String(i.name || i.id)]));
    renderOffers();
  }).catch(() => {});
  render();
  void refresh();
  setInterval(renderTiles, 1000);
  setInterval(() => { if (!document.hidden && !el.panel.hidden) void refresh(); }, POLL_MS);
  new MutationObserver(() => { if (!el.panel.hidden) void refresh(); }).observe(el.panel, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !el.panel.hidden) void refresh(); });
}

void init();

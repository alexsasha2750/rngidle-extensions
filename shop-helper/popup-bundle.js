// The Bundles panel in the Auto-buy tab: its own switch, how often and how many to buy, the
// filters (price, discount, reserve, contents), and a live look at Glim's current bundle with a
// verdict on whether the settings would buy it. popup.js owns the draft and the Save button;
// this module edits the draft through the callbacks it is given.
import { bundleAllowed, discountOf, MAX_QUANTITY } from './bundle.js';
import { formatCompactEP, parseEP } from './ep-format.js';
import { make, send } from './popup-format.js';

const t = (key, params) => globalThis.shopHelperI18n.t(key, params);
const POLL_MS = 10000;

export function epText(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '';
  const compact = formatCompactEP(value);
  const back = parseEP(compact);
  return back && Math.abs(back.value - value) <= Math.abs(value) * 1e-9 ? compact : String(value);
}

// '' → { empty: true }; a valid amount → { value }; anything else → { invalid: true }.
export function readEP(text) {
  if (!String(text ?? '').trim()) return { empty: true };
  const parsed = parseEP(text);
  return parsed ? { value: parsed.value } : { invalid: true };
}

// What the settings would do with the bundle on offer: a short code the panel turns into a sentence.
export function verdictFor(settings, shop, wallet) {
  const offer = shop?.bundle;
  if (!offer) return null;
  if (!shop.open || shop.eaten) return 'closed';
  if (offer.left !== null && offer.left < 1) return 'sold';
  const allowed = bundleAllowed(settings, offer);
  if (!allowed.ok) return allowed.reason;
  if (Number.isFinite(wallet) && offer.price > Math.max(0, wallet - (Number(settings.reserve) || 0))) return 'poor';
  return settings.enabled ? 'would' : 'off';
}

export function createBundlePanel(api) {
  const $ = id => document.getElementById(id);
  const el = {
    panel: $('subpanel-bundle'),
    enabled: $('bundle-enabled'), progress: $('bundle-progress'),
    modeRadios: [...document.querySelectorAll('input[name="bundle-mode"]')], modeHelp: $('bundle-mode-help'),
    quantity: $('bundle-quantity'), quantityLabel: $('bundle-quantity-label'), quantityError: $('bundle-quantity-error'),
    maxOn: $('bundle-max-price-on'), max: $('bundle-max-price'), maxError: $('bundle-max-price-error'),
    discountOn: $('bundle-discount-on'), discount: $('bundle-discount'), discountError: $('bundle-discount-error'),
    reserveOn: $('bundle-reserve-on'), reserve: $('bundle-reserve'), reserveError: $('bundle-reserve-error'),
    count: $('bundle-contains-count'), search: $('bundle-search'), list: $('bundle-list'), listEmpty: $('bundle-list-empty'),
    nowEmpty: $('bundle-now-empty'), nowBody: $('bundle-now-body'), nowName: $('bundle-now-name'), nowTier: $('bundle-now-tier'),
    nowMeta: $('bundle-now-meta'), nowItems: $('bundle-now-items'), nowVerdict: $('bundle-now-verdict'),
  };
  // A filter can be switched on before it has a value; it counts as on, and blocks Save, until it does.
  const armed = { maxPrice: false, minDiscount: false, reserve: false };
  const errors = { quantity: '', maxPrice: '', minDiscount: '', reserve: '' };
  let market = null;
  let query = '';

  const bundle = () => api.getBundle();
  const isOn = field => armed[field] || (field === 'minDiscount' ? bundle().minDiscount > 0 : field === 'reserve' ? bundle().reserve > 0 : bundle().maxPrice !== null);

  function showError(node, message) {
    node.hidden = !message;
    node.textContent = message;
  }

  function nameOf(id) {
    return api.getNames().get(id) || id.replace(/_/g, ' ').replace(/^./, letter => letter.toUpperCase());
  }

  function renderDisabled() {
    const busy = !api.canEdit();
    for (const control of [el.enabled, el.quantity, el.maxOn, el.discountOn, el.reserveOn, el.search, ...el.modeRadios]) control.disabled = busy;
    el.max.disabled = busy || !isOn('maxPrice');
    el.discount.disabled = busy || !isOn('minDiscount');
    el.reserve.disabled = busy || !isOn('reserve');
    for (const box of el.list.querySelectorAll('input')) box.disabled = busy;
  }

  function renderFields() {
    const settings = bundle();
    el.enabled.checked = settings.enabled;
    for (const radio of el.modeRadios) radio.checked = radio.value === settings.mode;
    el.modeHelp.textContent = t(settings.mode === 'once' ? 'bundle.modeOnceHelp' : 'bundle.modeRestockHelp');
    el.quantityLabel.textContent = t(settings.mode === 'once' ? 'bundle.quantityOnce' : 'bundle.quantityRestock');
    if (document.activeElement !== el.quantity) el.quantity.value = String(settings.quantity);

    el.maxOn.checked = isOn('maxPrice');
    el.discountOn.checked = isOn('minDiscount');
    el.reserveOn.checked = isOn('reserve');
    if (document.activeElement !== el.max) el.max.value = epText(settings.maxPrice);
    if (document.activeElement !== el.discount) el.discount.value = settings.minDiscount > 0 ? String(settings.minDiscount) : (armed.minDiscount ? el.discount.value || '10' : '10');
    if (document.activeElement !== el.reserve) el.reserve.value = settings.reserve > 0 ? epText(settings.reserve) : '';
    el.max.closest('label').classList.toggle('is-off', !isOn('maxPrice'));
    el.discount.closest('label').classList.toggle('is-off', !isOn('minDiscount'));
    el.reserve.closest('label').classList.toggle('is-off', !isOn('reserve'));
    for (const [field, node, message] of [['quantity', el.quantityError, errors.quantity], ['maxPrice', el.maxError, errors.maxPrice], ['minDiscount', el.discountError, errors.minDiscount], ['reserve', el.reserveError, errors.reserve]]) {
      showError(node, field in errors && (field === 'quantity' || isOn(field)) ? message : '');
    }
  }

  function renderList() {
    const selected = new Set(bundle().contains);
    const needle = query.trim().toLocaleLowerCase();
    const rows = api.getCatalog().filter(item => `${item.name} ${item.id}`.toLocaleLowerCase().includes(needle));
    el.list.replaceChildren();
    el.listEmpty.hidden = rows.length > 0;
    for (const item of rows) {
      const label = make('label', 'black-market-item');
      const box = make('input');
      box.type = 'checkbox';
      box.checked = selected.has(item.id);
      box.dataset.itemId = item.id;
      box.disabled = !api.canEdit();
      box.setAttribute('aria-label', t('bundle.containsAria', { name: item.name }));
      label.append(box, make('span', 'black-item-name', item.name));
      el.list.append(label);
    }
    el.count.textContent = t('bundle.containsCount', { count: selected.size });
  }

  function renderNow() {
    const settings = bundle();
    const open = market?.tab?.open === true;
    const shop = market?.shop ?? null;
    const offer = shop?.bundle ?? null;
    el.nowEmpty.hidden = open && !!shop;
    el.nowBody.hidden = !(open && offer);
    if (!open || !shop) { el.nowEmpty.textContent = t('bundle.nowOpenGame'); return; }
    if (!offer) { el.nowEmpty.hidden = false; el.nowEmpty.textContent = t('bundle.nowNone'); return; }
    el.nowName.textContent = `${offer.emoji ? `${offer.emoji} ` : ''}${offer.name || t('bundle.title')}`;
    el.nowTier.textContent = offer.tier;
    el.nowTier.hidden = !offer.tier;
    const percent = discountOf(offer);
    const bits = [t('bundle.nowPrice', { price: formatCompactEP(offer.price) })];
    if (percent > 0) bits.push(t('bundle.nowOff', { percent: Number(percent.toFixed(1)) }));
    if (offer.left !== null) bits.push(t('bundle.nowLeft', { count: offer.left }));
    el.nowMeta.textContent = bits.join(' · ');
    const contents = Object.entries(offer.items).map(([id, count]) => t('bundle.nowItemCount', { count, name: nameOf(id) }));
    el.nowItems.hidden = contents.length === 0;
    el.nowItems.textContent = t('bundle.nowItems', { items: contents.join(', ') });
    if (!market.tab.signedIn && !Number.isFinite(market.wallet)) {
      // Without an EP balance the verdict skips the affordability check; say so.
      el.nowVerdict.dataset.tone = 'idle';
      el.nowVerdict.textContent = t('bundle.nowSignIn');
      return;
    }
    const code = verdictFor(settings, shop, market.wallet);
    el.nowVerdict.dataset.tone = code === 'would' ? 'good' : code === 'off' ? 'idle' : 'bad';
    el.nowVerdict.textContent = t(`bundle.verdict${code[0].toUpperCase()}${code.slice(1)}`);
  }

  function renderProgress() {
    const uid = bundle().uid || 'bundle:main';
    const message = api.getProgress(uid)?.message;
    el.progress.hidden = !(typeof message === 'string' && message);
    if (!el.progress.hidden) el.progress.textContent = t('bundle.progress', { message });
  }

  function render() {
    renderFields();
    renderList();
    renderNow();
    renderProgress();
    renderDisabled();
  }

  // The draft was replaced (loaded, saved, imported): forget half-finished edits.
  function load() {
    for (const key of Object.keys(armed)) armed[key] = false;
    for (const key of Object.keys(errors)) errors[key] = '';
    render();
  }

  function edit(patch) {
    api.patch(patch);
    render();
  }

  el.enabled.addEventListener('change', () => edit({ enabled: el.enabled.checked }));
  for (const radio of el.modeRadios) radio.addEventListener('change', () => { if (radio.checked) edit({ mode: radio.value }); });

  el.quantity.addEventListener('input', () => {
    const number = Number(el.quantity.value);
    if (el.quantity.value !== '' && Number.isInteger(number) && number >= 1 && number <= MAX_QUANTITY) {
      errors.quantity = '';
      edit({ quantity: number });
    } else {
      errors.quantity = t('bundle.quantityInvalid');
      renderFields();
    }
  });

  function wireMoney(field, on, input, errorKey) {
    on.addEventListener('change', () => {
      if (on.checked) {
        armed[field] = true;
        const read = readEP(input.value);
        if (read.value !== undefined && (field !== 'maxPrice' || read.value >= 0)) edit({ [field]: read.value });
        else { errors[errorKey] = ''; render(); input.focus(); }
      } else {
        armed[field] = false;
        errors[errorKey] = '';
        edit({ [field]: field === 'maxPrice' ? null : 0 });
      }
    });
    input.addEventListener('input', () => {
      const read = readEP(input.value);
      if (read.value !== undefined) { errors[errorKey] = ''; edit({ [field]: read.value }); }
      else { errors[errorKey] = t('bundle.epInvalid'); renderFields(); }
    });
  }
  wireMoney('maxPrice', el.maxOn, el.max, 'maxPrice');
  wireMoney('reserve', el.reserveOn, el.reserve, 'reserve');

  el.discountOn.addEventListener('change', () => {
    if (el.discountOn.checked) {
      armed.minDiscount = true;
      const number = Number(el.discount.value);
      if (number > 0 && number <= 99) edit({ minDiscount: number });
      else { render(); el.discount.focus(); }
    } else {
      armed.minDiscount = false;
      errors.minDiscount = '';
      edit({ minDiscount: 0 });
    }
  });
  el.discount.addEventListener('input', () => {
    const number = Number(el.discount.value);
    if (el.discount.value !== '' && Number.isFinite(number) && number > 0 && number <= 99) { errors.minDiscount = ''; edit({ minDiscount: number }); }
    else { errors.minDiscount = t('bundle.discountInvalid'); renderFields(); }
  });

  el.search.addEventListener('input', () => { query = el.search.value; renderList(); });
  el.list.addEventListener('change', event => {
    const box = event.target;
    if (!(box instanceof HTMLInputElement) || !box.dataset.itemId) return;
    const chosen = new Set(bundle().contains);
    if (box.checked) chosen.add(box.dataset.itemId); else chosen.delete(box.dataset.itemId);
    edit({ contains: [...chosen] });
  });

  async function refreshMarket() {
    const reply = await send({ type: 'MARKET_STATUS' });
    market = reply.ok ? reply : null;
    renderNow();
  }
  new MutationObserver(() => { if (!el.panel.hidden) void refreshMarket(); }).observe(el.panel, { attributes: true, attributeFilter: ['hidden'] });
  setInterval(() => { if (!document.hidden && !el.panel.hidden) void refreshMarket(); }, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !el.panel.hidden) void refreshMarket(); });
  globalThis.shopHelperI18n?.onChange(() => render());

  return {
    render, load, renderDisabled, renderProgress,
    // The first problem that should stop Save, or ''.
    validate() {
      if (errors.quantity) return errors.quantity;
      for (const field of ['maxPrice', 'minDiscount', 'reserve']) {
        if (!isOn(field)) continue;
        const value = bundle()[field];
        const unset = field === 'maxPrice' ? value === null : !(value > 0);
        if (errors[field] || unset) return errors[field] || t(field === 'minDiscount' ? 'bundle.discountInvalid' : 'bundle.epInvalid');
      }
      return '';
    },
  };
}

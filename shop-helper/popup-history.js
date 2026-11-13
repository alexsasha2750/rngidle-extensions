// The History tab: what the extension bought, or tried to buy, newest first.
import { ep, make, when } from './popup-format.js';
import { entryTitle, FILTERS, resultInfo, sourceLabel, totals, visibleEntries } from './history-view.js';

const $ = id => document.getElementById(id);
const el = {
  count: $('history-count'), today: $('history-today'), todayCount: $('history-today-count'), total: $('history-total'),
  filters: $('history-filters'), empty: $('history-empty'), list: $('history-list'),
  footer: $('history-footer'), clear: $('history-clear'), confirm: $('history-confirm'),
  yes: $('history-confirm-yes'), no: $('history-confirm-no'),
};
const state = { list: [], filter: 'all' };

function render() {
  const sums = totals(state.list);
  el.count.textContent = `${state.list.length} ${state.list.length === 1 ? 'entry' : 'entries'}`;
  el.today.textContent = `${ep(sums.spentToday)} EP`;
  el.todayCount.textContent = String(sums.boughtToday);
  el.total.textContent = `${ep(sums.spent)} EP`;

  for (const chip of el.filters.querySelectorAll('[data-filter]')) {
    chip.setAttribute('aria-pressed', String(chip.dataset.filter === state.filter));
  }
  const rows = visibleEntries(state.list, state.filter);
  el.empty.hidden = rows.length > 0;
  el.empty.textContent = state.list.length ? 'Nothing from this shop yet.' : 'No purchases yet. They show up here as they happen.';
  el.footer.hidden = state.list.length === 0;

  el.list.replaceChildren();
  for (const entry of rows) {
    const result = resultInfo(entry);
    const row = make('li', `history-item is-${result.tone}`);
    const main = make('div', 'history-main');
    main.append(make('span', 'history-name', entryTitle(entry)));
    if (Number.isFinite(Number(entry.total)) && entry.total > 0) {
      main.append(make('span', 'history-price', `${ep(entry.total)} EP`));
    }
    const meta = make('div', 'history-meta');
    meta.append(make('span', `state-pill is-${result.tone}`, result.text), make('span', 'history-source', `${sourceLabel(entry)} · ${when(entry.time)}`));
    row.append(main, meta);
    if (typeof entry.message === 'string' && entry.message) row.append(make('p', 'history-note', entry.message));
    el.list.append(row);
  }
}

function setConfirm(open) {
  el.confirm.hidden = !open;
  el.clear.hidden = open;
  if (open) el.no.focus(); else el.clear.focus();
}

async function load() {
  const { history } = await chrome.storage.local.get('history');
  state.list = Array.isArray(history) ? history : [];
  render();
}

el.filters.addEventListener('click', event => {
  const chip = event.target.closest('[data-filter]');
  if (!chip || !FILTERS.includes(chip.dataset.filter)) return;
  state.filter = chip.dataset.filter;
  render();
});
el.clear.addEventListener('click', () => setConfirm(true));
el.no.addEventListener('click', () => setConfirm(false));
el.yes.addEventListener('click', async () => {
  await chrome.storage.local.remove('history').catch(() => {});
  state.list = [];
  setConfirm(false);
  render();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.history) {
    state.list = Array.isArray(changes.history.newValue) ? changes.history.newValue : [];
    render();
  }
});

void load().catch(() => render());

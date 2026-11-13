// The update checker in the menu: the version button (click to check, dot when a newer release
// is out), the panel under the header, and the Settings card. Containers in popup.html:
// #app-version, #update-panel, #update-settings-card. The background worker does the checking
// (update-service.js); this module only asks it and shows `updateState`.
import { make } from './popup-format.js';
import { onPrefs, prefs, savePrefs } from './popup-prefs.js';
import { STATE_KEY, hasAttention, isReleasePageUrl, normalizeState } from './update.js';

const i18n = globalThis.shopHelperI18n;
const t = (key, params) => (i18n ? i18n.t(key, params) : key);
const manifest = chrome.runtime.getManifest();
const ownName = manifest.version_name || `v${manifest.version}`;
const EXTENSIONS_PAGE = 'chrome://extensions';

const pill = document.getElementById('app-version');
const panel = document.getElementById('update-panel');
const card = document.getElementById('update-settings-card');

let state = normalizeState(null, manifest.version);
let open = false;
let checking = false;
let checkFailure = null; // the check request itself got no answer
let busy = null; // the panel action being sent
let actionError = null; // why the last panel action was refused

// ---------- talking to the background ----------

async function send(message) {
  try {
    const reply = await chrome.runtime.sendMessage(message);
    return reply && typeof reply === 'object' ? reply : { ok: false, error: 'no_answer' };
  } catch {
    return { ok: false, error: 'no_answer' };
  }
}

function take(reply) {
  if (reply?.state && typeof reply.state === 'object') state = normalizeState(reply.state, manifest.version);
}

async function runCheck({ reveal = false } = {}) {
  if (checking) {
    render();
    return;
  }
  checking = true;
  checkFailure = null;
  actionError = null;
  render();
  const reply = await send({ type: 'UPDATE_CHECK', force: true });
  checking = false;
  take(reply);
  if (!reply.state) checkFailure = reply.error === 'no_answer' ? 'no_answer' : 'unknown';
  if (reveal && state.status === 'available') open = true;
  render();
}

async function act(type) {
  busy = type;
  actionError = null;
  render();
  const reply = await send({ type });
  busy = null;
  take(reply);
  if (!reply.ok) actionError = reply.error || 'unknown';
  render();
  return reply;
}

async function openTab(url) {
  try {
    await chrome.tabs.create({ url });
  } catch {
    actionError = 'open_failed';
    render();
  }
}

// ---------- formatting ----------

const formatNumber = (value, options) => (i18n?.formatNumber ? i18n.formatNumber(value, options) : String(value));
const formatDate = (value, options) => (i18n?.formatDate ? i18n.formatDate(value, options) : new Date(value).toLocaleString());

function formatSize(bytes) {
  const big = bytes >= 1024 * 1024;
  return formatNumber(big ? bytes / (1024 * 1024) : Math.max(1, bytes / 1024), {
    style: 'unit', unit: big ? 'megabyte' : 'kilobyte', unitDisplay: 'short', maximumFractionDigits: big ? 1 : 0,
  });
}

function formatWhen(ms) {
  const sameDay = new Date(ms).toDateString() === new Date().toDateString();
  return formatDate(ms, sameDay ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function errorText(code) {
  switch (code) {
    case 'offline': return t('update.error_offline');
    case 'rate_limited': return t('update.error_rate_limited');
    case 'no_release': return t('update.error_no_release');
    case 'no_answer': return t('update.error_no_answer');
    case 'bad_reply': return t('update.error_bad_reply');
    default: return t('update.action_unknown');
  }
}

function actionText(code) {
  switch (code) {
    case 'no_update': return t('update.action_no_update');
    case 'bad_url': return t('update.action_bad_url');
    case 'download_failed': return t('update.action_download_failed');
    case 'no_download': return t('update.action_no_download');
    case 'open_failed': return t('update.action_open_failed');
    case 'no_answer': return t('update.error_no_answer');
    default: return t('update.action_unknown');
  }
}

// ---------- building blocks ----------

function button(label, className, focusKey, onClick) {
  const node = make('button', className, label);
  node.type = 'button';
  node.dataset.updateFocus = focusKey;
  node.disabled = busy !== null;
  node.addEventListener('click', onClick);
  return node;
}

function paragraph(text, className) {
  return make('p', className, text);
}

// Rebuilding a container must not drop keyboard focus: it moves to the control with the same
// role in the new content, or to the container's heading.
function rebuild(container, children) {
  const active = document.activeElement;
  const inside = active && container.contains(active);
  const key = inside ? active.dataset.updateFocus : null;
  container.replaceChildren(...children);
  if (!inside) return;
  const again = key && container.querySelector(`[data-update-focus="${key}"]`);
  const target = again && !again.disabled ? again : container.querySelector('[data-update-focus="heading"]');
  target?.focus({ preventScroll: true });
}

// ---------- the version button and its panel ----------

function renderPill() {
  const attention = hasAttention(state);
  const latest = state.latest?.versionName ?? '';
  pill.classList.toggle('has-update', attention);
  pill.setAttribute('aria-expanded', String(open));
  pill.setAttribute('aria-controls', 'update-panel');
  pill.title = attention ? t('update.pill_title_available', { latest }) : t('update.pill_title', { version: manifest.version });
  pill.setAttribute('aria-label', attention ? t('update.pill_label_available', { name: ownName, latest }) : t('update.pill_label', { name: ownName }));
}

function closePanel() {
  open = false;
  render();
  pill.focus({ preventScroll: true });
}

function head(title, tone, extra = []) {
  const row = make('div', 'update-head');
  const icon = make('span', 'update-icon');
  icon.dataset.tone = tone;
  icon.setAttribute('aria-hidden', 'true');
  const heading = make('h2', 'update-title', title);
  heading.id = 'update-panel-title';
  heading.tabIndex = -1;
  heading.dataset.updateFocus = 'heading';
  const close = make('button', 'icon-button update-close');
  close.type = 'button';
  close.dataset.updateFocus = 'close';
  close.setAttribute('aria-label', t('update.panel_close'));
  close.title = t('update.panel_close');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M6 6l12 12M18 6 6 18');
  svg.append(path);
  close.append(svg);
  close.addEventListener('click', closePanel);
  const words = make('div', 'update-heading');
  words.append(heading, ...extra);
  row.append(icon, words, close);
  return row;
}

function body(...children) {
  const node = make('div', 'update-body');
  node.append(...children.filter(Boolean));
  return node;
}

function actions(...buttons) {
  const row = make('div', 'update-actions');
  row.append(...buttons.filter(Boolean));
  return row;
}

function actionNotice() {
  if (!actionError) return null;
  const node = paragraph(actionText(actionError), 'update-error');
  node.setAttribute('role', 'alert');
  return node;
}

const releaseButton = (className = 'btn btn-ghost btn-small') => (isReleasePageUrl(state.latest?.url)
  ? button(t('update.release_page'), className, 'release', () => void openTab(state.latest.url))
  : null);

function checkingView() {
  return [head(t('update.checking_title'), 'busy'), body(paragraph(t('update.checking_body')))];
}

function upToDateView() {
  return [
    head(t('update.uptodate_title'), 'good'),
    body(
      paragraph(t('update.uptodate_body', { name: ownName }), 'update-lead'),
      state.lastOk ? paragraph(t('update.checked_at', { time: formatWhen(state.lastOk) }), 'update-meta') : null,
      actions(button(t('update.check_again'), 'btn btn-ghost btn-small', 'check', () => void runCheck())),
    ),
  ];
}

function errorView(code) {
  const hint = code === 'no_release' && prefs().updates.prereleases === false ? paragraph(t('update.error_no_release_hint'), 'update-meta') : null;
  return [
    head(t('update.error_title'), 'bad'),
    body(
      paragraph(errorText(code), 'update-lead'),
      hint,
      state.checkedAt && !checkFailure ? paragraph(t('update.tried_at', { time: formatWhen(state.checkedAt) }), 'update-meta') : null,
      actions(button(t('update.try_again'), 'btn btn-primary btn-small', 'check', () => void runCheck())),
    ),
  ];
}

function availableView() {
  const { latest } = state;
  const chip = latest.prerelease ? make('span', 'chip update-pre', t('update.prerelease')) : null;
  const facts = make('ul', 'update-facts');
  if (latest.asset?.size) facts.append(make('li', null, t('update.size', { size: formatSize(latest.asset.size) })));
  if (latest.publishedAt) facts.append(make('li', null, t('update.published', { date: formatDate(Date.parse(latest.publishedAt), { dateStyle: 'medium' }) })));
  const notes = latest.notes ? [make('h3', 'update-notes-title', t('update.notes_heading')), paragraph(latest.notes, 'update-notes')] : [];
  return [
    head(t('update.available_title'), 'new', [chip].filter(Boolean)),
    body(
      paragraph(t('update.available_body', { latest: latest.versionName, current: ownName }), 'update-lead'),
      facts.childElementCount ? facts : null,
      ...notes,
      latest.asset ? null : paragraph(t('update.no_asset'), 'update-meta'),
      actionNotice(),
      actions(
        latest.asset ? button(t('update.download'), 'btn btn-primary btn-small', 'download', () => void act('UPDATE_DOWNLOAD')) : null,
        releaseButton(),
        state.dismissedVersion === latest.version ? null : button(t('update.not_now'), 'btn btn-ghost btn-small', 'dismiss', async () => {
          const reply = await act('UPDATE_DISMISS');
          if (reply.ok) closePanel();
        }),
      ),
    ),
  ];
}

function steps() {
  const list = make('ol', 'update-steps');
  list.append(make('li', null, t('update.step_extract')), make('li', null, t('update.step_replace')), make('li', null, t('update.step_reload')));
  return [paragraph(t('update.steps_intro')), list];
}

function downloadView() {
  const { latest, downloaded } = state;
  if (downloaded.state === 'interrupted') {
    return [
      head(t('update.interrupted_title'), 'bad'),
      body(
        paragraph(t('update.interrupted_body'), 'update-lead'),
        actionNotice(),
        actions(button(t('update.try_again'), 'btn btn-primary btn-small', 'download', () => void act('UPDATE_DOWNLOAD')), releaseButton()),
      ),
    ];
  }
  const done = downloaded.state === 'complete';
  return [
    head(done ? t('update.downloaded_title', { latest: latest.versionName }) : t('update.downloading_title', { latest: latest.versionName }), done ? 'good' : 'busy'),
    body(
      ...steps(),
      actionNotice(),
      actions(
        done ? button(t('update.show_file'), 'btn btn-primary btn-small', 'show', () => void act('UPDATE_SHOW')) : null,
        button(t('update.open_extensions'), 'btn btn-ghost btn-small', 'extensions', () => void openTab(EXTENSIONS_PAGE)),
        done ? null : releaseButton(),
      ),
    ),
  ];
}

function panelView() {
  if (checking) return checkingView();
  if (checkFailure) return errorView(checkFailure);
  if (state.status === 'available' && state.downloaded) return downloadView();
  if (state.status === 'available') return availableView();
  if (state.status === 'uptodate') return upToDateView();
  return errorView(state.error?.code ?? 'no_answer');
}

function renderPanel() {
  panel.hidden = !open;
  panel.setAttribute('aria-labelledby', 'update-panel-title');
  if (!open) {
    panel.replaceChildren();
    return;
  }
  rebuild(panel, panelView());
}

// ---------- the Settings card ----------

function toggleRow(id, label, hint, checked, onChange) {
  const row = make('label', 'filter-option');
  row.htmlFor = id;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = checked;
  input.dataset.updateFocus = id;
  input.addEventListener('change', () => onChange(input.checked));
  const text = make('span');
  text.append(make('strong', null, label), make('small', null, hint));
  row.append(input, text);
  return row;
}

function statusLine() {
  const line = make('p', 'update-status-line');
  const dot = make('span', 'status-dot');
  dot.setAttribute('aria-hidden', 'true');
  const words = make('span', 'update-status-text');
  const time = state.checkedAt ? formatWhen(state.checkedAt) : '';
  if (checking) {
    dot.classList.add('update-busy');
    words.textContent = t('update.status_checking');
  } else if (state.status === 'uptodate') {
    dot.classList.add('good');
    words.textContent = t('update.status_uptodate', { time });
  } else if (state.status === 'available') {
    dot.classList.add('update-new');
    words.textContent = t('update.status_available', { latest: state.latest.versionName, time });
  } else if (state.status === 'error') {
    dot.classList.add('bad');
    words.append(make('span', null, errorText(state.error?.code)));
    if (time) words.append(' ', make('span', null, t('update.tried_at', { time })));
  } else {
    words.textContent = t('update.status_never');
  }
  line.append(dot, words);
  return line;
}

function renderCard() {
  const p = prefs();
  const heading = make('h2', null, t('update.settings_heading'));
  heading.id = 'update-settings-heading';
  const row = make('div', 'inline-actions');
  const checkNow = make('button', 'btn btn-ghost btn-small', t('update.check_now'));
  checkNow.type = 'button';
  checkNow.dataset.updateFocus = 'check-now';
  checkNow.disabled = checking;
  checkNow.addEventListener('click', () => void runCheck({ reveal: true }));
  row.append(checkNow);
  if (state.status === 'available' && !open) {
    const show = make('button', 'btn btn-ghost btn-small', t('update.show_update'));
    show.type = 'button';
    show.dataset.updateFocus = 'show-update';
    show.addEventListener('click', () => {
      open = true;
      render();
      panel.querySelector('[data-update-focus="heading"]')?.focus({ preventScroll: true });
    });
    row.append(show);
  }
  const status = statusLine();
  status.setAttribute('role', 'status');
  rebuild(card, [
    heading,
    paragraph(t('update.settings_intro')),
    toggleRow('update-auto', t('update.auto_label'), t('update.auto_hint'), p.updates.auto, checked => void savePrefs({ updates: { auto: checked } })),
    toggleRow('update-prereleases', t('update.prereleases_label'), t('update.prereleases_hint'), p.updates.prereleases, async checked => {
      await savePrefs({ updates: { prereleases: checked } });
      // The stored answer was found under the old setting; look again if there was one.
      if (state.latest) void runCheck();
    }),
    row,
    status,
    paragraph(t('update.privacy'), 'fine-print'),
  ]);
}

function render() {
  renderPill();
  renderPanel();
  renderCard();
}

// ---------- start ----------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STATE_KEY]) return;
  state = normalizeState(changes[STATE_KEY].newValue, manifest.version);
  render();
});

try { await i18n?.ready; } catch { /* English */ }
pill.addEventListener('click', () => {
  open = !open;
  if (open) void runCheck();
  else render();
});
i18n?.onChange?.(() => render());
const first = await send({ type: 'UPDATE_STATUS' });
if (first.state) take(first);
else {
  try { state = normalizeState((await chrome.storage.local.get(STATE_KEY))[STATE_KEY], manifest.version); } catch { /* keep the default */ }
}
onPrefs(() => renderCard());
render();

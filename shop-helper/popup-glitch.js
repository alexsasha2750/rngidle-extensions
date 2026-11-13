// The Glitch tab: his live shelf, alerts, and the trial you answer yourself.
// A trial is a timed question the game checks on its server. This menu shows each question
// to the player and sends back what they pick or type; it never answers for them.
import { normalizePrefs, offerState, planCost, REASONS, withinLimit } from './glitch-logic.js';
import { cue } from './popup-prefs.js';

const storage = chrome.storage.local;
const $ = id => document.getElementById(id);
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 });
const POLL_MS = 10000;
const BETWEEN_MS = 1400;

const el = {
  panel: $('panel-glitch'),
  state: $('glitch-state'), sub: $('glitch-sub'), clock: $('glitch-clock'),
  tabDot: $('glitch-tab-dot'), tabStatus: $('glitch-tab-status'), walletDot: $('glitch-wallet-dot'), wallet: $('glitch-wallet'),
  alert: $('glitch-alert'), alertCopy: $('glitch-alert-copy'), alertCard: $('glitch-alert-card'), note: $('glitch-note'),
  shop: $('glitch-shop'), count: $('glitch-selected-count'), message: $('glitch-message'), list: $('glitch-list'),
  start: $('glitch-start'), hint: $('glitch-start-hint'),
  plan: $('glitch-plan'), planTotal: $('glitch-plan-total'), planWallet: $('glitch-plan-wallet'), planVerdict: $('glitch-plan-verdict'),
  trial: $('glitch-trial'), trialWare: $('glitch-trial-ware'), steps: $('glitch-trial-steps'),
  body: $('glitch-trial-body'), actions: $('glitch-trial-actions'), results: $('glitch-trial-results'),
};

const state = {
  catalog: [],
  shop: null,
  tab: { open: null, signedIn: null },
  error: '',
  skew: 0,
  prefs: normalizePrefs(null),
  prefsReady: false,
  run: null,
  openOptions: new Set(),
};
let ui = {};

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function ep(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number >= 1e15 ? number.toExponential(2) : compact.format(number);
}
function clockText(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
async function send(message) {
  try {
    const reply = await chrome.runtime.sendMessage(message);
    return reply && typeof reply === 'object' ? reply : { ok: false, error: 'The extension did not answer. Try again.' };
  } catch {
    return { ok: false, error: 'Could not reach the extension. Reload it and try again.' };
  }
}

// ---------- data ----------

const readable = id => id.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

// Wares he can sell right now come first, then the rest in catalogue order.
function wares() {
  const byId = new Map(state.shop?.items.map(item => [item.id, item]) ?? []);
  const rows = state.catalog.map(entry => ({ ...entry, offer: byId.get(entry.id) ?? null }));
  for (const item of state.shop?.items ?? []) {
    if (!state.catalog.some(entry => entry.id === item.id)) rows.push({ id: item.id, name: readable(item.id), emoji: '✦', offer: item });
  }
  const rank = row => (buyable(row) ? 0 : row.offer ? 1 : 2);
  return rows.map((row, index) => ({ row, index })).sort((a, b) => rank(a.row) - rank(b.row) || a.index - b.index).map(entry => entry.row);
}
const nameOf = id => wares().find(row => row.id === id) ?? { id, name: readable(id), emoji: '✦' };
const buyable = row => !!row.offer && offerState(row.offer, state.shop).buyable;
const wanted = () => new Set(state.prefs.itemIds);
const queue = () => wares().filter(row => wanted().has(row.id) && buyable(row) && withinLimit(state.prefs, row.offer)).map(row => row.id);
const aboveLimit = row => buyable(row) && !withinLimit(state.prefs, row.offer);
const priceOf = id => state.shop?.items.find(item => item.id === id)?.price ?? null;

function startBlocker() {
  if (state.run) return 'A trial is already running.';
  if (state.tab.open === false) return 'Open an RNGidle tab first.';
  if (state.tab.open && state.tab.signedIn === false) return 'Sign in to RNGidle in the open tab.';
  if (!state.shop) return 'Waiting for Glitch’s shelf…';
  if (!state.shop.open) return 'Glitch is away.';
  if (!state.prefs.itemIds.length) return 'Tick at least one ware.';
  if (!queue().length) {
    return wares().some(row => wanted().has(row.id) && aboveLimit(row))
      ? 'The ticked wares cost more than the limits you set.'
      : 'None of the ticked wares can be bought right now.';
  }
  return '';
}

// ---------- rendering ----------

function renderStatus() {
  const { tab, shop } = state;
  const open = shop?.open === true;
  el.tabDot.className = `status-dot ${tab.open && tab.signedIn ? 'good' : tab.open === false || tab.signedIn === false ? 'bad' : 'unknown'}`;
  el.tabStatus.textContent = tab.open === null ? 'Game tab: checking…'
    : !tab.open ? 'Game tab: not open' : tab.signedIn ? 'Game tab: open · signed in' : 'Game tab: open · signed out';
  const wallet = shop?.wallet?.effective;
  el.walletDot.className = `status-dot ${wallet != null ? 'good' : 'unknown'}`;
  el.wallet.textContent = wallet != null ? `EP: ${ep(wallet)}` : 'EP: unknown';

  el.state.dataset.tone = !shop ? 'idle' : open ? 'here' : 'away';
  el.state.textContent = !shop ? (state.error ? 'Offline' : 'Checking…') : open ? 'Here now' : 'Away';
  el.sub.textContent = state.error ? state.error
    : tab.open === false ? 'Open an RNGidle tab to see his shelf.'
    : !shop ? 'Looking for Glitch…'
    : open ? `He is here with ${shop.items.length} ${shop.items.length === 1 ? 'ware' : 'wares'}.`
    : 'He visits when a player summons him. Tick what you want and turn on alerts.';
  renderClock();
}

function renderClock() {
  const end = state.shop?.open ? state.shop.endsAt : null;
  const left = end == null ? 0 : end - (Date.now() + state.skew);
  el.clock.hidden = !(left > 0);
  if (left > 0) {
    el.clock.textContent = clockText(left);
    el.clock.dataset.hurry = String(left <= 60000);
  }
}

function pill(row) {
  if (!state.shop) return null;
  if (!row.offer) return ['off', 'Not on his shelf'];
  const status = offerState(row.offer, state.shop);
  if (status.buyable) return aboveLimit(row) ? ['off', 'Above your limit'] : ['ok', 'Available'];
  return [status.reason === 'bought' ? 'done' : 'off', status.reason === 'away' ? 'Away' : status.reason === 'sold' ? 'Sold out' : status.reason === 'poor' ? 'Not enough EP' : status.reason === 'bought' ? 'Bought' : 'Unavailable'];
}

function optionsFor(row) {
  const details = make('details', 'ware-options');
  details.dataset.id = row.id;
  details.open = state.openOptions.has(row.id);
  const limit = state.prefs.limits[row.id], note = state.prefs.notes[row.id];
  const summary = make('summary');
  summary.append(make('span', '', 'Limit & note'));
  if (limit || note) summary.append(make('span', 'ware-options-set', [limit ? `≤ ${ep(limit)}` : '', note ? 'note' : ''].filter(Boolean).join(' · ')));
  details.append(summary);

  const body = make('div', 'ware-options-body');
  const limitLabel = make('label', 'field-label');
  limitLabel.append(make('span', '', 'Only buy at or under (EP)'));
  const limitInput = make('input');
  Object.assign(limitInput, { type: 'number', min: '0', step: 'any', placeholder: 'No limit', value: limit ? String(limit) : '' });
  limitInput.inputMode = 'decimal';
  limitInput.dataset.limit = row.id;
  limitInput.setAttribute('aria-label', `Highest price for ${row.name}`);
  limitLabel.append(limitInput);
  const noteLabel = make('label', 'field-label');
  noteLabel.append(make('span', '', 'Note to self'));
  const noteInput = make('input');
  Object.assign(noteInput, { type: 'text', maxLength: 80, placeholder: 'e.g. only if under 5B', value: note || '' });
  noteInput.dataset.note = row.id;
  noteInput.setAttribute('aria-label', `Note for ${row.name}`);
  noteLabel.append(noteInput);
  body.append(limitLabel, noteLabel);
  details.append(body);
  return details;
}

// Typing in a limit or note field must not be wiped by a refresh of the shelf.
const typing = () => document.activeElement?.matches?.('#glitch-list input[data-limit], #glitch-list input[data-note]');

function renderWares() {
  if (typing()) return;
  const rows = wares();
  el.list.replaceChildren();
  el.message.hidden = rows.length > 0;
  if (!rows.length) el.message.textContent = 'No wares to show yet.';
  const want = wanted();
  for (const row of rows) {
    const card = make('article', 'item-card glitch-ware');
    const head = make('div', 'item-heading');
    const label = make('label', 'item-select');
    const box = make('input');
    box.type = 'checkbox';
    box.checked = want.has(row.id);
    box.dataset.id = row.id;
    box.disabled = !state.prefsReady || !!state.run;
    box.setAttribute('aria-label', `Want ${row.name}`);
    label.append(box, make('span', 'ware-emoji', row.emoji || '✦'), make('span', 'item-name', row.name));
    head.append(label);
    if (row.offer && Number.isFinite(row.offer.price)) head.append(make('span', 'item-price', `${ep(row.offer.price)} EP`));
    card.append(head);
    const state_ = pill(row);
    if (state_) {
      const line = make('div', 'ware-state');
      const tag = make('span', `state-pill is-${state_[0]}`, state_[1]);
      line.append(tag);
      card.append(line);
    }
    const note = state.prefs.notes[row.id];
    if (note) card.append(make('p', 'ware-note', note));
    if (state.prefsReady) card.append(optionsFor(row));
    el.list.append(card);
  }
  el.count.textContent = `${state.prefs.itemIds.length} ticked`;
  renderStart();
}

function renderPlan() {
  const ticked = wares().filter(row => wanted().has(row.id) && row.offer);
  const plan = planCost(ticked.map(row => row.offer), state.shop?.wallet?.effective ?? null);
  el.plan.hidden = !state.shop?.open || plan.count === 0;
  if (el.plan.hidden) return;
  el.plan.dataset.tone = plan.covered ? 'good' : plan.wallet == null ? 'idle' : 'short';
  el.planTotal.textContent = `${ep(plan.total)} EP`;
  el.planWallet.textContent = plan.wallet == null ? '—' : `${ep(plan.wallet)} EP`;
  el.planVerdict.textContent = plan.wallet == null ? 'Sign in to compare with your EP.'
    : plan.covered ? `You can afford all ${plan.count} ${plan.count === 1 ? 'ware' : 'wares'}.`
    : `Short by ${ep(plan.short)} EP for all ${plan.count} wares together.`;
}

function renderStart() {
  renderPlan();
  const blocker = startBlocker();
  const n = queue().length;
  el.start.disabled = !!blocker;
  el.start.textContent = n > 1 ? `Take ${n} trials` : 'Take the trial';
  el.hint.textContent = blocker || `${n} ${n === 1 ? 'ware' : 'wares'} in your queue · one trial each. Passing a trial buys the ware.`;
}

function renderAlertSwitch() {
  el.alert.disabled = !state.prefsReady;
  el.alert.checked = state.prefs.alert;
  el.alertCopy.textContent = state.prefs.alert
    ? 'On · a badge appears on the toolbar icon and in-game button'
    : 'Off · applies instantly';
}

function renderTrial() {
  const run = state.run;
  const starting = !!run && el.trial.hidden;
  el.trial.hidden = !run;
  el.shop.hidden = !!run;
  // Keep the question and its answers on screen while the clock runs.
  el.alertCard.hidden = !!run;
  el.note.hidden = !!run;
  if (!run) { ui = {}; return; }
  if (starting) el.trial.scrollIntoView({ block: 'start' });

  const current = nameOf(run.queue[Math.min(run.index, run.queue.length - 1)]);
  el.trialWare.textContent = `${current.emoji || ''} ${current.name}${run.queue.length > 1 ? ` · ${Math.min(run.index + 1, run.queue.length)} of ${run.queue.length}` : ''}`.trim();

  el.steps.replaceChildren();
  const question = run.question;
  if (question) {
    for (let i = 0; i < question.steps; i++) {
      const dot = make('li', i < question.step ? 'is-done' : i === question.step && run.phase !== 'failed' ? 'is-now' : '');
      dot.setAttribute('aria-label', `Question ${i + 1} of ${question.steps}`);
      el.steps.append(dot);
    }
  }
  el.steps.hidden = !question;

  el.body.replaceChildren();
  el.actions.replaceChildren();
  ui = {};
  const phase = run.phase;
  const live = phase === 'ask' || phase === 'checking';

  if (phase === 'loading') {
    el.body.append(make('p', 'trial-wait', 'Glitch is thinking up something unfair…'));
  } else if (live && question) {
    el.body.append(make('p', 'trial-prompt', question.prompt));
    const clock = make('i', 'trial-clock');
    ui.clock = clock;
    el.body.append(clock);
    if (question.choices) {
      const grid = make('div', 'trial-choices');
      for (const choice of question.choices) {
        const button = make('button', 'btn trial-choice', String(choice));
        button.type = 'button';
        button.disabled = phase !== 'ask';
        button.addEventListener('click', () => submit(choice));
        grid.append(button);
      }
      el.body.append(grid);
    } else {
      const form = make('form', 'trial-answer');
      const field = make('input');
      field.type = 'text';
      field.maxLength = 200;
      field.autocomplete = 'off';
      field.spellcheck = false;
      field.placeholder = 'Your answer';
      field.disabled = phase !== 'ask';
      field.setAttribute('aria-label', 'Your answer');
      const send_ = make('button', 'btn btn-primary', 'Submit');
      send_.type = 'submit';
      send_.disabled = true;
      field.addEventListener('input', () => { send_.disabled = phase !== 'ask' || !field.value.trim(); });
      form.addEventListener('submit', event => { event.preventDefault(); if (field.value.trim()) submit(field.value); });
      form.append(field, send_);
      el.body.append(form);
      if (phase === 'ask') queueMicrotask(() => field.focus({ preventScroll: true }));
    }
    if (phase === 'checking') el.body.append(make('p', 'trial-wait', 'Checking your answer…'));
  } else if (phase === 'failed' || phase === 'declined' || phase === 'uncertain') {
    el.body.append(make('p', 'trial-result is-bad', run.message));
  } else if (phase === 'between' || phase === 'done') {
    el.body.append(make('p', `trial-result ${run.results.at(-1)?.ok ? 'is-good' : 'is-bad'}`, run.message));
  }

  if (phase === 'failed') {
    const retryable = !['bought', 'sold', 'poor', 'away', 'invalid'].includes(run.reason);
    if (retryable) {
      const again = make('button', 'btn btn-primary', 'Try again');
      again.type = 'button';
      again.addEventListener('click', () => { if (Date.now() >= run.restUntil) beginTrial(); });
      ui.again = again;
      el.actions.append(again);
    }
    if (run.index + 1 < run.queue.length) {
      const skip = make('button', 'btn', 'Skip this ware');
      skip.type = 'button';
      skip.addEventListener('click', () => advance(run));
      el.actions.append(skip);
    }
    el.actions.append(stopButton('Stop'));
  } else if (live || phase === 'loading') {
    el.actions.append(stopButton('Stop trial'));
  } else if (phase === 'done' || phase === 'declined' || phase === 'uncertain') {
    el.actions.append(stopButton('Back to wares', true));
  }

  el.results.replaceChildren();
  for (const result of run.results) {
    const row = make('li', result.ok ? 'is-good' : 'is-bad');
    row.append(make('span', 'result-mark', result.ok ? '✓' : '✕'), make('span', '', `${nameOf(result.id).name} — ${result.text}`));
    el.results.append(row);
  }
  tick();
}

function stopButton(label, primary = false) {
  const button = make('button', `btn${primary ? ' btn-primary' : ' btn-ghost'}`, label);
  button.type = 'button';
  button.addEventListener('click', stopRun);
  return button;
}

function renderAll() {
  renderStatus();
  renderAlertSwitch();
  renderWares();
  renderTrial();
}

// Cheap per-frame updates: the question clock, the rest countdown, Glitch's own clock.
function tick() {
  const run = state.run;
  if (run?.phase === 'ask' && run.question) {
    const left = Math.max(0, run.deadline - Date.now());
    ui.clock?.style.setProperty('--p', (left / run.question.ms).toFixed(3));
    if (ui.clock) ui.clock.dataset.low = String(left <= 3000);
    // One tick per second over the last three seconds.
    const second = Math.ceil(left / 1000);
    if (left > 0 && second <= 3 && second !== run.lastTick) { run.lastTick = second; cue('tick'); }
    if (left <= 0) void submit('');
  }
  if (run?.phase === 'failed' && ui.again) {
    const rest = Math.max(0, run.restUntil - Date.now());
    ui.again.disabled = rest > 0;
    ui.again.textContent = rest > 0 ? `Try again in ${Math.ceil(rest / 1000)} s` : 'Try again';
  }
  renderClock();
}

// ---------- trial flow ----------

async function startRun() {
  const ids = queue();
  if (startBlocker() || !ids.length) return;
  state.run = { queue: ids, index: 0, phase: 'loading', results: [], question: null, deadline: 0, restUntil: 0, message: '', reason: '', lastTick: -1 };
  cue('start');
  renderAll();
  await beginTrial();
}

function stopRun() {
  state.run = null;
  renderAll();
  void refresh();
}

function failTrial(run, message, rest, reason = '') {
  run.phase = 'failed';
  run.message = message;
  run.reason = reason;
  run.restUntil = Date.now() + (rest || 0);
  renderTrial();
}

async function beginTrial() {
  const run = state.run;
  if (!run) return;
  run.phase = 'loading';
  run.question = null;
  run.message = '';
  renderTrial();
  const reply = await send({ type: 'GLITCH_TRIAL_START', item: run.queue[run.index] });
  if (state.run !== run) return;
  if (!reply.ok) return failTrial(run, reply.error || 'Could not start the trial.', reply.rest, reply.reason);
  askQuestion(run, reply.question);
}

function askQuestion(run, question) {
  run.question = question;
  run.phase = 'ask';
  run.deadline = Date.now() + question.ms;
  run.lastTick = -1;
  renderTrial();
}

async function submit(value) {
  const run = state.run;
  if (!run || run.phase !== 'ask' || !run.question) return;
  run.phase = 'checking';
  renderTrial();
  const item = run.queue[run.index];
  const reply = await send({ type: 'GLITCH_TRIAL_ANSWER', item, id: run.question.id, answer: value, price: priceOf(item) });
  if (state.run !== run) return;
  if (!reply.ok) return failTrial(run, reply.error || 'The answer could not be sent.', 0);
  if (reply.kind === 'question') { cue('correct'); return askQuestion(run, reply.question); }
  if (reply.kind === 'failed') {
    cue('wrong');
    return failTrial(run, `${reply.late ? 'Too slow.' : 'Wrong.'}${reply.answer ? ` It was ${reply.answer}.` : ''}`, reply.rest);
  }
  const id = run.queue[run.index];
  const name = nameOf(id).name;
  if (reply.kind === 'bought') { cue('success'); return finishWare(run, { id, ok: true, text: 'bought' }, `Bought ${name}.`); }
  cue('fail');
  if (reply.kind === 'declined') return finishWare(run, { id, ok: false, text: `declined (${reply.error})` }, `${name}: Glitch declined the purchase. ${reply.error || ''}`.trim());
  // Unknown outcome: stop here so nothing is bought twice by accident.
  run.results.push({ id, ok: false, text: 'result unknown' });
  run.phase = 'uncertain';
  run.message = reply.error || 'The result is unknown. Check your inventory.';
  renderTrial();
  void refresh();
}

function finishWare(run, result, message) {
  run.results.push(result);
  run.message = message;
  void refresh();
  if (run.index + 1 < run.queue.length) {
    run.phase = 'between';
    renderTrial();
    setTimeout(() => { if (state.run === run && run.phase === 'between') advance(run); }, BETWEEN_MS);
  } else {
    run.phase = result.ok ? 'done' : 'declined';
    renderTrial();
  }
}

function advance(run) {
  if (state.run !== run) return;
  if (run.index + 1 >= run.queue.length) { run.phase = 'done'; run.message = run.message || 'No more wares in the queue.'; renderTrial(); return; }
  run.index += 1;
  void beginTrial();
}

// ---------- status, prefs, wiring ----------

async function refresh() {
  const reply = await send({ type: 'GLITCH_STATUS' });
  if (reply.ok) {
    state.error = '';
    state.tab = reply.tab ?? state.tab;
    state.shop = reply.shop ?? null;
    state.skew = state.shop?.now != null ? state.shop.now - Date.now() : 0;
  } else {
    state.error = reply.error || 'Could not reach Glitch.';
    state.tab = reply.tab ?? state.tab;
  }
  if (!state.run) renderAll(); else renderStatus();
}

function savePrefs() {
  state.prefs = normalizePrefs(state.prefs);
  storage.set({ glitchPrefs: state.prefs }).catch(() => {});
  void send({ type: 'GLITCH_PREFS_CHANGED' });
  renderAll();
}

async function init() {
  el.alert.addEventListener('change', () => { state.prefs.alert = el.alert.checked; savePrefs(); });
  el.list.addEventListener('change', event => {
    const box = event.target;
    if (!(box instanceof HTMLInputElement)) return;
    if (box.dataset.limit || box.dataset.note) {
      const id = box.dataset.limit || box.dataset.note;
      const next = { ...state.prefs, limits: { ...state.prefs.limits }, notes: { ...state.prefs.notes } };
      if (box.dataset.limit) { if (box.value.trim() === '') delete next.limits[id]; else next.limits[id] = box.value; }
      else if (box.value.trim() === '') delete next.notes[id]; else next.notes[id] = box.value;
      state.prefs = next;
      box.blur();
      savePrefs();
      return;
    }
    if (!box.dataset.id) return;
    const ids = new Set(state.prefs.itemIds);
    if (box.checked) ids.add(box.dataset.id); else ids.delete(box.dataset.id);
    state.prefs.itemIds = [...ids];
    savePrefs();
  });
  el.list.addEventListener('toggle', event => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.dataset.id) return;
    if (details.open) state.openOptions.add(details.dataset.id); else state.openOptions.delete(details.dataset.id);
  }, true);
  el.start.addEventListener('click', () => { void startRun(); });

  const [saved, names] = await Promise.allSettled([
    storage.get('glitchPrefs'),
    fetch(chrome.runtime.getURL('glitch-catalog.json')).then(response => response.json()),
  ]);
  if (saved.status === 'fulfilled') state.prefs = normalizePrefs(saved.value.glitchPrefs);
  state.prefsReady = true;
  if (names.status === 'fulfilled' && Array.isArray(names.value)) {
    state.catalog = names.value.filter(item => item && typeof item.id === 'string').map(item => ({ id: item.id, name: String(item.name || item.id), emoji: String(item.emoji || '✦') }));
  }
  renderAll();

  // The toolbar popup and the in-game menu share these preferences.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.glitchPrefs) return;
    const next = normalizePrefs(changes.glitchPrefs.newValue);
    if (JSON.stringify(next) !== JSON.stringify(state.prefs)) { state.prefs = next; renderAll(); }
  });

  void refresh();
  setInterval(tick, 100);
  setInterval(() => { if (!document.hidden && !el.panel.hidden && !state.run) void refresh(); }, POLL_MS);
  new MutationObserver(() => { if (!el.panel.hidden && !state.run) void refresh(); }).observe(el.panel, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !state.run) void refresh(); });
}

void init();

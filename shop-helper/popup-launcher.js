// The Settings card for the floating in-game button: how it shows, its size, hiding it, putting it
// back in its corner, and the keyboard shortcut that opens the menu without it.
// Container in popup.html: #launcher-card.
import { onPrefs, prefs, savePrefs } from './popup-prefs.js';

const i18n = globalThis.shopHelperI18n ?? null;
const t = (key, params) => (i18n ? i18n.t(key, params) : key);
const storage = chrome.storage.local;
const COMMAND = 'toggle-menu';
const SHORTCUTS_PAGE = 'chrome://extensions/shortcuts';
// Texts are functions so they follow a language change.
const MODES = [['normal', () => t('launcher.modeNormal')], ['faded', () => t('launcher.modeFaded')], ['edge', () => t('launcher.modeEdge')]];
const SIZES = [['normal', () => t('launcher.sizeNormal')], ['small', () => t('launcher.sizeSmall')]];
const MODE_HINTS = {
  normal: () => t('launcher.modeNormalHint'), faded: () => t('launcher.modeFadedHint'), edge: () => t('launcher.modeEdgeHint'),
};
const MESSAGES = { resetDone: () => t('launcher.resetDone'), unavailable: () => t('launcher.shortcutUnavailable') };

function make(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === 'class') node.className = value;
    else node.setAttribute(name, value);
  }
  node.append(...children);
  return node;
}

function radioGroup(id, name, labelledBy, options, extraClass = '') {
  const inputs = [];
  const texts = [];
  const group = make('div', { class: `segmented ${extraClass}`.trim(), id, role: 'radiogroup', 'aria-labelledby': labelledBy });
  for (const [value, label] of options) {
    const input = make('input', { type: 'radio', name, value });
    const text = make('span');
    inputs.push(input);
    texts.push([text, label]);
    group.append(make('label', {}, [input, text]));
  }
  return { group, inputs, texts };
}

const card = document.getElementById('launcher-card');
const heading = make('h2', { id: 'launcher-heading' });
const intro = make('p', { class: 'launcher-intro' });
const modeLabel = make('p', { class: 'launcher-field-label', id: 'launcher-mode-label' });
const modes = radioGroup('launcher-mode', 'launcher-mode', 'launcher-mode-label', MODES, 'launcher-modes');
const modeHint = make('p', { class: 'fine-print launcher-mode-hint', id: 'launcher-mode-hint' });
const sizeLabel = make('p', { class: 'launcher-field-label', id: 'launcher-size-label' });
const sizes = radioGroup('launcher-size', 'launcher-size', 'launcher-size-label', SIZES, 'segmented-two');
const hideInput = make('input', { id: 'launcher-hide', type: 'checkbox' });
const hideTitle = make('strong');
const hideHint = make('small');
const hideRow = make('label', { class: 'filter-option', for: 'launcher-hide' }, [hideInput, make('span', {}, [hideTitle, hideHint])]);
const shortcutLabel = make('strong', { id: 'launcher-shortcut-label' });
const shortcutKey = make('kbd', { id: 'launcher-shortcut-key' });
const shortcutChange = make('button', { class: 'btn btn-ghost btn-small', id: 'launcher-shortcut-change', type: 'button' });
const shortcutHint = make('p', { class: 'fine-print' });
const shortcutRow = make('div', { class: 'launcher-shortcut' }, [
  make('div', { class: 'launcher-shortcut-text' }, [shortcutLabel, shortcutKey]),
  shortcutChange,
  shortcutHint,
]);
const resetButton = make('button', { class: 'btn btn-ghost btn-small', id: 'launcher-reset', type: 'button' });
const dragHint = make('p', { class: 'fine-print launcher-drag-hint' });
const status = make('p', { class: 'fine-print launcher-status', id: 'launcher-status', role: 'status', 'aria-live': 'polite' });

modes.group.setAttribute('aria-describedby', 'launcher-mode-hint');
card?.replaceChildren(
  heading, intro,
  modeLabel, modes.group, modeHint,
  sizeLabel, sizes.group,
  hideRow,
  shortcutRow,
  make('div', { class: 'inline-actions' }, [resetButton]),
  dragHint,
  status,
);

let shortcut = '';
let message = '';

function paintText() {
  heading.textContent = t('launcher.title');
  intro.textContent = t('launcher.intro');
  modeLabel.textContent = t('launcher.modeLabel');
  sizeLabel.textContent = t('launcher.sizeLabel');
  for (const [node, label] of [...modes.texts, ...sizes.texts]) node.textContent = label();
  hideTitle.textContent = t('launcher.hide');
  hideHint.textContent = t('launcher.hideHint');
  shortcutLabel.textContent = t('launcher.shortcutLabel');
  shortcutKey.textContent = shortcut || t('launcher.shortcutNone');
  shortcutKey.dataset.empty = String(!shortcut);
  shortcutChange.textContent = t('launcher.shortcutChange');
  shortcutHint.textContent = t('launcher.shortcutHint');
  resetButton.textContent = t('launcher.reset');
  dragHint.textContent = t('launcher.dragHint');
  status.textContent = MESSAGES[message]?.() ?? '';
  paintPrefs(prefs());
}

function paintPrefs(p) {
  const { mode, size, pos } = p.launcher;
  for (const input of modes.inputs) input.checked = input.value === mode;
  for (const input of sizes.inputs) input.checked = input.value === size;
  modeHint.textContent = (MODE_HINTS[mode] ?? MODE_HINTS.normal)();
  resetButton.disabled = pos === null;
}

function say(name) {
  message = name;
  status.textContent = MESSAGES[name]?.() ?? '';
}

modes.group.addEventListener('change', event => {
  if (event.target instanceof HTMLInputElement && event.target.checked) void savePrefs({ launcher: { mode: event.target.value } });
});
sizes.group.addEventListener('change', event => {
  if (event.target instanceof HTMLInputElement && event.target.checked) void savePrefs({ launcher: { size: event.target.value } });
});
resetButton.addEventListener('click', async () => {
  await savePrefs({ launcher: { pos: null } });
  say('resetDone');
  // Focus would otherwise drop to the page once the button disables itself.
  shortcutChange.focus({ preventScroll: true });
});

// "Hide the button completely" is the same switch as "In-game button" at the bottom of the menu.
storage.get('uiLauncher').then(({ uiLauncher }) => { hideInput.checked = uiLauncher === false; }).catch(() => {});
hideInput.addEventListener('change', () => {
  say('');
  storage.set({ uiLauncher: !hideInput.checked }).catch(() => {});
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.uiLauncher) hideInput.checked = changes.uiLauncher.newValue === false;
});

async function refreshShortcut() {
  let keys = '';
  try {
    const commands = await chrome.commands.getAll();
    keys = commands.find(command => command.name === COMMAND)?.shortcut ?? '';
  } catch { /* no commands API here */ }
  shortcut = keys;
  shortcutKey.textContent = shortcut || t('launcher.shortcutNone');
  shortcutKey.dataset.empty = String(!shortcut);
}
shortcutChange.addEventListener('click', async () => {
  try {
    await chrome.tabs.create({ url: SHORTCUTS_PAGE });
  } catch {
    say('unavailable');
  }
});
// The player may come back from Chrome's shortcuts page with a new key.
window.addEventListener('focus', () => void refreshShortcut());
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshShortcut(); });

onPrefs(p => {
  if (message === 'resetDone' && p.launcher.pos !== null) say('');
  paintPrefs(p);
});
i18n?.onChange(() => paintText());
Promise.resolve(i18n?.ready).then(async () => {
  await refreshShortcut();
  paintText();
}).catch(() => paintText());

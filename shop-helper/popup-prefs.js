// Menu preferences, shared by every part of the menu that needs them, and the sound cues the
// menu plays itself (trial answers). Alerts raised in the background play in the game tab instead.
import { normalizeUiPrefs } from './ui-prefs.js';

const listeners = new Set();
let current = normalizeUiPrefs(null);
let loaded = false;

export const prefs = () => current;

export function onPrefs(listener) {
  listeners.add(listener);
  if (loaded) listener(current);
  return () => listeners.delete(listener);
}

function set(next) {
  current = normalizeUiPrefs(next);
  loaded = true;
  for (const listener of listeners) listener(current);
}

export async function savePrefs(patch) {
  const next = normalizeUiPrefs({
    ...current,
    ...patch,
    channels: { ...current.channels, ...patch.channels },
    events: { ...current.events, ...patch.events },
  });
  set(next);
  try { await chrome.storage.local.set({ uiPrefs: next }); } catch { /* the in-memory copy still applies */ }
}

chrome.storage.local.get('uiPrefs').then(({ uiPrefs }) => set(uiPrefs)).catch(() => set(null));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.uiPrefs) set(changes.uiPrefs.newValue);
});

// Plays a menu cue when the player turned sound on. `force` is for the Test button.
export function cue(name, { force = false } = {}) {
  if (!force && !current.channels.sound) return false;
  return globalThis.shopHelperSound?.play(name, current.volume) ?? false;
}

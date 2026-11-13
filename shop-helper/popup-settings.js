// The Settings tab: theme, compact layout, how and about what to be alerted, and backup.
import { buildBackup, parseBackup } from './backup.js';
import { onPrefs, prefs, savePrefs, cue } from './popup-prefs.js';
import { send } from './popup-format.js';

const $ = id => document.getElementById(id);
const el = {
  theme: $('theme-choice'), compact: $('compact-toggle'), calm: $('calm-glitch'),
  desktop: $('chan-desktop'), sound: $('chan-sound'), flash: $('chan-flash'), volume: $('sound-volume'),
  testSound: $('test-sound'), testNotify: $('test-notify'),
  eventGlitch: $('event-glitch'), eventPurchase: $('event-purchase'), eventBlack: $('event-black'),
  note: $('alerts-note'),
  text: $('backup-text'), exportButton: $('backup-export'), importButton: $('backup-import'), status: $('backup-status'),
};

function render(p) {
  for (const radio of el.theme.querySelectorAll('input[type="radio"]')) radio.checked = radio.value === p.theme;
  el.compact.checked = p.compact;
  el.calm.checked = p.calmGlitch;
  el.desktop.checked = p.channels.desktop;
  el.sound.checked = p.channels.sound;
  el.flash.checked = p.channels.titleFlash;
  if (document.activeElement !== el.volume) el.volume.value = String(Math.round(p.volume * 100));
  el.volume.disabled = !p.channels.sound;
  el.eventGlitch.checked = p.events.glitch;
  el.eventPurchase.checked = p.events.purchase;
  el.eventBlack.checked = p.events.black;
  const anyWay = p.channels.desktop || p.channels.sound || p.channels.titleFlash;
  el.note.textContent = anyWay ? '' : 'Nothing will alert you until you turn on at least one way to be told.';
}

el.theme.addEventListener('change', event => {
  if (event.target instanceof HTMLInputElement && event.target.name === 'theme') void savePrefs({ theme: event.target.value });
});
el.compact.addEventListener('change', () => void savePrefs({ compact: el.compact.checked }));
el.calm.addEventListener('change', () => void savePrefs({ calmGlitch: el.calm.checked }));
el.desktop.addEventListener('change', () => void savePrefs({ channels: { desktop: el.desktop.checked } }));
el.sound.addEventListener('change', () => {
  void savePrefs({ channels: { sound: el.sound.checked } });
  if (el.sound.checked) cue('success', { force: true });
});
el.flash.addEventListener('change', () => void savePrefs({ channels: { titleFlash: el.flash.checked } }));
el.volume.addEventListener('input', () => void savePrefs({ volume: Number(el.volume.value) / 100 }));
el.volume.addEventListener('change', () => cue('success', { force: true }));
el.eventGlitch.addEventListener('change', () => void savePrefs({ events: { glitch: el.eventGlitch.checked } }));
el.eventPurchase.addEventListener('change', () => void savePrefs({ events: { purchase: el.eventPurchase.checked } }));
el.eventBlack.addEventListener('change', () => void savePrefs({ events: { black: el.eventBlack.checked } }));

el.testSound.addEventListener('click', () => {
  const played = cue('alert', { force: true });
  el.note.textContent = played ? 'Played the alert chime at your volume.' : 'This browser would not play a sound here.';
});
el.testNotify.addEventListener('click', () => {
  try {
    chrome.notifications.create(`rngidle-test-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: 'Shop Helper test',
      message: 'Desktop notifications are working.',
    }, () => {
      el.note.textContent = chrome.runtime.lastError
        ? 'Chrome would not show a notification. Check that notifications are allowed for Chrome in your system settings.'
        : 'Sent a test notification.';
    });
  } catch {
    el.note.textContent = 'Notifications are not available here.';
  }
});

// ---------- backup ----------

function say(message) { el.status.textContent = message; }

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* the menu can be inside a frame that may not write to the clipboard */ }
  el.text.focus();
  el.text.select();
  try { return document.execCommand('copy'); } catch { return false; }
}

el.exportButton.addEventListener('click', async () => {
  const saved = await chrome.storage.local.get(['settings', 'glitchPrefs', 'uiPrefs']);
  const text = buildBackup(saved);
  el.text.value = text;
  say(await copyText(text) ? 'Copied. Paste it into the same box on another browser to load it there.' : 'Select the text above and copy it.');
});

el.importButton.addEventListener('click', async () => {
  const parsed = parseBackup(el.text.value);
  if (!parsed.ok) { say(parsed.error); return; }
  const applied = [];
  const write = {};
  if (parsed.glitchPrefs) { write.glitchPrefs = parsed.glitchPrefs; applied.push('Glitch wares and alert'); }
  if (parsed.uiPrefs) { write.uiPrefs = parsed.uiPrefs; applied.push('menu preferences'); }
  if (Object.keys(write).length) {
    await chrome.storage.local.set(write).catch(() => {});
    if (write.glitchPrefs) void send({ type: 'GLITCH_PREFS_CHANGED' });
  }
  if (parsed.settings) {
    // popup.js owns the unsaved-changes flow for auto-buy settings.
    document.dispatchEvent(new CustomEvent('shophelper:import-settings', { detail: parsed.settings }));
    applied.push('auto-buy settings (not saved yet)');
  }
  const tail = parsed.settings ? ' Open Auto-buy and choose Save settings to apply them; auto-buy stays off until you switch it on.' : '';
  say(`Loaded ${applied.join(', ')}.${tail}`);
});

onPrefs(render);
render(prefs());

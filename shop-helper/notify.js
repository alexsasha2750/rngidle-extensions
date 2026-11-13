// Tells the player about Glitch visits, Black Market matches and auto-buy results through the
// channels picked in the menu: desktop notification, a sound in the game tab, a title flash.
import { normalizeUiPrefs, wantsEvent } from './ui-prefs.js';

export const GAME_TABS = 'https://rngidle.fun/*';
const SOUNDS = ['alert', 'success', 'fail'];
const UNITS = ['', 'K', 'M', 'B', 'T'];
// A tab that never answers must not hold up a purchase loop.
const CHANNEL_TIMEOUT = 1500;

export function formatEp(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '?';
  const sign = number < 0 ? '-' : '';
  const abs = Math.abs(number);
  if (abs < 1000) return sign + String(Math.round(abs * 100) / 100);
  for (let unit = 1; unit < UNITS.length; unit++) {
    const scaled = Number((abs / 1000 ** unit).toPrecision(3));
    if (scaled < 1000) return `${sign}${scaled}${UNITS[unit]}`;
  }
  return sign + abs.toExponential(2).replace('e+', 'e');
}

function bounded(task, ms) {
  let timer;
  return Promise.race([
    Promise.resolve().then(task).catch(() => {}),
    new Promise(resolve => { timer = setTimeout(resolve, ms); }),
  ]).finally(() => clearTimeout(timer));
}

const clip = (value, max) => (value == null ? '' : String(value)).slice(0, max);

export function createNotifier({ storage, chrome: api }) {
  async function toGameTabs(message) {
    const tabs = await api.tabs.query({ url: GAME_TABS });
    await Promise.all((Array.isArray(tabs) ? tabs : [])
      .filter(tab => tab?.id != null)
      .map(tab => bounded(() => api.tabs.sendMessage(tab.id, message), CHANNEL_TIMEOUT)));
  }

  async function desktop(event, title, message) {
    if (typeof api?.notifications?.create !== 'function') return;
    await api.notifications.create(`rngidle-${event}-${Date.now()}`, {
      type: 'basic', iconUrl: api.runtime.getURL('icons/icon-128.png'), title, message,
    });
  }

  // Never throws: an announcement must not break the purchase or watch that triggered it.
  async function announce(event, info = {}) {
    try {
      const { uiPrefs } = await storage.get('uiPrefs');
      const prefs = normalizeUiPrefs(uiPrefs);
      if (!wantsEvent(prefs, event)) return false;
      const title = clip(info.title, 120) || 'RNGidle Shop Helper';
      const message = clip(info.message, 300) || title;
      const jobs = [];
      if (prefs.channels.desktop) jobs.push(bounded(() => desktop(event, title, message), CHANNEL_TIMEOUT));
      if (prefs.channels.sound && !info.silent) {
        const name = SOUNDS.includes(info.sound) ? info.sound : 'alert';
        jobs.push(bounded(() => toGameTabs({ type: 'HELPER_SOUND', name, volume: prefs.volume }), CHANNEL_TIMEOUT));
      }
      if (prefs.channels.titleFlash) {
        jobs.push(bounded(() => toGameTabs({ type: 'HELPER_FLASH', text: clip(info.flash || title, 80) }), CHANNEL_TIMEOUT));
      }
      await Promise.all(jobs);
      return true;
    } catch {
      return false;
    }
  }

  return { announce };
}

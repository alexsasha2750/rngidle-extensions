// Menu preferences shared by the background worker, the menu and the in-game button. Everything
// is opt-in: the defaults change nothing for someone who never opens the Settings tab.

export const THEMES = ['auto', 'light', 'dark'];
// Keep in step with LANGS in i18n.js (a test checks it). 'auto' follows the browser.
export const LANGUAGES = ['auto', 'en', 'fr', 'ru', 'es', 'zh-Hans', 'zh-Hant', 'hi'];
// How the floating button on the game page shows itself: always, faded until pointed at, or
// tucked into the nearest screen edge. (Hiding it completely is the separate `uiLauncher` switch.)
export const LAUNCHER_MODES = ['normal', 'faded', 'edge'];
export const LAUNCHER_SIZES = ['normal', 'small'];

const flag = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const fraction = value => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : null;
};

// Where the player dragged the button: how far across (x) and down (y) the free space it sits,
// 0 to 1, so it stays put when the window is resized. null means the default corner.
export function normalizeLauncherPos(value) {
  const x = value?.x === undefined ? null : fraction(value.x);
  const y = value?.y === undefined ? null : fraction(value.y);
  return x === null || y === null ? null : { x, y };
}

export function normalizeUiPrefs(value) {
  const volume = Number(value?.volume);
  return {
    theme: THEMES.includes(value?.theme) ? value.theme : 'auto',
    lang: LANGUAGES.includes(value?.lang) ? value.lang : 'auto',
    compact: value?.compact === true,
    // Switches off the game's screen-distorting effects while Glitch is around.
    calmGlitch: value?.calmGlitch === true,
    launcher: {
      mode: LAUNCHER_MODES.includes(value?.launcher?.mode) ? value.launcher.mode : 'normal',
      size: LAUNCHER_SIZES.includes(value?.launcher?.size) ? value.launcher.size : 'normal',
      pos: normalizeLauncherPos(value?.launcher?.pos),
    },
    // Looking for a newer release (it contacts GitHub, so it can be turned off).
    updates: {
      auto: flag(value?.updates?.auto, true),
      prereleases: flag(value?.updates?.prereleases, true),
    },
    // How the player wants to be told.
    channels: {
      desktop: value?.channels?.desktop === true,
      sound: value?.channels?.sound === true,
      titleFlash: value?.channels?.titleFlash === true,
    },
    volume: value?.volume != null && Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.5,
    // What the player wants to be told about.
    events: {
      glitch: flag(value?.events?.glitch, true),
      black: value?.events?.black === true,
      purchase: flag(value?.events?.purchase, true),
    },
  };
}

export const anyChannel = prefs => prefs.channels.desktop || prefs.channels.sound || prefs.channels.titleFlash;

// An event is announced only when the player picked it and at least one channel is on.
export const wantsEvent = (prefs, event) => prefs.events[event] === true && anyChannel(prefs);

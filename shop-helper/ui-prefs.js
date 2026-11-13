// Menu preferences shared by the background worker and the menu. Everything is opt-in:
// the defaults change nothing for someone who never opens the Settings tab.

export const THEMES = ['auto', 'light', 'dark'];

const flag = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

export function normalizeUiPrefs(value) {
  const volume = Number(value?.volume);
  return {
    theme: THEMES.includes(value?.theme) ? value.theme : 'auto',
    compact: value?.compact === true,
    // Switches off the game's screen-distorting effects while Glitch is around.
    calmGlitch: value?.calmGlitch === true,
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

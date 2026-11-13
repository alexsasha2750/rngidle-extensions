// "Calm Glitch's effects": while Glitch is around the game restyles the whole page (tilted cards,
// clipped buttons, colour fringes, page shake, static and scanlines). With the setting on, this
// adds a stylesheet that switches those looks off. It changes only how the page is drawn: every
// rule is scoped to the game's own breach classes, nothing is sent to the game, and his shop's
// gameplay glitches and his arrival scene are left alone. Hidden layers use `visibility`, never
// `display`, so the game's own animations and timers carry on exactly as before.
(() => {
  const STYLE_ID = 'rngidle-shop-helper-calm';

  // `:root` adds specificity so these win over the game's rules whatever order they load in.
  const CSS = `
:root.gbr-jolt #root { translate: none !important; }
:root.gbr-flip #root { scale: none !important; }
:root.gbr-tilt #root { rotate: none !important; }
:root.gbr-on .site-header { box-shadow: none !important; }
:root.gbr-on #root :is(h1, h2, h3, h4, p, li, a, small, label, td, span) { text-shadow: none !important; }
:root.gbr-on:not(.gbr-run) #root :is(section, article, [class*="card"], [class*="panel"]) { rotate: none !important; translate: none !important; }
:root.gbr-on:not(.gbr-run) #root :is(button, [role="button"]):not(.gbr-timer) { clip-path: none !important; }
:root.gbr-on:not(.gbr-run) #root :is(button, [role="button"]):not(.gbr-timer):not(:focus-visible) { outline: none !important; }
:root.gbr-on #root .gbr-bitten { clip-path: none !important; }
:root.gbr-on #root .gbr-dragged { translate: none !important; }
:root.gbr-on #root.ui-glitching { filter: none !important; }
:root.gbr-on .ui-glitch-tear { visibility: hidden !important; }
.gbr-scan, .gbr-edge, .gbr-static, .gbr-noise, .gbr-chroma, .gbr-slice, .gbr-flash, .gbr-ring { visibility: hidden !important; }
`;

  function set(on) {
    const existing = document.getElementById(STYLE_ID);
    if (!on) { existing?.remove(); return; }
    if (existing) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).append(style);
  }

  globalThis.shopHelperCalm = { CSS, set };

  if (typeof chrome === 'undefined' || !chrome.runtime?.id || !chrome.storage?.local) return;
  chrome.storage.local.get('uiPrefs').then(({ uiPrefs }) => set(uiPrefs?.calmGlitch === true)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.uiPrefs) return;
    // After an extension reload this old copy of the script is orphaned; leave the page alone.
    if (!chrome.runtime?.id) return;
    set(changes.uiPrefs.newValue?.calmGlitch === true);
  });
})();

// Hands the "Show potion numbers" setting to potion-numbers-main.js, which runs in the page's own
// world and cannot read extension storage: it watches this data attribute on the page.
(() => {
  const ATTR = 'data-shop-helper-potion-numbers';
  const set = on => document.documentElement.setAttribute(ATTR, on ? '1' : '0');

  if (typeof chrome === 'undefined' || !chrome.runtime?.id || !chrome.storage?.local) return;
  chrome.storage.local.get('uiPrefs').then(({ uiPrefs }) => set(uiPrefs?.potionNumbers === true)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.uiPrefs) return;
    // After an extension reload this old copy of the script is orphaned; leave the page alone.
    if (!chrome.runtime?.id) return;
    set(changes.uiPrefs.newValue?.potionNumbers === true);
  });
})();

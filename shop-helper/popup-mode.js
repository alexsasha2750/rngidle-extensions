// Runs before first paint: sizes the page for the toolbar popup or the in-game panel, and
// applies the saved theme so the menu does not flash the wrong colours.
(() => {
  const root = document.documentElement;
  root.dataset.mode = new URLSearchParams(location.search).get("embedded") === "1" ? "embedded" : "popup";

  const CACHE_KEY = "shopHelperLook";
  const light = window.matchMedia("(prefers-color-scheme: light)");
  const clean = (value) => ({
    theme: value?.theme === "light" || value?.theme === "dark" ? value.theme : "auto",
    compact: value?.compact === true,
    calmGlitch: value?.calmGlitch === true,
  });
  let look = clean(null);
  try { look = clean(JSON.parse(localStorage.getItem(CACHE_KEY))); } catch { /* first run */ }

  function apply() {
    root.dataset.theme = look.theme === "auto" ? (light.matches ? "light" : "dark") : look.theme;
    root.dataset.compact = String(look.compact);
    root.dataset.calm = String(look.calmGlitch);
  }
  function take(prefs) {
    look = clean(prefs);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(look)); } catch { /* storage may be blocked in a frame */ }
    apply();
  }

  apply();
  light.addEventListener("change", apply);
  chrome.storage.local.get("uiPrefs").then(({ uiPrefs }) => take(uiPrefs)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.uiPrefs) take(changes.uiPrefs.newValue);
  });
})();

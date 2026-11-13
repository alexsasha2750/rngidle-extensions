// Language support, shared by the menu, the in-game button and the background worker.
// A plain script (no import or export) so the same file loads as a <script> tag, as a content
// script and as an ES import; it publishes itself on globalThis, like sound.js.
//
// Strings live in locales/<language>/<namespace>.json as flat { key: text } maps. A message is
// looked up as t('namespace.key', { name: value }). Text may hold {name} placeholders, and may be
// an object of plural forms ({ one, few, many, other }) chosen by the `count` parameter.
(() => {
  const LANGS = [
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'Français' },
    { code: 'ru', name: 'Русский' },
    { code: 'es', name: 'Español' },
    { code: 'zh-Hans', name: '简体中文' },
    { code: 'zh-Hant', name: '繁體中文' },
    { code: 'hi', name: 'हिन्दी' },
  ];
  const NAMESPACES = ['core', 'autobuy', 'bundle', 'glitch', 'checker', 'estimator', 'history', 'settings', 'update', 'launcher', 'overlay', 'background'];
  const FALLBACK = 'en';
  const inPage = typeof document !== 'undefined' && typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
  // On the game's own page only the in-game button speaks; everywhere else loads every namespace.
  const WANTED = inPage ? ['overlay'] : NAMESPACES;

  const dictionaries = new Map();
  const loaded = new Set();
  const listeners = new Set();
  let current = FALLBACK;
  let preference = 'auto';

  const codeOf = value => LANGS.find(lang => lang.code === value)?.code;

  // 'auto' follows the browser; anything else must be a supported code.
  function resolve(pref, browserTags) {
    const direct = codeOf(pref);
    if (direct) return direct;
    const tags = browserTags ?? (typeof navigator !== 'undefined' ? [...(navigator.languages ?? []), navigator.language] : []);
    for (const tag of tags) {
      const lower = String(tag ?? '').toLowerCase();
      if (!lower) continue;
      if (lower.startsWith('zh')) return /hant|-tw|-hk|-mo/.test(lower) ? 'zh-Hant' : 'zh-Hans';
      const hit = LANGS.find(lang => lang.code.toLowerCase() === lower.split('-')[0]);
      if (hit) return hit.code;
    }
    return FALLBACK;
  }

  const lookup = (code, key) => dictionaries.get(code)?.get(key);
  const pluralRules = new Map();
  function plural(code, count) {
    const tag = code === 'zh-Hans' || code === 'zh-Hant' ? 'zh' : code;
    if (!pluralRules.has(tag)) pluralRules.set(tag, new Intl.PluralRules(tag));
    return pluralRules.get(tag).select(Number(count) || 0);
  }

  function fill(text, params) {
    if (!params) return text;
    return String(text).replace(/\{(\w+)\}/g, (whole, name) => (params[name] === undefined || params[name] === null ? whole : String(params[name])));
  }

  function t(key, params) {
    let value = lookup(current, key);
    if (value === undefined && current !== FALLBACK) value = lookup(FALLBACK, key);
    if (value === undefined) return key;
    if (value && typeof value === 'object') {
      const form = plural(current, params?.count);
      value = value[form] ?? value.other ?? Object.values(value)[0];
    }
    return fill(value, params);
  }
  const has = key => lookup(current, key) !== undefined || lookup(FALLBACK, key) !== undefined;

  function store(code, namespace, data) {
    if (!data || typeof data !== 'object') return;
    if (!dictionaries.has(code)) dictionaries.set(code, new Map());
    const map = dictionaries.get(code);
    for (const [key, text] of Object.entries(data)) map.set(`${namespace}.${key}`, text);
  }

  async function fetchNamespace(code, namespace) {
    const id = `${code}/${namespace}`;
    if (loaded.has(id)) return;
    loaded.add(id);
    try {
      const response = await fetch(chrome.runtime.getURL(`locales/${code}/${namespace}.json`));
      if (response.ok) store(code, namespace, await response.json());
    } catch { /* a missing file just falls back to English */ }
  }
  const loadLanguage = code => Promise.all(WANTED.map(namespace => fetchNamespace(code, namespace)));

  function applyDom(root) {
    const scope = root ?? (typeof document !== 'undefined' ? document : null);
    if (!scope?.querySelectorAll) return;
    for (const node of scope.querySelectorAll('[data-i18n]')) node.textContent = t(node.getAttribute('data-i18n'));
    for (const node of scope.querySelectorAll('[data-i18n-attr]')) {
      for (const pair of node.getAttribute('data-i18n-attr').split(';')) {
        const [attribute, key] = pair.split(':').map(part => part.trim());
        if (attribute && key) node.setAttribute(attribute, t(key));
      }
    }
    const element = scope.documentElement ?? (typeof document !== 'undefined' ? document.documentElement : null);
    if (element) element.lang = current;
  }

  function announce() {
    for (const listener of listeners) {
      try { listener(current); } catch { /* one listener must not stop the rest */ }
    }
  }

  async function setLanguage(pref) {
    preference = codeOf(pref) ? pref : 'auto';
    const code = resolve(preference);
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      await Promise.all([loadLanguage(FALLBACK), code === FALLBACK ? null : loadLanguage(code)]);
    }
    const changed = code !== current;
    current = code;
    applyDom();
    if (changed) announce();
    return current;
  }

  const onChange = listener => { listeners.add(listener); return () => listeners.delete(listener); };

  // Locale-aware number formatting for the chosen language (EP is deliberately left alone).
  const formatNumber = (value, options) => new Intl.NumberFormat(current, options).format(value);
  const formatDate = (value, options) => new Intl.DateTimeFormat(current, options).format(new Date(value));

  const api = {
    LANGS, NAMESPACES, t, has, resolve, setLanguage, applyDom, onChange, formatNumber, formatDate,
    language: () => current,
    preference: () => preference,
    ready: Promise.resolve(),
    // For tests: put dictionaries in directly instead of fetching them.
    _test: { store, reset() { dictionaries.clear(); loaded.clear(); current = FALLBACK; preference = 'auto'; }, setCurrent(code) { current = code; } },
  };
  globalThis.shopHelperI18n = api;

  if (typeof chrome === 'undefined' || !chrome.storage?.local || !chrome.runtime?.getURL) return;
  api.ready = (async () => {
    try {
      const { uiPrefs } = await chrome.storage.local.get('uiPrefs');
      await setLanguage(uiPrefs?.lang ?? 'auto');
    } catch { /* stay in English */ }
  })();
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applyDom());
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.uiPrefs) return;
    if (!chrome.runtime?.id) return;
    const next = changes.uiPrefs.newValue?.lang ?? 'auto';
    if (next !== preference) void setLanguage(next);
  });
})();

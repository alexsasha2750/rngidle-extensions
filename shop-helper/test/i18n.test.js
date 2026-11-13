import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LANGUAGES, normalizeLauncherPos, normalizeUiPrefs } from '../ui-prefs.js';

await import('../i18n.js');
const i18n = globalThis.shopHelperI18n;
const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const localeDirs = fs.readdirSync(new URL('locales/', root), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
const flat = (language, namespace) => {
  const file = new URL(`locales/${language}/${namespace}.json`, root);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};
const placeholders = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(',');
const texts = value => (value && typeof value === 'object' ? Object.values(value) : [value]);

test('the language list matches the preferences', () => {
  assert.deepEqual(LANGUAGES, ['auto', ...i18n.LANGS.map(lang => lang.code)]);
  assert.equal(normalizeUiPrefs({ lang: 'fr' }).lang, 'fr');
  assert.equal(normalizeUiPrefs({ lang: 'klingon' }).lang, 'auto');
});

test('the browser language is mapped to a supported one', () => {
  const pick = (pref, tags) => i18n.resolve(pref, tags);
  assert.equal(pick('auto', ['fr-CA']), 'fr');
  assert.equal(pick('auto', ['ru']), 'ru');
  assert.equal(pick('auto', ['es-MX', 'en']), 'es');
  assert.equal(pick('auto', ['hi-IN']), 'hi');
  assert.equal(pick('auto', ['zh-CN']), 'zh-Hans');
  assert.equal(pick('auto', ['zh-Hans-SG']), 'zh-Hans');
  assert.equal(pick('auto', ['zh-TW']), 'zh-Hant');
  assert.equal(pick('auto', ['zh-HK']), 'zh-Hant');
  assert.equal(pick('auto', ['zh-Hant']), 'zh-Hant');
  assert.equal(pick('auto', ['de', 'it']), 'en', 'an unsupported language falls back to English');
  assert.equal(pick('auto', ['de', 'fr']), 'fr', 'the first supported one wins');
  assert.equal(pick('ru', ['fr']), 'ru', 'a chosen language beats the browser');
  assert.equal(pick('klingon', ['fr']), 'fr');
  assert.equal(pick('auto', []), 'en');
});

test('messages fill in values, choose plural forms and fall back to English', () => {
  i18n._test.reset();
  i18n._test.store('en', 'demo', { hello: 'Hello {name}', things: { one: '{count} thing', other: '{count} things' }, onlyEn: 'English only' });
  i18n._test.store('ru', 'demo', { hello: 'Привет, {name}', things: { one: '{count} штука', few: '{count} штуки', many: '{count} штук', other: '{count} штуки' } });
  i18n._test.store('zh-Hans', 'demo', { hello: '你好，{name}', things: { other: '{count} 件' } });

  assert.equal(i18n.t('demo.hello', { name: 'Ana' }), 'Hello Ana');
  assert.equal(i18n.t('demo.things', { count: 1 }), '1 thing');
  assert.equal(i18n.t('demo.things', { count: 5 }), '5 things');
  assert.equal(i18n.t('demo.nothing'), 'demo.nothing', 'an unknown key shows itself');
  assert.equal(i18n.t('demo.hello'), 'Hello {name}', 'a missing value leaves its placeholder');

  i18n._test.setCurrent('ru');
  assert.equal(i18n.t('demo.hello', { name: 'Ана' }), 'Привет, Ана');
  assert.equal(i18n.t('demo.things', { count: 1 }), '1 штука');
  assert.equal(i18n.t('demo.things', { count: 3 }), '3 штуки');
  assert.equal(i18n.t('demo.things', { count: 11 }), '11 штук');
  assert.equal(i18n.t('demo.onlyEn'), 'English only', 'a missing translation falls back to English');
  assert.equal(i18n.has('demo.onlyEn'), true);

  i18n._test.setCurrent('zh-Hans');
  assert.equal(i18n.t('demo.things', { count: 4 }), '4 件');
  i18n._test.reset();
});

test('the page text is replaced from data attributes', () => {
  i18n._test.reset();
  i18n._test.store('en', 'demo', { title: 'A title', label: 'A label' });
  const make = attributes => ({ attributes: { ...attributes }, textContent: '', getAttribute(name) { return this.attributes[name]; }, setAttribute(name, value) { this.attributes[name] = value; } });
  const heading = make({ 'data-i18n': 'demo.title' });
  const button = make({ 'data-i18n-attr': 'aria-label:demo.label; title:demo.title' });
  const documentElement = {};
  i18n.applyDom({ documentElement, querySelectorAll: selector => (selector === '[data-i18n]' ? [heading] : [button]) });
  assert.equal(heading.textContent, 'A title');
  assert.equal(button.attributes['aria-label'], 'A label');
  assert.equal(button.attributes.title, 'A title');
  assert.equal(documentElement.lang, 'en');
  i18n._test.reset();
});

test('every language has the same keys and placeholders as English', () => {
  assert.ok(localeDirs.includes('en'));
  for (const language of localeDirs.filter(dir => dir !== 'en')) {
    assert.ok(i18n.LANGS.some(lang => lang.code === language), `locales/${language} is not a supported language`);
  }
  for (const language of localeDirs) {
    for (const namespace of i18n.NAMESPACES) {
      const english = flat('en', namespace);
      assert.ok(english, `locales/en/${namespace}.json is missing`);
      if (language === 'en') continue;
      const other = flat(language, namespace);
      assert.ok(other, `locales/${language}/${namespace}.json is missing`);
      assert.deepEqual(Object.keys(other).sort(), Object.keys(english).sort(), `${language}/${namespace} must have exactly the same keys as English`);
      for (const [key, value] of Object.entries(english)) {
        const translated = other[key];
        assert.equal(typeof translated, typeof value, `${language}/${namespace}.${key} has a different shape`);
        const wanted = placeholders(texts(value).join(' '));
        for (const text of texts(translated)) {
          assert.ok(String(text).trim(), `${language}/${namespace}.${key} is empty`);
          assert.equal(placeholders(text), wanted === '' ? '' : wanted.split(',').filter((name, index, all) => all.indexOf(name) === index).join(','), `${language}/${namespace}.${key} must keep its placeholders`);
        }
        if (value && typeof value === 'object') assert.ok('other' in translated, `${language}/${namespace}.${key} needs an “other” form`);
      }
    }
  }
});

test('every message the code asks for exists in English', () => {
  const english = new Set(i18n.NAMESPACES.flatMap(namespace => Object.keys(flat('en', namespace) ?? {}).map(key => `${namespace}.${key}`)));
  const wanted = new Map();
  const note = (key, where) => { if (!wanted.has(key)) wanted.set(key, where); };
  const sources = fs.readdirSync(root).filter(name => /\.(js|html)$/.test(name) && name !== 'i18n.js');
  for (const name of sources) {
    const source = read(name);
    for (const match of source.matchAll(/\bt\(\s*['"`]([a-z]+\.[\w.]+)['"`]/g)) note(match[1], name);
    for (const match of source.matchAll(/data-i18n(?:-title)?="([a-z]+\.[\w.]+)"/g)) note(match[1], name);
    for (const match of source.matchAll(/data-i18n-attr="([^"]+)"/g)) {
      for (const pair of match[1].split(';')) note(pair.split(':')[1]?.trim(), name);
    }
  }
  for (const [key, where] of wanted) {
    if (!key) continue;
    assert.ok(english.has(key), `${where} uses “${key}”, which locales/en does not define`);
  }
});

test('the launcher position stays inside the screen', () => {
  assert.equal(normalizeLauncherPos(null), null);
  assert.equal(normalizeLauncherPos({ x: 0.2 }), null, 'both coordinates are needed');
  assert.deepEqual(normalizeLauncherPos({ x: 2, y: -1 }), { x: 1, y: 0 });
  assert.deepEqual(normalizeLauncherPos({ x: '0.25', y: '0.5' }), { x: 0.25, y: 0.5 });
  assert.equal(normalizeLauncherPos({ x: 'left', y: 0.5 }), null);
  const prefs = normalizeUiPrefs({ launcher: { mode: 'edge', size: 'small', pos: { x: 0.5, y: 0.5 } }, updates: { auto: false } });
  assert.deepEqual(prefs.launcher, { mode: 'edge', size: 'small', pos: { x: 0.5, y: 0.5 } });
  assert.deepEqual(prefs.updates, { auto: false, prereleases: true });
  assert.deepEqual(normalizeUiPrefs({ launcher: { mode: 'weird' } }).launcher, { mode: 'normal', size: 'normal', pos: null });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackup, parseBackup } from '../backup.js';

const settings = {
  enabled: true,
  rules: [{ uid: 'u1', id: 'luck_6', quantity: 3, mode: 'once' }],
  blackMarket: { enabled: true, itemIds: ['luck_6'] },
  safety: { dryRun: true, cap: { enabled: true, amount: 5e6, period: 'day' } },
};

test('an export never carries the on switch, and imports back to the same settings', () => {
  const text = buildBackup({
    settings,
    glitchPrefs: { alert: true, itemIds: ['bitflip'], limits: { bitflip: '500' }, notes: { bitflip: 'wait' } },
    uiPrefs: { theme: 'light' },
  }, new Date('2026-11-13T10:00:00Z'));
  const data = JSON.parse(text);
  assert.equal(data.app, 'rngidle-shop-helper');
  assert.equal(data.settings.enabled, false, 'auto-buy is exported switched off');
  assert.equal(data.exportedAt, '2026-11-13T10:00:00.000Z');
  assert.equal('progress' in data || 'history' in data || 'boundAccount' in data, false);

  const back = parseBackup(text);
  assert.equal(back.ok, true);
  assert.equal(back.settings.enabled, false);
  assert.deepEqual(back.settings.rules, settings.rules);
  assert.deepEqual(back.settings.safety, settings.safety);
  assert.deepEqual(back.glitchPrefs, { alert: true, itemIds: ['bitflip'], limits: { bitflip: 500 }, notes: { bitflip: 'wait' } });
  assert.equal(back.uiPrefs.theme, 'light');
});

test('bad text is refused with a clear reason', () => {
  assert.match(parseBackup('').error, /Paste/);
  assert.match(parseBackup('{nope').error, /valid/);
  assert.match(parseBackup('[]').error, /doesn’t look/);
  assert.match(parseBackup('{"app":"other","format":1}').error, /doesn’t look/);
  assert.match(parseBackup('{"app":"rngidle-shop-helper","format":9}').error, /different version/);
  assert.match(parseBackup('{"app":"rngidle-shop-helper","format":1}').error, /no settings/);
  assert.match(parseBackup('{"app":"rngidle-shop-helper","format":1,"settings":[1]}').error, /damaged/);
  assert.match(parseBackup('x'.repeat(200001)).error, /too long/);
});

test('an import with only some parts leaves the rest alone, and forces auto-buy off', () => {
  const only = parseBackup(JSON.stringify({ app: 'rngidle-shop-helper', format: 1, uiPrefs: { compact: true } }));
  assert.equal(only.ok, true);
  assert.equal(only.settings, undefined);
  assert.equal(only.glitchPrefs, undefined);
  assert.equal(only.uiPrefs.compact, true);
  const sneaky = parseBackup(JSON.stringify({ app: 'rngidle-shop-helper', format: 1, settings: { enabled: true, rules: [] } }));
  assert.equal(sneaky.settings.enabled, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { anyChannel, normalizeUiPrefs, wantsEvent } from '../ui-prefs.js';

test('defaults change nothing until the player opts in', () => {
  const prefs = normalizeUiPrefs(undefined);
  assert.equal(prefs.theme, 'auto');
  assert.equal(prefs.compact, false);
  assert.deepEqual(prefs.channels, { desktop: false, sound: false, titleFlash: false });
  assert.equal(anyChannel(prefs), false);
  assert.equal(wantsEvent(prefs, 'purchase'), false, 'events are quiet while every channel is off');
});

test('bad values fall back and the volume is clamped', () => {
  assert.equal(normalizeUiPrefs({ theme: 'neon' }).theme, 'auto');
  assert.equal(normalizeUiPrefs({ theme: 'light' }).theme, 'light');
  assert.equal(normalizeUiPrefs({ volume: 7 }).volume, 1);
  assert.equal(normalizeUiPrefs({ volume: -2 }).volume, 0);
  assert.equal(normalizeUiPrefs({ volume: 'loud' }).volume, 0.5);
  assert.equal(normalizeUiPrefs({ channels: { sound: 'yes' } }).channels.sound, false);
});

test('an event needs both its own switch and a channel', () => {
  const prefs = normalizeUiPrefs({ channels: { desktop: true }, events: { glitch: false, black: true } });
  assert.equal(wantsEvent(prefs, 'purchase'), true);
  assert.equal(wantsEvent(prefs, 'glitch'), false);
  assert.equal(wantsEvent(prefs, 'black'), true);
  assert.equal(wantsEvent(prefs, 'unknown'), false);
});

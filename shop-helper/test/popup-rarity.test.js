import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeRarity, rarityTitle } from '../popup-rarity.js';

test('saved checks without a rarity, or with a broken one, have none', () => {
  for (const value of [undefined, null, 'rare', {}, { tier: 1 }, { tier: 'x" onclick="' }, { tier: 'ab' }, { tier: 'Rare' }]) {
    assert.equal(normalizeRarity(value), null);
  }
  assert.equal(rarityTitle(null), '');
});

test('a game rarity keeps its tier and a short label', () => {
  assert.deepEqual(normalizeRarity({ tier: 'cosmic_horror', label: 'Cosmic Horror' }), { tier: 'cosmic_horror', label: 'Cosmic Horror' });
  assert.deepEqual(normalizeRarity({ tier: 'numinous_ineffability_303' }), { tier: 'numinous_ineffability_303', label: 'numinous ineffability 303' });
  assert.equal(normalizeRarity({ tier: 'epic', label: 'E'.repeat(60) }).label.length, 40);
});

test('every tier in the game palette has colours in popup.css', () => {
  const css = fs.readFileSync(new URL('../popup.css', import.meta.url), 'utf8');
  const tiers = ['trash', 'common', 'uncommon', 'rare', 'epic', 'anomaly', 'mythic', 'trashest', 'secret', 'unral', 'aberration',
    'otherworldly', 'cataclysmic', 'divine', 'transcendent', 'voidborne', 'emperor', 'alcubierre', 'eleutheria', 'singularity',
    'goldweaver', 'cosmic_horror', 'godslayer', 'devilish', 'error'];
  for (const tier of tiers) assert.ok(css.includes(`[data-rarity="${tier}"] { --rar-pill:`), `${tier} has no colours`);
  assert.ok(css.includes('[data-rarity^="numinous_ineffability"] { --rar-pill:'));
  for (const tier of tiers.slice(0, 7)) assert.ok(css.includes(`html[data-theme="light"] [data-rarity="${tier}"]`), `${tier} has no light-theme colours`);
});

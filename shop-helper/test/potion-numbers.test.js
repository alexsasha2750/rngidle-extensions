import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeUiPrefs } from '../ui-prefs.js';

delete globalThis.document;
await import('../potion-numbers-main.js');
const { suffixFor, retitle } = globalThis.shopHelperPotionNumbers;

function chip(title) {
  const attributes = new Map([['title', title]]);
  return {
    dataset: {},
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
  };
}
const entry = (score, number) => ({ item: 'x', best: { score, number } });

test('the number is added right after the EP of the best roll, for any kind of potion', () => {
  assert.equal(suffixFor(entry(1_200_000, '3+4i')), ' · number 3+4i');
  assert.equal(suffixFor({ best: { score: 5, number: null } }), '', 'a hidden number adds nothing');
  assert.equal(suffixFor({ best: null }), '');
  assert.equal(suffixFor(entry(1, 'x'.repeat(200))).length, ' · number '.length + 60);
  const chips = [chip('Mirror Potion: 3 numbers changed · best 1.2M EP'), chip('Badge Potion: found a match · best 90K EP')];
  retitle(chips, [entry(1, '1'), entry(1_200_000, '-7.25'), entry(90_000, '4242')], true);
  assert.equal(chips[0].getAttribute('title'), 'Mirror Potion: 3 numbers changed · best 1.2M EP · number -7.25');
  assert.equal(chips[1].getAttribute('title'), 'Badge Potion: found a match · best 90K EP · number 4242');
});

test('running again changes nothing, and turning it off restores the game\'s text', () => {
  const chips = [chip('Mirror Potion: 1 number changed · best 5 EP')];
  const log = [entry(5, '12')];
  retitle(chips, log, true);
  retitle(chips, log, true);
  assert.equal(chips[0].getAttribute('title'), 'Mirror Potion: 1 number changed · best 5 EP · number 12');
  retitle(chips, log, false);
  assert.equal(chips[0].getAttribute('title'), 'Mirror Potion: 1 number changed · best 5 EP');
  assert.equal(chips[0].dataset.shNumber, undefined);
});

test('when the game rewrites a chip for another potion, the stale number does not stay', () => {
  const chips = [chip('A: 1 number changed · best 5 EP')];
  retitle(chips, [entry(5, '12')], true);
  chips[0].setAttribute('title', 'B: no match');
  retitle(chips, [{ item: 'b', best: null }], true);
  assert.equal(chips[0].getAttribute('title'), 'B: no match');
});

test('with nothing on screen or no log there is nothing to do', () => {
  retitle([], [entry(1, '1')], true);
  const chips = [chip('A · best 1 EP')];
  retitle(chips, undefined, true);
  assert.equal(chips[0].getAttribute('title'), 'A · best 1 EP');
});

test('the setting is an opt-in preference and the scripts are wired into the game page', () => {
  assert.equal(normalizeUiPrefs(undefined).potionNumbers, false);
  assert.equal(normalizeUiPrefs({ potionNumbers: true }).potionNumbers, true);
  assert.equal(normalizeUiPrefs({ potionNumbers: 'yes' }).potionNumbers, false);
  const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  const main = manifest.content_scripts.find(script => script.js.includes('potion-numbers-main.js'));
  assert.equal(main.world, 'MAIN', 'it has to read the game\'s own potion log');
  assert.ok(manifest.content_scripts.some(script => script.js.includes('potion-numbers.js') && !script.world), 'the bridge needs extension storage');
  const html = fs.readFileSync(new URL('../popup.html', import.meta.url), 'utf8');
  assert.ok(html.includes('id="potion-numbers"'));
});

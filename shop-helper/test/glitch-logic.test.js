import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampRest, interpretAnswer, normalizePrefs, normalizeShop, offerState, parseQuestion, visitKey, wantedAvailable,
} from '../glitch-logic.js';

const offer = (over = {}) => ({ id: 'bitflip', price: 300, left: 1, bought: 0, ...over });
const shop = (over = {}) => ({ open: true, endsAt: 5000, wallet: { effective: 1000 }, items: [offer(), offer({ id: 'glitch', price: 900 })], ...over });

test('offer state follows the game button rules', () => {
  assert.deepEqual(offerState(offer(), shop()), { buyable: true, reason: '' });
  assert.equal(offerState(offer({ bought: 1 }), shop()).reason, 'bought');
  assert.equal(offerState(offer({ left: 0 }), shop()).reason, 'sold');
  assert.equal(offerState(offer(), shop({ open: false })).reason, 'away');
  assert.equal(offerState(offer({ price: 5000 }), shop()).reason, 'poor');
  assert.equal(offerState(offer({ price: 'x' }), shop()).reason, 'invalid');
  assert.equal(offerState(offer({ id: 'Bad Id!' }), shop()).reason, 'invalid');
  assert.equal(offerState(offer(), shop({ wallet: null })).buyable, true, 'an unknown balance does not block the trial');
});

test('prefs are cleaned up', () => {
  assert.deepEqual(normalizePrefs(undefined), { alert: false, itemIds: [] });
  assert.deepEqual(normalizePrefs({ alert: true, itemIds: ['glitch', 'glitch', 7, 'No Good', 'bitflip'] }), { alert: true, itemIds: ['glitch', 'bitflip'] });
  assert.equal(normalizePrefs({ alert: 'yes' }).alert, false);
});

test('alerts cover buyable wares, narrowed to the ticked ones', () => {
  assert.deepEqual(wantedAvailable({ itemIds: [] }, shop()), ['bitflip', 'glitch']);
  assert.deepEqual(wantedAvailable({ itemIds: ['glitch'] }, shop()), ['glitch']);
  assert.deepEqual(wantedAvailable({ itemIds: ['glitch'] }, shop({ wallet: { effective: 10 } })), []);
  assert.deepEqual(wantedAvailable({ itemIds: [] }, shop({ open: false })), []);
  assert.deepEqual(wantedAvailable({ itemIds: ['overflow'] }, shop()), [], 'a ware that is not on the shelf is not alerted');
  assert.equal(visitKey(shop()), '5000');
  assert.equal(visitKey(shop({ open: false })), '');
});

test('the public shop is trimmed and validated', () => {
  const clean = normalizeShop({ open: true, slot: 9, endsAt: 100, now: 50, junk: 1, items: [{ id: 'glitch', price: 5, left: 1, bought: 0, stock: 1, secret: 'x' }, { id: '../bad' }, null] }, { effective: 77 });
  assert.deepEqual(clean, { open: true, slot: 9, endsAt: 100, now: 50, wallet: { effective: 77 }, items: [{ id: 'glitch', price: 5, left: 1, bought: 0, stock: 1 }] });
  assert.equal(normalizeShop({ items: 'nope' }), null);
  assert.equal(normalizeShop({ open: true, items: [] }).wallet, null);
});

test('questions are validated and keep their original ids and choices', () => {
  const good = { id: 'abc', step: 0, steps: 2, prompt: 'What is 2+2?', choices: ['3', 4, '5'], ms: 8000 };
  assert.deepEqual(parseQuestion(good), good);
  assert.equal(parseQuestion({ ...good, id: 12 }).id, 12);
  assert.equal(parseQuestion({ ...good, choices: undefined }).choices, null);
  for (const bad of [null, {}, { ...good, id: {} }, { ...good, step: 2 }, { ...good, steps: 0 }, { ...good, prompt: '' },
    { ...good, ms: 0 }, { ...good, ms: 'x' }, { ...good, choices: ['only'] }, { ...good, choices: [{}, {}] }, { ...good, prompt: 'x'.repeat(801) }]) {
    assert.equal(parseQuestion(bad), null, JSON.stringify(bad));
  }
});

test('answers are interpreted like the game does', () => {
  assert.deepEqual(interpretAnswer({ ok: false, late: true, answer: 42, rest: 5000 }), { kind: 'failed', late: true, answer: '42', rest: 5000 });
  assert.deepEqual(interpretAnswer({ ok: false }), { kind: 'failed', late: false, answer: '', rest: 8000 });
  assert.deepEqual(interpretAnswer({ ok: true, passed: true, id: 'trial-1' }), { kind: 'passed', id: 'trial-1' });
  assert.equal(interpretAnswer({ ok: true, passed: true }).kind, 'bad');
  const next = interpretAnswer({ ok: true, id: 'q2', step: 1, steps: 2, prompt: 'Next?', ms: 5000 });
  assert.equal(next.kind, 'next');
  assert.equal(next.question.step, 1);
  assert.equal(interpretAnswer({ ok: true, prompt: 'no id' }).kind, 'bad');
  assert.equal(interpretAnswer(null).kind, 'bad');
  assert.equal(clampRest(999999), 60000);
  assert.equal(clampRest(0), 8000);
});

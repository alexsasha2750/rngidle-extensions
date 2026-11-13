import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier, formatEp } from '../notify.js';

function setup(uiPrefs, over = {}) {
  const data = { uiPrefs };
  const created = [];
  const sent = [];
  const api = {
    runtime: { getURL: path => `chrome-extension://abc/${path}` },
    notifications: { create: async (id, options) => { created.push({ id, options }); return id; } },
    tabs: {
      query: async query => { assert.deepEqual(query, { url: 'https://rngidle.fun/*' }); return [{ id: 4 }, { id: 9 }, {}]; },
      sendMessage: async (tabId, message) => { sent.push({ tabId, message }); },
    },
    ...over,
  };
  const storage = { get: async key => (key in data ? { [key]: structuredClone(data[key]) } : {}) };
  return { created, sent, notifier: createNotifier({ storage, chrome: api }) };
}
const everything = { channels: { desktop: true, sound: true, titleFlash: true }, volume: 0.8, events: { glitch: true, black: true, purchase: true } };

test('formatEp is compact', () => {
  const cases = [[0, '0'], [75, '75'], [12.345, '12.35'], [1000, '1K'], [999_950, '1M'], [5_200_000, '5.2M'],
    [17_500_000, '17.5M'], [1_250_000_000, '1.25B'], [2e12, '2T'], [1.5e15, '1.50e15'], [-2500, '-2.5K'], [NaN, '?'], ['x', '?']];
  for (const [value, text] of cases) assert.equal(formatEp(value), text, String(value));
});

test('nothing is announced unless the event and a channel are both picked', async () => {
  for (const prefs of [undefined, { events: { purchase: true } }, { channels: { desktop: true }, events: { purchase: false } },
    { channels: { sound: true }, events: { black: false } }]) {
    const h = setup(prefs);
    assert.equal(await h.notifier.announce(prefs?.events?.black === false ? 'black' : 'purchase', { title: 't', sound: 'success' }), false);
    assert.equal(h.created.length + h.sent.length, 0);
  }
  const h = setup(everything);
  assert.equal(await h.notifier.announce('unknown', { title: 't' }), false);
  assert.equal(h.created.length + h.sent.length, 0);
});

test('every picked channel is used: desktop, sound and title flash in every game tab', async () => {
  const h = setup(everything);
  assert.equal(await h.notifier.announce('glitch', { title: 'Glitch is here', message: 'Glitch Potion on his shelf', sound: 'alert', flash: 'Glitch!' }), true);
  assert.equal(h.created.length, 1);
  assert.match(h.created[0].id, /^rngidle-glitch-\d+$/);
  assert.deepEqual(h.created[0].options, {
    type: 'basic', iconUrl: 'chrome-extension://abc/icons/icon-128.png', title: 'Glitch is here', message: 'Glitch Potion on his shelf',
  });
  assert.deepEqual(h.sent, [
    { tabId: 4, message: { type: 'HELPER_SOUND', name: 'alert', volume: 0.8 } },
    { tabId: 9, message: { type: 'HELPER_SOUND', name: 'alert', volume: 0.8 } },
    { tabId: 4, message: { type: 'HELPER_FLASH', text: 'Glitch!' } },
    { tabId: 9, message: { type: 'HELPER_FLASH', text: 'Glitch!' } },
  ]);
});

test('channels are independent; silent skips the sound; unknown sounds become the alert', async () => {
  const flashOnly = setup({ channels: { titleFlash: true }, events: { purchase: true } });
  await flashOnly.notifier.announce('purchase', { title: 'Bought 3 × Luck Potion III', sound: 'success' });
  assert.equal(flashOnly.created.length, 0);
  assert.deepEqual(flashOnly.sent.map(entry => entry.message), [
    { type: 'HELPER_FLASH', text: 'Bought 3 × Luck Potion III' }, { type: 'HELPER_FLASH', text: 'Bought 3 × Luck Potion III' },
  ]);
  const quiet = setup({ channels: { sound: true }, events: { purchase: true } });
  await quiet.notifier.announce('purchase', { title: 't', sound: 'success', silent: true });
  assert.equal(quiet.sent.length, 0);
  const odd = setup({ channels: { sound: true }, events: { purchase: true } });
  await odd.notifier.announce('purchase', { title: 't', sound: 'kaboom' });
  assert.equal(odd.sent[0].message.name, 'alert');
  assert.equal(odd.sent[0].message.volume, 0.5);
});

test('missing or failing APIs never throw', async () => {
  const noNotifications = setup(everything, { notifications: undefined });
  assert.equal(await noNotifications.notifier.announce('black', { title: 'Black Market has a match', sound: 'alert' }), true);
  assert.equal(noNotifications.sent.length, 4);
  const failing = setup(everything, {
    notifications: { create: async () => { throw new Error('denied'); } },
    tabs: { query: async () => [{ id: 1 }], sendMessage: async () => { throw new Error('no receiver'); } },
  });
  assert.equal(await failing.notifier.announce('purchase', { title: 't' }), true);
  const broken = createNotifier({ storage: { get: async () => { throw new Error('gone'); } }, chrome: {} });
  assert.equal(await broken.announce('purchase', { title: 't' }), false);
});

test('a tab that never answers cannot hold up the caller', async () => {
  const stuck = setup({ channels: { sound: true }, events: { purchase: true } }, {
    tabs: { query: async () => [{ id: 1 }], sendMessage: () => new Promise(() => {}) },
  });
  const started = Date.now();
  assert.equal(await stuck.notifier.announce('purchase', { title: 't' }), true);
  assert.ok(Date.now() - started < 3000);
});

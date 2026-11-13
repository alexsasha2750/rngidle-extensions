import test from 'node:test';
import assert from 'node:assert/strict';
import { createGlitchService, GLITCH_ALARM } from '../glitch.js';

// A scripted game tab: records every request and answers like the game's server would.
function harness(over = {}) {
  const data = { glitchPrefs: { alert: true, itemIds: [] }, ...over.storage };
  const writes = [];
  const storage = {
    get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in data).map(key => [key, structuredClone(data[key])])),
    set: async values => { writes.push(Object.keys(values)); Object.assign(data, structuredClone(values)); },
    remove: async key => { delete data[key]; },
  };
  const world = {
    tab: { id: 1, identity: { user: { id: 'account-1' } } },
    shop: { now: 1000, slot: 7, open: true, endsAt: 99000, wallet: { effective: 50_000_000_000 }, items: [
      { id: 'bitflip', stock: 2, price: 300_000_000, perPlayer: 1, bought: 0, left: 1 },
      { id: 'glitch', stock: 1, price: 23_000_000_000, perPlayer: 1, bought: 0, left: 1 },
      { id: 'overflow', stock: 3, price: 1_000_000_000, perPlayer: 1, bought: 0, left: 1 },
    ] },
    trial: { id: 'q-1', step: 0, steps: 2, prompt: 'Pick the odd one out', choices: ['a', 'b', 'c'], ms: 9000 },
    answers: [],
    buyReplies: [],
    sent: [],
    ...over.world,
  };
  const activities = [];
  const badge = [];
  const alarms = new Map();
  globalThis.chrome = {
    action: { setBadgeText: async ({ text }) => badge.push(text), setBadgeBackgroundColor: async () => {} },
    alarms: {
      get: async name => alarms.get(name),
      create: async (name, info) => alarms.set(name, info),
      clear: async name => alarms.delete(name),
    },
  };
  const site = async (_tabId, message) => {
    world.sent.push(message);
    switch (message.type) {
      case 'SITE_GLITCH': return world.shopReply ? world.shopReply() : { ok: true, data: structuredClone(world.shop) };
      case 'SITE_INVENTORY': return { ok: true, data: { wallet: { effective: 42 } } };
      case 'SITE_GLITCH_TRIAL': return world.trialReply ? world.trialReply(message) : { ok: true, data: world.trial };
      case 'SITE_GLITCH_ANSWER': return world.answers.length ? world.answers.shift() : { ok: true, data: { ok: false, answer: 'a', rest: 8000 } };
      case 'SITE_GLITCH_BUY': return world.buyReplies.length ? world.buyReplies.shift() : { ok: true, data: { wallet: {} } };
      default: return { ok: false, error: 'unexpected ' + message.type };
    }
  };
  const announced = [];
  const service = createGlitchService({
    storage, site, activity: async text => activities.push(text), sleep: async () => {},
    getTab: async () => world.tab,
    loadNames: async () => new Map([['bitflip', 'Function Error'], ['glitch', 'Glitch Potion']]),
    announce: async (event, info) => { announced.push({ event, ...info }); },
  });
  return { service, data, writes, world, activities, badge, alarms, announced, ask: message => service.handle(message) };
}
const types = world => world.sent.map(message => message.type);

test('status reports a missing game tab without error', async () => {
  const h = harness({ world: { tab: null } });
  assert.deepEqual(await h.ask({ type: 'GLITCH_STATUS' }), { ok: true, tab: { open: false, signedIn: false }, shop: null });
});

test('status returns the trimmed shelf with the wallet from the inventory when the shelf has none', async () => {
  const h = harness();
  delete h.world.shop.wallet;
  const status = await h.ask({ type: 'GLITCH_STATUS' });
  assert.equal(status.ok, true);
  assert.equal(status.shop.open, true);
  assert.equal(status.shop.wallet.effective, 42);
  assert.deepEqual(status.shop.items.map(item => item.id), ['bitflip', 'glitch', 'overflow']);
  assert.ok(!('perPlayer' in status.shop.items[0]), 'unneeded fields are dropped');
});

test('a trial only starts when the game button would be enabled', async () => {
  for (const [name, mutate, reason] of [
    ['Glitch away', w => { w.shop.open = false; }, 'away'],
    ['already bought', w => { w.shop.items[0].bought = 1; }, 'bought'],
    ['sold out', w => { w.shop.items[0].left = 0; }, 'sold'],
    ['too poor', w => { w.shop.wallet.effective = 1; }, 'poor'],
  ]) {
    const h = harness();
    mutate(h.world);
    const reply = await h.ask({ type: 'GLITCH_TRIAL_START', item: 'bitflip' });
    assert.equal(reply.ok, false, name);
    assert.equal(reply.reason, reason, name);
    assert.ok(!types(h.world).includes('SITE_GLITCH_TRIAL'), `${name}: no trial is requested`);
  }
  const off = harness();
  assert.equal((await off.ask({ type: 'GLITCH_TRIAL_START', item: 'nothing' })).reason, 'invalid');
});

test('a trial never starts for a signed-out player, a different account or bad input', async () => {
  const out = harness({ world: { tab: { id: 1, identity: { user: null } } } });
  assert.match((await out.ask({ type: 'GLITCH_TRIAL_START', item: 'bitflip' })).error, /Sign in/);
  const other = harness({ storage: { boundAccount: 'account-2' } });
  assert.match((await other.ask({ type: 'GLITCH_TRIAL_START', item: 'bitflip' })).error, /different account/);
  const bad = harness();
  assert.equal((await bad.ask({ type: 'GLITCH_TRIAL_START', item: '../x' })).ok, false);
  assert.equal(await bad.ask({ type: 'GLITCH_TRIAL_START' }).then(r => r.ok), false);
  for (const h of [out, other, bad]) assert.ok(!types(h.world).includes('SITE_GLITCH_TRIAL'));
});

test('starting a trial returns the question for the player to answer', async () => {
  const h = harness();
  const reply = await h.ask({ type: 'GLITCH_TRIAL_START', item: 'bitflip' });
  assert.deepEqual(reply, { ok: true, kind: 'question', price: 300_000_000, question: h.world.trial });
  assert.deepEqual(h.world.sent.find(m => m.type === 'SITE_GLITCH_TRIAL'), { type: 'SITE_GLITCH_TRIAL', item: 'bitflip' });
});

test('a busy game and unreadable questions are reported, not guessed at', async () => {
  const busy = harness({ world: { trialReply: () => ({ ok: false, status: 429, error: 'Slow down.' }) } });
  const reply = await busy.ask({ type: 'GLITCH_TRIAL_START', item: 'bitflip' });
  assert.deepEqual([reply.ok, reply.status, reply.rest, reply.error], [false, 429, 3000, 'Slow down.']);
  const odd = harness({ world: { trial: { id: 'x', prompt: 'no timing info' } } });
  assert.match((await odd.ask({ type: 'GLITCH_TRIAL_START', item: 'bitflip' })).error, /does not understand/);
});

test('a wrong or late answer ends the trial and shows the rest period', async () => {
  const h = harness();
  h.world.answers.push({ ok: true, data: { ok: false, late: true, answer: 'b', rest: 6000 } });
  const reply = await h.ask({ type: 'GLITCH_TRIAL_ANSWER', item: 'bitflip', id: 'q-1', answer: 'a' });
  assert.deepEqual(reply, { ok: true, kind: 'failed', late: true, answer: 'b', rest: 6000 });
  assert.ok(!types(h.world).includes('SITE_GLITCH_BUY'));
});

test('a right answer moves on to the next question', async () => {
  const h = harness();
  h.world.answers.push({ ok: true, data: { ok: true, id: 'q-2', step: 1, steps: 2, prompt: 'Second?', ms: 5000 } });
  const reply = await h.ask({ type: 'GLITCH_TRIAL_ANSWER', item: 'bitflip', id: 'q-1', answer: 'a' });
  assert.equal(reply.kind, 'question');
  assert.equal(reply.question.step, 1);
  assert.deepEqual(h.world.sent.find(m => m.type === 'SITE_GLITCH_ANSWER'), { type: 'SITE_GLITCH_ANSWER', id: 'q-1', answer: 'a' });
});

test('passing the trial buys the ware once, with the trial id and a stable request id', async () => {
  const h = harness();
  h.world.answers.push({ ok: true, data: { ok: true, passed: true, id: 'pass-9' } });
  const reply = await h.ask({ type: 'GLITCH_TRIAL_ANSWER', item: 'bitflip', id: 'q-2', answer: 'c' });
  assert.deepEqual(reply, { ok: true, kind: 'bought', item: 'bitflip' });
  const buys = h.world.sent.filter(m => m.type === 'SITE_GLITCH_BUY');
  assert.equal(buys.length, 1);
  assert.equal(buys[0].accountId, 'account-1');
  assert.equal(buys[0].purchase.item, 'bitflip');
  assert.equal(buys[0].purchase.trial, 'pass-9');
  assert.match(buys[0].purchase.requestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(h.activities, ['Bought Function Error from Glitch.']);
});

test('a lost purchase reply is retried with the same request id and never charges twice', async () => {
  const h = harness();
  h.world.answers.push({ ok: true, data: { ok: true, passed: true, id: 'pass-1' } });
  h.world.buyReplies.push({ ok: false, error: 'network' }, { ok: false, error: 'network' }, { ok: true, data: {} });
  const reply = await h.ask({ type: 'GLITCH_TRIAL_ANSWER', item: 'glitch', id: 'q', answer: 'x' });
  assert.equal(reply.kind, 'bought');
  const ids = h.world.sent.filter(m => m.type === 'SITE_GLITCH_BUY').map(m => m.purchase.requestId);
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 1, 'every retry reuses one request id');
});

test('a declined purchase is not retried; an unknown result is flagged for the player to check', async () => {
  const declined = harness();
  declined.world.answers.push({ ok: true, data: { ok: true, passed: true, id: 'p' } });
  declined.world.buyReplies.push({ ok: false, status: 402, error: 'Not enough EP.' });
  const d = await declined.ask({ type: 'GLITCH_TRIAL_ANSWER', item: 'glitch', id: 'q', answer: 'x' });
  assert.deepEqual([d.kind, d.error], ['declined', 'Not enough EP.']);
  assert.equal(declined.world.sent.filter(m => m.type === 'SITE_GLITCH_BUY').length, 1);

  const unknown = harness();
  unknown.world.answers.push({ ok: true, data: { ok: true, passed: true, id: 'p' } });
  unknown.world.buyReplies.push({ ok: false, error: 'net' }, { ok: false, error: 'net' }, { ok: false, error: 'net' });
  const u = await unknown.ask({ type: 'GLITCH_TRIAL_ANSWER', item: 'glitch', id: 'q', answer: 'x' });
  assert.equal(u.kind, 'uncertain');
  assert.match(u.error, /inventory/);
  assert.equal(unknown.world.sent.filter(m => m.type === 'SITE_GLITCH_BUY').length, 3);
  assert.match(unknown.activities.at(-1), /Check your inventory/);
});

test('an unreadable reply to an answer never turns into a purchase', async () => {
  const h = harness();
  h.world.answers.push({ ok: true, data: { ok: true, mystery: true } });
  const reply = await h.ask({ type: 'GLITCH_TRIAL_ANSWER', item: 'glitch', id: 'q', answer: 'x' });
  assert.equal(reply.ok, false);
  assert.ok(!types(h.world).includes('SITE_GLITCH_BUY'));
});

test('answers are refused for another account, signed-out players and bad input', async () => {
  const other = harness({ storage: { boundAccount: 'account-2' } });
  assert.equal((await other.ask({ type: 'GLITCH_TRIAL_ANSWER', item: 'glitch', id: 'q', answer: 'x' })).ok, false);
  const bad = harness();
  for (const message of [{ item: 'glitch', id: '', answer: 'x' }, { item: 'glitch', id: 'q', answer: {} }, { item: 'x y', id: 'q', answer: 'x' }]) {
    assert.equal((await bad.ask({ type: 'GLITCH_TRIAL_ANSWER', ...message })).ok, false);
  }
  assert.ok(!types(other.world).includes('SITE_GLITCH_ANSWER') && !types(bad.world).includes('SITE_GLITCH_ANSWER'));
});

test('the watcher alerts once per visit, only for wares the player wants, and clears when he leaves', async () => {
  const h = harness({ storage: { glitchPrefs: { alert: true, itemIds: ['glitch'] } } });
  await h.service.watch();
  assert.deepEqual(h.data.glitchAlert.ids, ['glitch']);
  assert.equal(h.data.glitchAlert.key, '99000');
  assert.deepEqual(h.badge, ['!']);
  const first = h.data.glitchAlert.at;
  const before = h.writes.length;
  await h.service.watch();
  assert.equal(h.writes.length, before, 'an unchanged visit writes nothing');
  assert.equal(h.data.glitchAlert.at, first);

  h.world.shop.open = false;
  await h.service.watch();
  assert.equal(h.data.glitchAlert, undefined);
  assert.equal(h.badge.at(-1), '');
});

test('the watcher stays quiet when alerts are off, the game tab is closed or the player is signed out', async () => {
  const off = harness({ storage: { glitchPrefs: { alert: false, itemIds: [] } } });
  await off.service.watch();
  const closed = harness({ world: { tab: null } });
  await closed.service.watch();
  const out = harness({ world: { tab: { id: 1, identity: { user: null } } } });
  await out.service.watch();
  for (const h of [off, closed, out]) assert.equal(h.data.glitchAlert, undefined);
  assert.ok(!types(off.world).includes('SITE_GLITCH'), 'alerts off means no requests at all');
});

test('buying the wanted ware clears its alert', async () => {
  const h = harness({ storage: { glitchPrefs: { alert: true, itemIds: ['glitch'] } } });
  await h.service.watch();
  assert.ok(h.data.glitchAlert);
  h.world.answers.push({ ok: true, data: { ok: true, passed: true, id: 'p' } });
  h.world.buyReplies.push({ ok: true, data: {} });
  h.world.shopReply = () => ({ ok: true, data: { ...structuredClone(h.world.shop), items: h.world.shop.items.map(i => i.id === 'glitch' ? { ...i, bought: 1, left: 0 } : i) } });
  await h.ask({ type: 'GLITCH_TRIAL_ANSWER', item: 'glitch', id: 'q', answer: 'x' });
  assert.equal(h.data.glitchAlert, undefined);
});

test('the watch alarm exists only while alerts are on', async () => {
  const h = harness({ storage: { glitchPrefs: { alert: true, itemIds: [] } } });
  await h.service.syncAlarm();
  assert.deepEqual(h.alarms.get(GLITCH_ALARM), { periodInMinutes: 0.5 });
  h.data.glitchPrefs = { alert: false, itemIds: [] };
  h.data.glitchAlert = { key: 'k', ids: ['glitch'] };
  await h.service.syncAlarm();
  assert.equal(h.alarms.has(GLITCH_ALARM), false);
  assert.equal(h.data.glitchAlert, undefined);
  assert.equal(h.badge.at(-1), '');
});

test('only Glitch messages are handled here', () => {
  const h = harness();
  assert.equal(h.service.handle({ type: 'SITE_READY' }), null);
  assert.equal(h.service.handle(undefined), null);
});

test('a visit is announced once, never again for the same visit, and never with alerts off', async () => {
  const h = harness({ storage: { glitchPrefs: { alert: true, itemIds: ['glitch', 'bitflip'] } } });
  await h.service.watch();
  assert.deepEqual(h.announced, [{
    event: 'glitch', title: 'Glitch is here', message: 'Function Error, Glitch Potion on his shelf', sound: 'alert', flash: 'Glitch is here!',
  }]);
  await h.service.watch();
  await h.ask({ type: 'GLITCH_STATUS' });
  assert.equal(h.announced.length, 1, 'the same visit is not repeated');
  h.world.shop.open = false;
  await h.service.watch();
  h.world.shop.open = true;
  await h.service.watch();
  assert.equal(h.announced.length, 1, 'an alert that comes back within the same visit stays quiet');
  h.world.shop.endsAt = 199000;
  await h.service.watch();
  assert.equal(h.announced.length, 2, 'the next visit is announced');

  const off = harness({ storage: { glitchPrefs: { alert: false, itemIds: [] } } });
  await off.service.watch();
  await off.ask({ type: 'GLITCH_STATUS' });
  assert.equal(off.announced.length, 0);
  const nothingWanted = harness({ storage: { glitchPrefs: { alert: true, itemIds: ['overflow'] } } });
  nothingWanted.world.shop.items[2].left = 0;
  await nothingWanted.service.watch();
  assert.equal(nothingWanted.announced.length, 0);
});

test('announcing is optional and a failing announcer never breaks the watch', async () => {
  const h = harness();
  const plain = createGlitchService({
    storage: { get: async () => ({ glitchPrefs: { alert: true, itemIds: [] } }), set: async () => {}, remove: async () => {} },
    site: async () => ({ ok: true, data: structuredClone(h.world.shop) }), activity: async () => {},
    getTab: async () => h.world.tab, loadNames: async () => new Map(),
  });
  await plain.watch();
  const angry = createGlitchService({
    storage: { get: async () => ({ glitchPrefs: { alert: true, itemIds: [] } }), set: async () => {}, remove: async () => {} },
    site: async () => ({ ok: true, data: structuredClone(h.world.shop) }), activity: async () => {},
    getTab: async () => h.world.tab, loadNames: async () => new Map(), announce: async () => { throw new Error('boom'); },
  });
  await angry.watch();
});

test('Glitch purchases go into the history with the price of the trial, and are not announced', async () => {
  const h = harness();
  await h.ask({ type: 'GLITCH_TRIAL_START', item: 'bitflip' });
  h.world.answers.push({ ok: true, data: { ok: true, passed: true, id: 'p' } });
  await h.ask({ type: 'GLITCH_TRIAL_ANSWER', item: 'bitflip', id: 'q', answer: 'x', price: 1 });
  assert.equal(h.data.history.length, 1);
  const [entry] = h.data.history;
  assert.equal(typeof entry.id, 'string');
  assert.ok(entry.time > 0);
  assert.deepEqual({ ...entry, id: undefined, time: undefined }, {
    id: undefined, time: undefined, source: 'glitch', result: 'bought', item: 'bitflip', name: 'Function Error', qty: 1,
    price: 300_000_000, total: 300_000_000,
  }, 'the price seen when the trial started wins over the menu');
  assert.deepEqual(h.activities, ['Bought Function Error from Glitch.'], 'the activity log is unchanged');
  assert.ok(!h.announced.some(item => item.event === 'purchase'), 'a manual purchase is not announced');

  const fromMenu = harness();
  fromMenu.world.answers.push({ ok: true, data: { ok: true, passed: true, id: 'p' } });
  await fromMenu.ask({ type: 'GLITCH_TRIAL_ANSWER', item: 'glitch', id: 'q', answer: 'x', price: 23_000_000_000 });
  assert.equal(fromMenu.data.history[0].price, 23_000_000_000, 'the menu can supply the price');

  const unknown = harness();
  unknown.world.answers.push({ ok: true, data: { ok: true, passed: true, id: 'p' } });
  unknown.world.buyReplies.push({ ok: false, error: 'net' }, { ok: false, error: 'net' }, { ok: false, error: 'net' });
  await unknown.ask({ type: 'GLITCH_TRIAL_ANSWER', item: 'glitch', id: 'q', answer: 'x', price: 'free' });
  assert.deepEqual([unknown.data.history[0].result, unknown.data.history[0].price, unknown.data.history[0].total], ['uncertain', null, null]);
  assert.match(unknown.data.history[0].message, /Check your inventory/);

  const declined = harness();
  await declined.ask({ type: 'GLITCH_TRIAL_START', item: 'glitch' });
  declined.world.answers.push({ ok: true, data: { ok: true, passed: true, id: 'p' } });
  declined.world.buyReplies.push({ ok: false, status: 402, error: 'Not enough EP.' });
  await declined.ask({ type: 'GLITCH_TRIAL_ANSWER', item: 'glitch', id: 'q', answer: 'x' });
  assert.equal(declined.data.history[0].result, 'declined');
  assert.equal(declined.data.history[0].price, 23_000_000_000);
  assert.match(declined.data.history[0].message, /Not enough EP/);

  const failed = harness();
  await failed.ask({ type: 'GLITCH_TRIAL_ANSWER', item: 'bitflip', id: 'q', answer: 'x' });
  assert.equal(failed.data.history, undefined, 'a failed trial buys nothing and records nothing');
});

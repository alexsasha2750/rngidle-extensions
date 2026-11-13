import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdateService } from '../update-service.js';
import { CHECK_EVERY, DOWNLOAD_PREFIX, RELEASES_URL, RETRY_AFTER, STATE_KEY, manifestUrl } from '../update.js';

const T0 = Date.UTC(2026, 10, 13, 12);
const zip = tag => ({ name: `RNGidle-Shop-Helper-${tag}.zip`, size: 142317, browser_download_url: `${DOWNLOAD_PREFIX}${tag}/RNGidle-Shop-Helper-${tag}.zip` });
const release = (tag, over = {}) => ({
  tag_name: tag, name: `RNGidle Shop Helper ${tag}`, draft: false, prerelease: false, published_at: '2026-11-13T09:45:14Z',
  html_url: `https://github.com/alexsasha2750/rngidle-helper/releases/tag/${tag}`, body: `# RNGidle Shop Helper ${tag}\n\nWhat changed in ${tag}.`,
  assets: [zip(tag)], ...over,
});
const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

// A scripted GitHub plus a fake extension: storage, downloads and the clock.
function harness(over = {}) {
  const data = { ...over.storage };
  const writes = [];
  const storage = {
    get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter(key => key in data).map(key => [key, structuredClone(data[key])])),
    set: async values => { writes.push(structuredClone(values)); Object.assign(data, structuredClone(values)); },
    remove: async key => { delete data[key]; },
  };
  const world = {
    releases: [release('v1.5-beta', { prerelease: true }), release('v1.4.2')],
    manifests: { 'v1.5-beta': { version: '1.5.0', version_name: 'v1.5-beta' }, 'v1.4.2': { version: '1.4.2', version_name: 'v1.4.2' } },
    releasesReply: null,
    manifestReply: null,
    requests: [],
    gate: null,
    ...over.world,
  };
  const fetchImpl = async (url, init) => {
    world.requests.push({ url, init });
    if (world.gate) await world.gate;
    if (url === RELEASES_URL) return world.releasesReply ? world.releasesReply() : json(world.releases);
    const tag = Object.keys(world.manifests).find(name => manifestUrl(name) === url);
    if (world.manifestReply) return world.manifestReply(url, tag);
    return tag ? json(world.manifests[tag]) : new Response('404: Not Found', { status: 404 });
  };
  const downloads = { started: [], shown: [], listeners: [], items: new Map(), nextId: 41, fail: false };
  const chrome = {
    runtime: { getManifest: () => ({ version: over.version ?? '1.4.0', version_name: 'v1.4-beta' }) },
    downloads: {
      download: async options => {
        if (downloads.fail) throw new Error('Invalid URL');
        downloads.started.push(options);
        const id = downloads.nextId++;
        downloads.items.set(id, { id, state: 'in_progress', exists: true });
        return id;
      },
      show: id => downloads.shown.push(id),
      search: async ({ id }) => (downloads.items.has(id) ? [downloads.items.get(id)] : []),
      onChanged: { addListener: listener => downloads.listeners.push(listener) },
    },
  };
  const clock = { now: over.now ?? T0 };
  const service = createUpdateService({ storage, chrome, getTab: async () => null, site: async () => ({ ok: false }), fetchImpl, now: () => clock.now });
  const fire = delta => { for (const listener of downloads.listeners) listener(delta); };
  const settle = () => new Promise(resolve => setTimeout(resolve, 5));
  return { service, data, writes, world, downloads, clock, fire, settle, ask: message => service.handle(message), state: () => data[STATE_KEY] };
}
const apiCalls = world => world.requests.filter(request => request.url === RELEASES_URL).length;

test('other messages are left to other handlers', () => {
  const h = harness();
  for (const message of [{ type: 'GLITCH_STATUS' }, { type: 'toString' }, { type: 'constructor' }, null, undefined, 'UPDATE_CHECK', {}]) {
    assert.equal(h.ask(message), null, JSON.stringify(message));
  }
});

test('status needs no network and starts from an empty state', async () => {
  const h = harness();
  const reply = await h.ask({ type: 'UPDATE_STATUS' });
  assert.deepEqual(reply, {
    ok: true,
    state: { checkedAt: null, lastOk: null, status: 'idle', current: '1.4.0', latest: null, dismissedVersion: null, downloaded: null, error: null },
  });
  assert.equal(h.world.requests.length, 0);
  assert.equal(h.data[STATE_KEY], undefined, 'nothing is written for an empty state');
});

test('a forced check finds the highest version from the manifests at each tag', async () => {
  const h = harness();
  const reply = await h.ask({ type: 'UPDATE_CHECK', force: true });
  assert.equal(reply.ok, true);
  assert.equal(reply.state.status, 'available');
  assert.deepEqual(reply.state.latest, {
    version: '1.5.0', versionName: 'v1.5-beta', tag: 'v1.5-beta', prerelease: true,
    url: 'https://github.com/alexsasha2750/rngidle-helper/releases/tag/v1.5-beta',
    notes: 'What changed in v1.5-beta.', publishedAt: '2026-11-13T09:45:14Z',
    asset: { name: 'RNGidle-Shop-Helper-v1.5-beta.zip', size: 142317, url: `${DOWNLOAD_PREFIX}v1.5-beta/RNGidle-Shop-Helper-v1.5-beta.zip` },
  });
  assert.equal(reply.state.checkedAt, T0);
  assert.equal(reply.state.lastOk, T0);
  assert.equal(reply.state.current, '1.4.0');
  assert.deepEqual(h.state(), reply.state, 'the answer is stored for the in-game button');
  assert.deepEqual(h.world.requests.map(r => r.url), [RELEASES_URL, manifestUrl('v1.5-beta'), manifestUrl('v1.4.2')]);
  for (const { init } of h.world.requests) {
    assert.ok(init.signal, 'every request has a timeout');
    assert.equal(init.credentials, 'omit');
  }
});

test('tag names are never compared, only the declared versions', async () => {
  const h = harness({ world: {
    releases: [release('v9.9-final'), release('v1.31-beta', { prerelease: true }), release('v1.1-alpha')],
    manifests: { 'v9.9-final': { version: '1.2.0' }, 'v1.31-beta': { version: '1.3.1' }, 'v1.1-alpha': { version: '1.1.0' } },
  } });
  const { state } = await h.ask({ type: 'UPDATE_CHECK', force: true });
  assert.equal(state.status, 'uptodate', '1.3.1 is older than the running 1.4.0');
  assert.equal(state.latest.tag, 'v1.31-beta');
  assert.equal(state.latest.versionName, 'v1.3.1', 'without a version_name the version is shown');
});

test('pre-releases are left out when the player turns them off', async () => {
  const h = harness({ storage: { uiPrefs: { updates: { prereleases: false } } } });
  const { state } = await h.ask({ type: 'UPDATE_CHECK', force: true });
  assert.equal(state.status, 'available');
  assert.equal(state.latest.version, '1.4.2');
  assert.ok(!h.world.requests.some(r => r.url === manifestUrl('v1.5-beta')), 'the pre-release manifest is not even fetched');
});

test('drafts, releases without a zip and unreadable manifests are skipped; at most four are read', async () => {
  const h = harness({ world: {
    releases: [
      release('v3-draft', { draft: true }), release('v2.9-nozip', { assets: [] }), release('v2.8-broken'), release('v2.7-bad'),
      release('v1.6'), release('v1.5.1'), release('v9-too-old-to-look-at'),
    ],
    manifests: { 'v3-draft': { version: '3.0.0' }, 'v2.9-nozip': { version: '2.9.0' }, 'v2.7-bad': { version: 'v2.7' }, 'v1.6': { version: '1.6.0' }, 'v1.5.1': { version: '1.5.1' }, 'v9-too-old-to-look-at': { version: '9.0.0' } },
  } });
  const { state } = await h.ask({ type: 'UPDATE_CHECK', force: true });
  assert.equal(state.latest.version, '1.6.0');
  assert.deepEqual(h.world.requests.slice(1).map(r => r.url).sort(), ['v2.8-broken', 'v2.7-bad', 'v1.6', 'v1.5.1'].map(manifestUrl).sort());
});

test('failures are stored with a code and never thrown', async () => {
  const cases = [
    ['offline', { releasesReply: () => { throw new TypeError('Failed to fetch'); } }],
    ['offline', { releasesReply: () => { throw new DOMException('timed out', 'TimeoutError'); } }],
    ['rate_limited', { releasesReply: () => new Response('{"message":"API rate limit exceeded"}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }) }],
    ['rate_limited', { releasesReply: () => new Response('slow down', { status: 429 }) }],
    ['bad_reply', { releasesReply: () => new Response('forbidden', { status: 403, headers: { 'x-ratelimit-remaining': '42' } }) }],
    ['bad_reply', { releasesReply: () => new Response('oops', { status: 502 }) }],
    ['bad_reply', { releasesReply: () => new Response('<html>not json</html>') }],
    ['bad_reply', { releasesReply: () => json({ message: 'Not Found' }) }],
    ['no_release', { releases: [] }],
    ['no_release', { releases: [release('v2', { assets: [] })] }],
    ['no_release', { manifestReply: () => new Response('404: Not Found', { status: 404 }) }],
    ['no_release', { manifestReply: () => new Response('not json') }],
    ['offline', { manifestReply: () => { throw new TypeError('Failed to fetch'); } }],
    ['rate_limited', { manifestReply: () => new Response('', { status: 429 }) }],
  ];
  for (const [code, world] of cases) {
    const h = harness({ world, storage: { [STATE_KEY]: { status: 'uptodate', checkedAt: T0 - 9, lastOk: T0 - 9, current: '1.4.0', latest: null } } });
    const reply = await h.ask({ type: 'UPDATE_CHECK', force: true });
    assert.equal(reply.ok, false, code);
    assert.equal(reply.error, code, JSON.stringify(Object.keys(world)));
    assert.equal(reply.state.status, 'error');
    assert.deepEqual(h.state().error, { code });
    assert.equal(h.state().checkedAt, T0);
    assert.equal(h.state().lastOk, T0 - 9, 'the last success is kept');
  }
});

test('a failed check keeps the release that was found before', async () => {
  const h = harness();
  await h.ask({ type: 'UPDATE_CHECK', force: true });
  h.world.releasesReply = () => { throw new TypeError('offline'); };
  h.clock.now += 1000;
  const reply = await h.ask({ type: 'UPDATE_CHECK', force: true });
  assert.equal(reply.state.status, 'error');
  assert.equal(reply.state.latest.version, '1.5.0');
  assert.equal(reply.state.lastOk, T0);
});

test('the automatic check runs on a game tab at most every 6 hours', async () => {
  const h = harness();
  await h.service.onSiteReady();
  assert.equal(apiCalls(h.world), 1, 'first game tab checks');
  await h.service.onSiteReady();
  h.clock.now = T0 + CHECK_EVERY - 1;
  await h.service.onSiteReady();
  assert.equal(apiCalls(h.world), 1, 'not again within 6 hours');
  h.clock.now = T0 + CHECK_EVERY;
  await h.service.onSiteReady();
  assert.equal(apiCalls(h.world), 2, 'again after 6 hours');
});

test('after a failed automatic check it waits 30 minutes', async () => {
  const h = harness({ world: { releasesReply: () => { throw new TypeError('offline'); } } });
  await h.service.onSiteReady();
  assert.equal(h.state().error.code, 'offline');
  h.clock.now = T0 + RETRY_AFTER - 1;
  await h.service.onSiteReady();
  assert.equal(apiCalls(h.world), 1);
  h.world.releasesReply = null;
  h.clock.now = T0 + RETRY_AFTER;
  await h.service.onSiteReady();
  assert.equal(apiCalls(h.world), 2);
  assert.equal(h.state().status, 'available');
});

test('turning automatic checks off stops them, but a click still checks', async () => {
  const h = harness({ storage: { uiPrefs: { updates: { auto: false } } } });
  await h.service.onSiteReady();
  const quiet = await h.ask({ type: 'UPDATE_CHECK' });
  assert.equal(quiet.ok, true);
  assert.equal(quiet.state.status, 'idle');
  assert.equal(h.world.requests.length, 0, 'no network while turned off');
  const forced = await h.ask({ type: 'UPDATE_CHECK', force: true });
  assert.equal(forced.state.status, 'available');
});

test('a forced check ignores the 6-hour wait; an unforced one does not', async () => {
  const h = harness();
  await h.ask({ type: 'UPDATE_CHECK', force: true });
  h.clock.now += 60_000;
  await h.ask({ type: 'UPDATE_CHECK' });
  assert.equal(apiCalls(h.world), 1);
  await h.ask({ type: 'UPDATE_CHECK', force: true });
  assert.equal(apiCalls(h.world), 2);
  assert.equal(h.state().checkedAt, T0 + 60_000);
});

test('two checks never run at once; everyone shares the one in flight', async () => {
  let open;
  const h = harness({ world: { gate: new Promise(resolve => { open = resolve; }) } });
  const replies = [h.service.onSiteReady(), h.service.onSiteReady(), h.ask({ type: 'UPDATE_CHECK', force: true }), h.ask({ type: 'UPDATE_CHECK', force: true }), h.ask({ type: 'UPDATE_CHECK' })];
  await h.settle();
  assert.equal(apiCalls(h.world), 1);
  open();
  const [, , first, second, third] = await Promise.all(replies);
  assert.equal(apiCalls(h.world), 1, 'still a single request');
  assert.deepEqual(first, second);
  assert.equal(third.state.status, 'available');
  await h.ask({ type: 'UPDATE_CHECK', force: true });
  assert.equal(apiCalls(h.world), 2, 'a new check can start once the last one finished');
});

test('installing the update turns the stored "available" into "up to date"', async () => {
  const stored = { status: 'available', checkedAt: T0, lastOk: T0, current: '1.4.0', latest: { version: '1.5.0', versionName: 'v1.5-beta', tag: 'v1.5-beta', prerelease: true, url: 'https://github.com/alexsasha2750/rngidle-helper/releases/tag/v1.5-beta', notes: '', publishedAt: null, asset: null } };
  const h = harness({ version: '1.5.0', storage: { [STATE_KEY]: stored } });
  await h.settle();
  assert.equal(h.state().status, 'uptodate', 'settled as soon as the worker starts');
  assert.equal(h.state().current, '1.5.0');
  const reply = await h.ask({ type: 'UPDATE_STATUS' });
  assert.equal(reply.state.status, 'uptodate');
  assert.equal(h.world.requests.length, 0);
});

test('downloading uses only the repository URL, a clean file name and no prompt', async () => {
  const h = harness();
  const refused = await h.ask({ type: 'UPDATE_DOWNLOAD' });
  assert.deepEqual([refused.ok, refused.error], [false, 'no_update'], 'nothing to download before a check');
  await h.ask({ type: 'UPDATE_CHECK', force: true });
  const reply = await h.ask({ type: 'UPDATE_DOWNLOAD' });
  assert.equal(reply.ok, true);
  assert.deepEqual(h.downloads.started, [{
    url: `${DOWNLOAD_PREFIX}v1.5-beta/RNGidle-Shop-Helper-v1.5-beta.zip`, filename: 'RNGidle-Shop-Helper-v1.5-beta.zip', saveAs: false, conflictAction: 'uniquify',
  }]);
  assert.deepEqual(reply.state.downloaded, { version: '1.5.0', state: 'in_progress', id: 41 });
  assert.deepEqual(h.state().downloaded, reply.state.downloaded);
  const again = await h.ask({ type: 'UPDATE_DOWNLOAD' });
  assert.equal(again.ok, true);
  assert.equal(h.downloads.started.length, 1, 'a download in progress is not started twice');
});

test('download progress from Chrome is stored; other downloads are ignored', async () => {
  const h = harness();
  await h.ask({ type: 'UPDATE_CHECK', force: true });
  await h.ask({ type: 'UPDATE_DOWNLOAD' });
  assert.equal(h.downloads.listeners.length, 1, 'one listener, registered when the worker starts');
  h.fire({ id: 999, state: { current: 'complete', previous: 'in_progress' } });
  h.fire({ id: 41, filename: { current: '/x' } });
  await h.settle();
  assert.equal(h.state().downloaded.state, 'in_progress');
  h.fire({ id: 41, state: { current: 'interrupted', previous: 'in_progress' } });
  await h.settle();
  assert.equal(h.state().downloaded.state, 'interrupted');
  const retry = await h.ask({ type: 'UPDATE_DOWNLOAD' });
  assert.equal(retry.state.downloaded.id, 42, 'an interrupted download can be tried again');
  h.fire({ id: 42, state: { current: 'complete', previous: 'in_progress' } });
  await h.settle();
  assert.deepEqual(h.state().downloaded, { version: '1.5.0', state: 'complete', id: 42 });
  assert.equal(h.downloads.listeners.length, 1);
});

test('a download that finished while the worker slept is caught up on status', async () => {
  const h = harness();
  await h.ask({ type: 'UPDATE_CHECK', force: true });
  await h.ask({ type: 'UPDATE_DOWNLOAD' });
  h.downloads.items.get(41).state = 'complete';
  const reply = await h.ask({ type: 'UPDATE_STATUS' });
  assert.equal(reply.state.downloaded.state, 'complete');
  h.downloads.items.clear();
  h.data[STATE_KEY].downloaded.state = 'in_progress';
  assert.equal((await h.ask({ type: 'UPDATE_STATUS' })).state.downloaded.state, 'interrupted', 'a download Chrome forgot counts as stopped');
});

test('a tampered or foreign download URL is refused', async () => {
  for (const url of [
    'https://evil.example/RNGidle-Shop-Helper.zip',
    'https://github.com/someone/rngidle-helper/releases/download/v1/a.zip',
    `${DOWNLOAD_PREFIX}../../../../evil/a.zip`,
  ]) {
    const h = harness({ world: { releases: [release('v1.5-beta', { assets: [{ name: 'RNGidle-Shop-Helper.zip', size: 1, browser_download_url: url }] })] } });
    const { state } = await h.ask({ type: 'UPDATE_CHECK', force: true });
    assert.equal(state.status, 'available');
    assert.equal(state.latest.asset, null, 'offered without a download');
    // Even a value written straight into storage is not downloaded.
    h.data[STATE_KEY].latest.asset = { name: 'x.zip', size: 1, url };
    const reply = await h.ask({ type: 'UPDATE_DOWNLOAD' });
    assert.deepEqual([reply.ok, reply.error], [false, 'bad_url'], url);
    assert.equal(h.downloads.started.length, 0);
  }
});

test('a download Chrome refuses is reported, not stored', async () => {
  const h = harness();
  await h.ask({ type: 'UPDATE_CHECK', force: true });
  h.downloads.fail = true;
  const reply = await h.ask({ type: 'UPDATE_DOWNLOAD' });
  assert.deepEqual([reply.ok, reply.error], [false, 'download_failed']);
  assert.equal(h.state().downloaded, null);
});

test('show opens the stored download, if Chrome still has it', async () => {
  const h = harness();
  assert.equal((await h.ask({ type: 'UPDATE_SHOW' })).error, 'no_download');
  await h.ask({ type: 'UPDATE_CHECK', force: true });
  await h.ask({ type: 'UPDATE_DOWNLOAD' });
  const reply = await h.ask({ type: 'UPDATE_SHOW' });
  assert.equal(reply.ok, true);
  assert.deepEqual(h.downloads.shown, [41]);
  h.downloads.items.get(41).exists = false;
  assert.equal((await h.ask({ type: 'UPDATE_SHOW' })).error, 'no_download', 'a deleted file is reported');
  assert.deepEqual(h.downloads.shown, [41]);
});

test('"Not now" puts off this version only', async () => {
  const h = harness();
  assert.equal((await h.ask({ type: 'UPDATE_DISMISS' })).error, 'no_update');
  await h.ask({ type: 'UPDATE_CHECK', force: true });
  const reply = await h.ask({ type: 'UPDATE_DISMISS' });
  assert.equal(reply.ok, true);
  assert.equal(h.state().dismissedVersion, '1.5.0');
  await h.ask({ type: 'UPDATE_CHECK', force: true });
  assert.equal(h.state().dismissedVersion, '1.5.0', 'a later check of the same version keeps it put off');
  h.world.releases.unshift(release('v1.6'));
  h.world.manifests['v1.6'] = { version: '1.6.0' };
  await h.ask({ type: 'UPDATE_CHECK', force: true });
  assert.equal(h.state().latest.version, '1.6.0');
  assert.notEqual(h.state().dismissedVersion, h.state().latest.version, 'a newer version is news again');
});

test('a broken storage never escapes as an exception', async () => {
  const h = harness();
  const broken = createUpdateService({
    storage: { get: async () => { throw new Error('quota'); }, set: async () => { throw new Error('quota'); } },
    chrome: { runtime: { getManifest: () => ({ version: '1.4.0' }) } },
    getTab: async () => null, site: async () => null, fetchImpl: async () => { throw new Error('no'); }, now: () => T0,
  });
  for (const type of ['UPDATE_CHECK', 'UPDATE_STATUS', 'UPDATE_DOWNLOAD', 'UPDATE_SHOW', 'UPDATE_DISMISS']) {
    const reply = await broken.handle({ type, force: true });
    assert.equal(reply.ok, false, type);
  }
  await broken.onSiteReady();
  assert.ok(h);
});

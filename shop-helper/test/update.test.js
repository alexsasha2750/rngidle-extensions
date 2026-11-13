import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CHECK_EVERY, DOWNLOAD_PREFIX, MAX_CANDIDATES, NOTES_MAX, RETRY_AFTER,
  applyCheckResult, compareVersions, defaultState, hasAttention, httpErrorCode, isDownloadUrl, isReleasePageUrl,
  isReleaseVersion, isSafeTag, manifestUrl, normalizeState, parseVersion, pickAsset, pickNewest, releaseInfo,
  releasePageUrl, safeFileName, selectCandidates, shouldAutoCheck, trimNotes,
} from '../update.js';
import { normalizeUiPrefs } from '../ui-prefs.js';

const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const zip = (tag, name = `RNGidle-Shop-Helper-${tag}.zip`) => ({ name, size: 1234, browser_download_url: `${DOWNLOAD_PREFIX}${tag}/${name}` });
const release = (tag, over = {}) => ({ tag_name: tag, name: `RNGidle Shop Helper ${tag}`, draft: false, prerelease: false, html_url: `https://github.com/alexsasha2750/rngidle-helper/releases/tag/${tag}`, body: 'Notes', published_at: '2026-11-13T09:45:14Z', assets: [zip(tag)], ...over });
const latest = (version, over = {}) => ({ version, versionName: `v${version}`, tag: `v${version}`, prerelease: false, url: releasePageUrl(`v${version}`), notes: '', publishedAt: null, asset: { name: 'a.zip', size: 10, url: `${DOWNLOAD_PREFIX}v${version}/a.zip` }, ...over });

test('versions compare as numbers, part by part', () => {
  assert.deepEqual(parseVersion('1.4.0'), [1, 4, 0]);
  assert.deepEqual(parseVersion(' 1.2 '), [1, 2]);
  assert.equal(parseVersion('v1.4.0'), null);
  assert.equal(parseVersion('1.4.0-beta'), null);
  assert.equal(parseVersion('1.2.3.4.5'), null);
  assert.equal(parseVersion(140), null);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1, 'not a text comparison');
  assert.equal(compareVersions('1.3.1', '1.4.0'), -1, 'v1.31-beta (1.3.1) is older than 1.4.0');
  assert.equal(compareVersions('1.4.0', '1.4.0'), 0);
  assert.equal(compareVersions('1.4', '1.4.0'), 0, 'missing parts count as zero');
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(compareVersions('nonsense', '0.0.1'), -1, 'an unreadable version sorts lowest');
});

test('a release must declare a plain three-part version', () => {
  assert.equal(isReleaseVersion('1.3.1'), true);
  for (const bad of ['1.3', '1.3.1.0', 'v1.3.1', '1.3.1 ', '', null, 131]) assert.equal(isReleaseVersion(bad), false, String(bad));
});

test('only release files of this repository can be downloaded', () => {
  assert.equal(isDownloadUrl('https://github.com/alexsasha2750/rngidle-helper/releases/download/v1.31-beta/RNGidle-Shop-Helper-v1.31-beta.zip'), true);
  for (const bad of [
    'http://github.com/alexsasha2750/rngidle-helper/releases/download/v1/a.zip',
    'https://github.com/someone-else/rngidle-helper/releases/download/v1/a.zip',
    'https://github.com/alexsasha2750/rngidle-helper-evil/releases/download/v1/a.zip',
    'https://evil.example/alexsasha2750/rngidle-helper/releases/download/v1/a.zip',
    'https://github.com.evil.example/alexsasha2750/rngidle-helper/releases/download/v1/a.zip',
    'https://github.com/alexsasha2750/rngidle-helper/releases/download/../../../evil/a.zip',
    'https://github.com/alexsasha2750/rngidle-helper/releases/download/%2e%2e/%2e%2e/x/a.zip',
    'https://github.com/alexsasha2750/rngidle-helper/releases/download/v1/a.exe',
    'https://github.com/alexsasha2750/rngidle-helper/releases/download/v1/deeper/a.zip',
    'https://github.com/alexsasha2750/rngidle-helper/releases/download/v1/a.zip?x=1',
    'https://github.com/alexsasha2750/rngidle-helper/releases/download/v1\\a.zip',
    'https://github.com/alexsasha2750/rngidle-helper/releases/download/v1/a b.zip',
    'https://github.com:8443/alexsasha2750/rngidle-helper/releases/download/v1/a.zip',
    'javascript:alert(1)', '', null, 42,
  ]) assert.equal(isDownloadUrl(bad), false, String(bad));
});

test('release pages, tags and manifest URLs stay inside the repository', () => {
  assert.equal(isReleasePageUrl('https://github.com/alexsasha2750/rngidle-helper/releases/tag/v1.31-beta'), true);
  assert.equal(isReleasePageUrl('https://github.com/alexsasha2750/other/releases/tag/v1'), false);
  assert.equal(isReleasePageUrl('https://github.com/alexsasha2750/rngidle-helper/releases/../../../x'), false);
  assert.equal(isReleasePageUrl('chrome://extensions'), false);
  assert.equal(isSafeTag('v1.31-beta'), true);
  assert.equal(isSafeTag('Pre-release'), true);
  for (const bad of ['', '../x', 'a/../b', 'v1 beta', 'v1?x', 'x'.repeat(101), null]) assert.equal(isSafeTag(bad), false, String(bad));
  assert.equal(manifestUrl('v1.31-beta'), 'https://raw.githubusercontent.com/alexsasha2750/rngidle-helper/v1.31-beta/shop-helper/manifest.json');
  assert.equal(releasePageUrl('v1.1-alpha'), 'https://github.com/alexsasha2750/rngidle-helper/releases/tag/v1.1-alpha');
});

test('download file names are flattened and kept as .zip', () => {
  assert.equal(safeFileName('RNGidle-Shop-Helper-v1.31-beta.zip'), 'RNGidle-Shop-Helper-v1.31-beta.zip');
  assert.equal(safeFileName('../../etc/passwd'), 'etc-passwd.zip');
  assert.equal(safeFileName('a b/c\\d.zip'), 'a-b-c-d.zip');
  assert.equal(safeFileName('..'), 'RNGidle-Shop-Helper-update.zip');
  assert.equal(safeFileName(''), 'RNGidle-Shop-Helper-update.zip');
  assert.equal(safeFileName(null), 'RNGidle-Shop-Helper-update.zip');
  const long = safeFileName(`${'x'.repeat(300)}.zip`);
  assert.ok(long.length <= 120 && long.endsWith('.zip'));
});

test('the Shop Helper zip is preferred, and only a repository download URL is kept', () => {
  assert.equal(pickAsset([]), null);
  assert.equal(pickAsset([{ name: 'notes.txt' }]), null);
  const assets = [zip('v2', 'Other-Thing.zip'), zip('v2', 'RNGidle-Shop-Helper-v2.zip'), { name: 'checksums.txt' }];
  assert.equal(pickAsset(assets).name, 'RNGidle-Shop-Helper-v2.zip');
  assert.equal(pickAsset([zip('v2', 'Other-Thing.zip')]).name, 'Other-Thing.zip', 'any zip when none is named for Shop Helper');
  const foreign = pickAsset([{ name: 'RNGidle-Shop-Helper.zip', size: 5, browser_download_url: 'https://evil.example/x.zip' }]);
  assert.deepEqual(foreign, { name: 'RNGidle-Shop-Helper.zip', size: 5, url: null });
});

test('candidates skip drafts, honour the pre-release setting and stop at four', () => {
  const list = [
    release('v9-draft', { draft: true }),
    release('v8-pre', { prerelease: true }),
    release('v7-nozip', { assets: [{ name: 'source.tar.gz' }] }),
    release('v6'), release('v5'), release('v4'), release('v3'), release('v2'),
    release('../bad'),
  ];
  assert.deepEqual(selectCandidates(list).map(r => r.tag_name), ['v8-pre', 'v6', 'v5', 'v4']);
  assert.equal(selectCandidates(list).length, MAX_CANDIDATES);
  assert.deepEqual(selectCandidates(list, { prereleases: false }).map(r => r.tag_name), ['v6', 'v5', 'v4', 'v3']);
  assert.deepEqual(selectCandidates(null), []);
  assert.deepEqual(selectCandidates([null, 7, 'x']), []);
});

test('release notes become short plain text', () => {
  const notes = trimNotes([
    '# RNGidle Shop Helper v1.31-beta',
    '',
    'A **beta** with [Glitch’s shop](https://example.com) and `code` and ~~old~~ _italic_ text.',
    '',
    '## What’s new',
    '',
    '- First thing',
    '* Second thing',
    '  - [x] Nested done',
    '> Quoted line',
    '![screenshot](https://example.com/a.png)',
    '<details><summary>More</summary>Hidden &amp; shown</details>',
    '<!-- a comment -->',
    '```',
    '# not a heading',
    '```',
    '---',
    '| A | B |',
    '|---|---|',
    '| 1 | 2 |',
    'keep snake_case_words',
  ].join('\r\n'), { drop: ['v1.31-beta'] });
  assert.equal(notes, [
    'A beta with Glitch’s shop and code and old italic text.',
    '',
    'What’s new',
    '',
    '• First thing',
    '• Second thing',
    '• Nested done',
    'Quoted line',
    'screenshot',
    'MoreHidden & shown',
    '',
    '# not a heading',
    'A · B',
    '1 · 2',
    'keep snake_case_words',
  ].join('\n'));
  assert.equal(trimNotes('# Title\n\nBody', { drop: ['other'] }), 'Title\n\nBody', 'a heading is only dropped when it repeats the name');
  assert.equal(trimNotes(null), '');
  assert.equal(trimNotes(''), '');
});

test('long notes are cut at a word, with an ellipsis, within the limit', () => {
  const long = trimNotes('word '.repeat(400));
  assert.ok(long.length <= NOTES_MAX, String(long.length));
  assert.ok(long.endsWith('word…'));
  const solid = trimNotes('x'.repeat(2000), { max: 50 });
  assert.equal(solid.length, 50);
  assert.ok(solid.endsWith('…'));
});

test('a release is described from the API entry and the manifest at its tag', () => {
  const info = releaseInfo(release('v1.31-beta', { prerelease: true, body: '# RNGidle Shop Helper v1.31-beta\n\nHello' }), { version: '1.3.1', version_name: 'v1.31-beta' });
  assert.deepEqual(info, {
    version: '1.3.1', versionName: 'v1.31-beta', tag: 'v1.31-beta', prerelease: true,
    url: 'https://github.com/alexsasha2750/rngidle-helper/releases/tag/v1.31-beta',
    notes: 'Hello', publishedAt: '2026-11-13T09:45:14Z',
    asset: { name: 'RNGidle-Shop-Helper-v1.31-beta.zip', size: 1234, url: `${DOWNLOAD_PREFIX}v1.31-beta/RNGidle-Shop-Helper-v1.31-beta.zip` },
  });
  const odd = releaseInfo(release('v2', { html_url: 'https://evil.example/', published_at: 'soon', assets: [{ name: 'x.zip', browser_download_url: 'https://evil.example/x.zip' }] }), { version: '2.0.0' });
  assert.equal(odd.url, releasePageUrl('v2'), 'a foreign release page is replaced by the repository one');
  assert.equal(odd.versionName, 'v2.0.0');
  assert.equal(odd.publishedAt, null);
  assert.equal(odd.asset, null, 'a foreign download is not offered');
});

test('the highest manifest version wins, whatever the tags say', () => {
  const found = [latest('1.3.1', { tag: 'v9.9' }), latest('1.5.0', { tag: 'v1.0' }), latest('1.5.0', { tag: 'older' })];
  assert.equal(pickNewest(found, '1.4.0').latest.tag, 'v1.0', 'ties go to the newer release');
  assert.equal(pickNewest(found, '1.4.0').status, 'available');
  assert.equal(pickNewest(found, '1.5.0').status, 'uptodate');
  assert.equal(pickNewest(found, '2.0.0').status, 'uptodate');
  assert.equal(pickNewest([], '1.4.0'), null);
});

test('HTTP failures map to error codes', () => {
  assert.equal(httpErrorCode(403, '0'), 'rate_limited');
  assert.equal(httpErrorCode(429, null), 'rate_limited');
  assert.equal(httpErrorCode(403, '12'), 'bad_reply');
  assert.equal(httpErrorCode(500, null), 'bad_reply');
  assert.equal(httpErrorCode(404, null), 'bad_reply');
});

test('a stored state is always well formed', () => {
  assert.deepEqual(normalizeState(undefined, '1.4.0'), defaultState('1.4.0'));
  assert.deepEqual(normalizeState('junk'), defaultState(null));
  const odd = normalizeState({ status: 'available', latest: { version: 'x' }, error: { code: 'weird' }, checkedAt: -5, dismissedVersion: 'v1' }, '1.4.0');
  assert.equal(odd.status, 'idle', 'available needs a release');
  assert.equal(odd.latest, null);
  assert.equal(odd.checkedAt, null);
  assert.equal(odd.dismissedVersion, null);
  const failed = normalizeState({ status: 'error', error: { code: 'nope' } });
  assert.deepEqual(failed.error, { code: 'bad_reply' });
  const tampered = normalizeState({ status: 'available', current: '1.4.0', latest: latest('1.5.0', { url: 'https://evil.example/', asset: { name: 'a.zip', size: 1, url: 'https://evil.example/a.zip' } }) }, '1.4.0');
  assert.equal(tampered.latest.url, releasePageUrl('v1.5.0'));
  assert.equal(tampered.latest.asset, null, 'a stored foreign download is dropped');
});

test('the stored verdict follows the running version after an update', () => {
  const stored = { status: 'available', current: '1.4.0', latest: latest('1.5.0'), downloaded: { version: '1.5.0', state: 'complete', id: 3 } };
  const after = normalizeState(stored, '1.5.0');
  assert.equal(after.status, 'uptodate');
  assert.equal(after.current, '1.5.0');
  assert.equal(after.downloaded, null, 'the finished download is no longer news');
  assert.equal(normalizeState(stored, '1.4.0').status, 'available');
  assert.deepEqual(normalizeState(stored, '1.4.0').downloaded, { version: '1.5.0', state: 'complete', id: 3 });
  assert.equal(normalizeState({ ...stored, status: 'uptodate', current: '1.6.0' }, '1.4.0').status, 'available', 'going back to an older build');
});

test('a check result updates the state; a failure keeps what was known', () => {
  const prev = { ...defaultState('1.4.0'), status: 'available', checkedAt: 1, lastOk: 1, latest: latest('1.5.0'), dismissedVersion: '1.5.0', downloaded: { version: '1.5.0', state: 'complete', id: 9 } };
  const failed = applyCheckResult(prev, { ok: false, code: 'offline' }, 500, '1.4.0');
  assert.equal(failed.status, 'error');
  assert.deepEqual(failed.error, { code: 'offline' });
  assert.equal(failed.checkedAt, 500);
  assert.equal(failed.lastOk, 1, 'only a success moves lastOk');
  assert.equal(failed.latest.version, '1.5.0');
  const same = applyCheckResult(prev, { ok: true, status: 'available', latest: latest('1.5.0') }, 600, '1.4.0');
  assert.equal(same.dismissedVersion, '1.5.0', 'putting off a version sticks');
  assert.equal(same.downloaded.id, 9, 'the download of the same version is kept');
  assert.equal(same.error, null);
  assert.equal(same.lastOk, 600);
  const newer = applyCheckResult(prev, { ok: true, status: 'available', latest: latest('1.6.0') }, 700, '1.4.0');
  assert.equal(newer.downloaded, null, 'a download of an older version is forgotten');
  assert.equal(hasAttention(newer), true, 'a newer version than the one put off shows again');
  assert.equal(applyCheckResult(prev, { ok: false, code: 'strange' }, 1, '1.4.0').error.code, 'bad_reply');
});

test('the automatic check runs at most every 6 hours, and waits 30 minutes after a failure', () => {
  const on = normalizeUiPrefs(null);
  const off = normalizeUiPrefs({ updates: { auto: false } });
  const t0 = 1_000_000_000_000;
  assert.equal(shouldAutoCheck(defaultState(), t0, on), true, 'never checked');
  assert.equal(shouldAutoCheck(defaultState(), t0, off), false, 'turned off');
  const ok = { ...defaultState(), status: 'uptodate', checkedAt: t0, lastOk: t0 };
  assert.equal(shouldAutoCheck(ok, t0 + CHECK_EVERY - 1, on), false);
  assert.equal(shouldAutoCheck(ok, t0 + CHECK_EVERY, on), true);
  const failed = { ...defaultState(), status: 'error', checkedAt: t0, lastOk: null, error: { code: 'offline' } };
  assert.equal(shouldAutoCheck(failed, t0 + RETRY_AFTER - 1, on), false);
  assert.equal(shouldAutoCheck(failed, t0 + RETRY_AFTER, on), true);
  const failedAfterOk = { ...failed, lastOk: t0 - CHECK_EVERY - 5 };
  assert.equal(shouldAutoCheck(failedAfterOk, t0 + 60_000, on), false, 'a recent failure blocks even when the last success is old');
  assert.equal(shouldAutoCheck(ok, t0 - 10 * CHECK_EVERY, on), true, 'a last check "in the future" (clock set back) does not block forever');
});

test('the dot shows for a newer version the player has not put off', () => {
  assert.equal(hasAttention(null), false);
  const state = { ...defaultState(), status: 'available', latest: latest('1.5.0') };
  assert.equal(hasAttention(state), true);
  assert.equal(hasAttention({ ...state, dismissedVersion: '1.5.0' }), false);
  assert.equal(hasAttention({ ...state, status: 'error' }), false);
});

test('the update modules use no HTML injection, dialogs or unexpected hosts', () => {
  // Comments start with "// " (URLs have no space after the slashes).
  const code = file => read(file).replace(/(^|\s)\/\/\s.*$/gm, '$1');
  for (const file of ['update.js', 'update-service.js', 'popup-update.js']) {
    const source = code(file);
    assert.ok(!/\b(?:alert|confirm|prompt)\(/.test(source), `${file} uses a blocking dialog`);
    assert.ok(!/\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/.test(source), `${file} assigns HTML`);
    assert.ok(!/\beval\(|new Function/.test(source), `${file} evaluates code`);
    const hosts = new Set([...source.matchAll(/https:\/\/([\w.-]+)/g)].map(match => match[1]));
    for (const host of hosts) assert.ok(['api.github.com', 'raw.githubusercontent.com', 'github.com'].includes(host), `${file} mentions ${host}`);
  }
  assert.ok(code('update.js').includes('https://api.github.com/'), 'the scan sees URLs in code');
  assert.ok(!/chrome\./.test(code('update.js')), 'update.js stays free of extension APIs');
});

test('the menu finds its containers and every update string exists', () => {
  const html = read('popup.html');
  for (const id of ['app-version', 'update-panel', 'update-settings-card']) assert.ok(html.includes(`id="${id}"`), `popup.html lacks #${id}`);
  assert.ok(html.includes('src="popup-update.js"') && html.includes('href="popup-update.css"'));
  const english = JSON.parse(read('locales/en/update.json'));
  for (const [key, value] of Object.entries(english)) {
    assert.ok(typeof value === 'string' ? value.trim() : value.other, `update.${key} is empty`);
    assert.ok(!/[<>]/.test(typeof value === 'string' ? value : JSON.stringify(value)), `update.${key} holds markup`);
  }
  const used = [...read('popup-update.js').matchAll(/\bt\('update\.(\w+)'/g)].map(match => match[1]);
  assert.ok(used.length > 20);
  for (const key of used) assert.ok(key in english, `update.${key} is missing from locales/en/update.json`);
  const unused = Object.keys(english).filter(key => !used.includes(key));
  assert.deepEqual(unused, [], 'locales/en/update.json has strings nothing uses');
});

// Looking for a newer release on GitHub: version maths, choosing a release, the stored state,
// and the checks on every URL we hand to Chrome. No chrome.* APIs here, so it can be tested
// (and run against the real GitHub) from Node. update-service.js wires it to the extension.

export const REPO = 'alexsasha2750/rngidle-extensions';
export const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases?per_page=10`;
export const RELEASE_PAGE_PREFIX = `https://github.com/${REPO}/releases/`;
export const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
export const STATE_KEY = 'updateState';
export const CHECK_EVERY = 6 * 60 * 60 * 1000;
export const RETRY_AFTER = 30 * 60 * 1000;
export const MAX_CANDIDATES = 4;
export const NOTES_MAX = 600;
export const TIMEOUT = 10_000;
export const STATUSES = ['idle', 'uptodate', 'available', 'error'];
export const ERROR_CODES = ['offline', 'rate_limited', 'bad_reply', 'no_release'];
export const DOWNLOAD_STATES = ['in_progress', 'complete', 'interrupted'];

// ---------- versions ----------

// A Chrome manifest version: one to four dot-separated whole numbers.
export function parseVersion(text) {
  if (typeof text !== 'string' || !/^\d{1,9}(\.\d{1,9}){0,3}$/.test(text.trim())) return null;
  return text.trim().split('.').map(Number);
}

// What a release must declare to be considered at all.
export const isReleaseVersion = text => typeof text === 'string' && /^\d{1,9}\.\d{1,9}\.\d{1,9}$/.test(text);

// -1, 0 or 1. Missing parts count as 0 (1.4 == 1.4.0); an unreadable version sorts lowest.
export function compareVersions(a, b) {
  const left = parseVersion(a) ?? [-1];
  const right = parseVersion(b) ?? [-1];
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff) return diff > 0 ? 1 : -1;
  }
  return 0;
}

// ---------- URLs ----------

function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 500 || /[\s\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && !url.port ? url : null;
  } catch {
    return null;
  }
}

// Only a release file of this repository may be downloaded; checked before and after the URL
// parser resolves things like "..", so nothing can climb out of /releases/download/.
export function isDownloadUrl(value) {
  const url = safeUrl(value);
  if (!url || url.search || url.hash || !value.startsWith(DOWNLOAD_PREFIX) || !url.href.startsWith(DOWNLOAD_PREFIX)) return false;
  // <tag>/<file>.zip, nothing deeper.
  return /^[^/]+\/[^/]+\.zip$/i.test(url.pathname.slice(new URL(DOWNLOAD_PREFIX).pathname.length));
}

export function isReleasePageUrl(value) {
  const url = safeUrl(value);
  return Boolean(url && value.startsWith(RELEASE_PAGE_PREFIX) && url.href.startsWith(RELEASE_PAGE_PREFIX));
}

// Tags go into URL paths; keep to the characters git tags normally use.
export const isSafeTag = tag => typeof tag === 'string' && tag.length > 0 && tag.length <= 100
  && /^[\w.+-]+(\/[\w.+-]+)*$/.test(tag) && !tag.split('/').some(part => part === '.' || part === '..');
const encodeTag = tag => tag.split('/').map(encodeURIComponent).join('/');

export const manifestUrl = tag => `https://raw.githubusercontent.com/${REPO}/${encodeTag(tag)}/shop-helper/manifest.json`;
export const releasePageUrl = tag => `${RELEASE_PAGE_PREFIX}tag/${encodeTag(tag)}`;

// A file name Chrome will accept inside the Downloads folder: no folders, no odd characters.
export function safeFileName(name) {
  let cleaned = String(name ?? '').replace(/[^\w.+-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[.-]+|[.-]+$/g, '');
  if (!/\.zip$/i.test(cleaned)) cleaned = `${cleaned}.zip`;
  if (cleaned.length > 120) cleaned = `${cleaned.slice(0, 116)}.zip`;
  return /^[\w+-]/.test(cleaned) && cleaned.length > 4 ? cleaned : 'RNGidle-Shop-Helper-update.zip';
}

// ---------- releases ----------

// The release file: a .zip, preferably the Shop Helper one. Its URL must be a download from this
// repository, or the release is still offered but without a download button.
export function pickAsset(assets) {
  const zips = (Array.isArray(assets) ? assets : []).filter(asset => asset && typeof asset.name === 'string' && /\.zip$/i.test(asset.name));
  const asset = zips.find(entry => /shop-helper/i.test(entry.name)) ?? zips[0];
  if (!asset) return null;
  const size = Number(asset.size);
  return {
    name: asset.name.slice(0, 200),
    size: Number.isFinite(size) && size >= 0 ? size : 0,
    url: isDownloadUrl(asset.browser_download_url) ? asset.browser_download_url : null,
  };
}

// Newest first (the API's order): published, allowed by the pre-release setting, with a .zip.
export function selectCandidates(releases, { prereleases = true } = {}) {
  if (!Array.isArray(releases)) return [];
  return releases
    .filter(release => release && typeof release === 'object' && release.draft !== true && isSafeTag(release.tag_name))
    .filter(release => prereleases || release.prerelease !== true)
    .filter(release => pickAsset(release.assets))
    .slice(0, MAX_CANDIDATES);
}

const stripInline = text => text
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
  .replace(/<(https?:[^>\s]+)>/g, '$1')
  .replace(/<\/?[a-z][^>]*>/gi, '')
  .replace(/(\*\*|__)(.+?)\1/g, '$2')
  .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, '$1$2')
  .replace(/~~(.+?)~~/g, '$1')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// Release notes as short plain text: headings, links, emphasis and code marks flattened, bullets
// kept as "•". A first heading that only repeats the release's name is dropped.
export function trimNotes(markdown, { max = NOTES_MAX, drop = [] } = {}) {
  if (typeof markdown !== 'string') return '';
  const lines = [];
  let fenced = false;
  for (const raw of markdown.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; continue; }
    let line = raw.replace(/\s+$/, '');
    if (!fenced) {
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line) || /^\s*\|?\s*:?-{3,}/.test(line)) continue;
      const heading = line.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/);
      line = heading ? heading[1] : line
        .replace(/^\s*>\s?/, '')
        .replace(/^(\s*)[-*+]\s+(\[[ xX]\]\s+)?/, '$1• ')
        .replace(/^\s*\|(.*)\|\s*$/, (_, cells) => cells.split('|').map(cell => cell.trim()).filter(Boolean).join(' · '));
      line = stripInline(line);
      if (heading && !lines.some(Boolean)) {
        const lower = line.toLowerCase();
        if (drop.some(name => typeof name === 'string' && name && (lower === name.toLowerCase() || lower.includes(name.toLowerCase())))) continue;
      }
    }
    lines.push(line.trim());
  }
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.search(/\s\S*$/);
  return `${(space > max * 0.8 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?•·-]+$/, '')}…`;
}

const isoDate = value => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null);

// The stored description of a release, from the API entry and the manifest at its tag.
export function releaseInfo(release, manifest) {
  const tag = release.tag_name;
  const file = pickAsset(release.assets);
  const versionName = typeof manifest?.version_name === 'string' && manifest.version_name.trim()
    ? manifest.version_name.trim().slice(0, 40) : `v${manifest.version}`;
  return {
    version: manifest.version,
    versionName,
    tag,
    prerelease: release.prerelease === true,
    url: isReleasePageUrl(release.html_url) ? release.html_url : releasePageUrl(tag),
    notes: trimNotes(release.body, { drop: [tag, release.name, versionName] }),
    publishedAt: isoDate(release.published_at),
    asset: file?.url ? file : null,
  };
}

// The highest declared version wins; on a tie, the newer release (earlier in the list).
export function pickNewest(found, current) {
  let best = null;
  for (const entry of found) if (!best || compareVersions(entry.version, best.version) > 0) best = entry;
  if (!best) return null;
  return { status: compareVersions(best.version, current) > 0 ? 'available' : 'uptodate', latest: best };
}

// An HTTP failure as a stored error code.
export function httpErrorCode(status, remaining) {
  if (status === 429 || (status === 403 && String(remaining) === '0')) return 'rate_limited';
  return 'bad_reply';
}

const signal = () => (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(TIMEOUT) : undefined);
const request = (fetchImpl, url) => fetchImpl.call(globalThis, url, {
  credentials: 'omit', cache: 'no-cache', redirect: 'follow', signal: signal(),
  headers: url.startsWith('https://api.github.com/') ? { Accept: 'application/vnd.github+json' } : undefined,
});

async function readManifest(fetchImpl, tag) {
  let response;
  try {
    response = await request(fetchImpl, manifestUrl(tag));
  } catch {
    return { fail: 'offline' };
  }
  if (!response?.ok) return { fail: response?.status === 429 ? 'rate_limited' : 'missing' };
  try {
    const manifest = await response.json();
    return isReleaseVersion(manifest?.version) ? { manifest } : { fail: 'missing' };
  } catch {
    return { fail: 'missing' };
  }
}

// The whole discovery: list the releases, read the manifest at each candidate's tag, keep the
// highest version. Resolves { ok: true, status, latest } or { ok: false, code }; never rejects.
export async function discover({ fetchImpl, current, prereleases = true }) {
  let response;
  try {
    response = await request(fetchImpl, RELEASES_URL);
  } catch {
    return { ok: false, code: 'offline' };
  }
  if (!response?.ok) return { ok: false, code: httpErrorCode(response?.status, response?.headers?.get?.('x-ratelimit-remaining')) };
  let releases;
  try {
    releases = await response.json();
  } catch {
    return { ok: false, code: 'bad_reply' };
  }
  if (!Array.isArray(releases)) return { ok: false, code: 'bad_reply' };
  const candidates = selectCandidates(releases, { prereleases });
  if (!candidates.length) return { ok: false, code: 'no_release' };
  const read = await Promise.all(candidates.map(release => readManifest(fetchImpl, release.tag_name)));
  const found = [];
  read.forEach(({ manifest }, index) => { if (manifest) found.push(releaseInfo(candidates[index], manifest)); });
  const result = pickNewest(found, current);
  if (result) return { ok: true, ...result };
  const fails = read.map(entry => entry.fail);
  if (fails.every(fail => fail === 'offline')) return { ok: false, code: 'offline' };
  if (fails.includes('rate_limited')) return { ok: false, code: 'rate_limited' };
  return { ok: false, code: 'no_release' };
}

// ---------- stored state ----------

const time = value => (Number.isFinite(value) && value > 0 ? value : null);
const text = (value, max) => (typeof value === 'string' && value ? value.slice(0, max) : null);

function normalizeLatest(value) {
  if (!value || typeof value !== 'object' || !isReleaseVersion(value.version) || !isSafeTag(value.tag)) return null;
  const asset = value.asset && isDownloadUrl(value.asset.url) ? {
    name: text(value.asset.name, 200) ?? 'RNGidle-Shop-Helper.zip',
    size: Number.isFinite(value.asset.size) && value.asset.size >= 0 ? value.asset.size : 0,
    url: value.asset.url,
  } : null;
  return {
    version: value.version,
    versionName: text(value.versionName, 40) ?? `v${value.version}`,
    tag: value.tag,
    prerelease: value.prerelease === true,
    url: isReleasePageUrl(value.url) ? value.url : releasePageUrl(value.tag),
    notes: typeof value.notes === 'string' ? value.notes.slice(0, NOTES_MAX) : '',
    publishedAt: isoDate(value.publishedAt),
    asset,
  };
}

function normalizeDownloaded(value) {
  if (!value || typeof value !== 'object' || !isReleaseVersion(value.version) || !Number.isInteger(value.id)) return null;
  return { version: value.version, state: DOWNLOAD_STATES.includes(value.state) ? value.state : 'in_progress', id: value.id };
}

export const defaultState = (current = null) => ({
  checkedAt: null, lastOk: null, status: 'idle', current, latest: null, dismissedVersion: null, downloaded: null, error: null,
});

// Any stored value as a well-formed state. When the running version is not the one the last
// check was made with (the player installed an update), the stored verdict is judged again.
export function normalizeState(value, running = null) {
  const v = value && typeof value === 'object' ? value : {};
  const latest = normalizeLatest(v.latest);
  let status = STATUSES.includes(v.status) ? v.status : 'idle';
  if (status === 'available' && !latest) status = 'idle';
  const current = typeof v.current === 'string' && parseVersion(v.current) ? v.current : null;
  if (running && current !== running && latest && (status === 'available' || status === 'uptodate')) {
    status = compareVersions(latest.version, running) > 0 ? 'available' : 'uptodate';
  }
  const code = v.error?.code;
  const downloaded = normalizeDownloaded(v.downloaded);
  return {
    checkedAt: time(v.checkedAt),
    lastOk: time(v.lastOk),
    status,
    current: running ?? current,
    latest,
    dismissedVersion: isReleaseVersion(v.dismissedVersion) ? v.dismissedVersion : null,
    downloaded: downloaded && latest && downloaded.version === latest.version && status !== 'uptodate' ? downloaded : null,
    error: status === 'error' ? { code: ERROR_CODES.includes(code) ? code : 'bad_reply' } : null,
  };
}

// The state after a check finished. A failure keeps what the last good check found.
export function applyCheckResult(previous, result, now, running) {
  const prev = normalizeState(previous, running);
  if (!result?.ok) {
    return { ...prev, checkedAt: now, status: 'error', current: running, error: { code: ERROR_CODES.includes(result?.code) ? result.code : 'bad_reply' } };
  }
  return normalizeState({ ...prev, checkedAt: now, lastOk: now, status: result.status, current: running, latest: result.latest, error: null }, running);
}

// Whether the automatic check should run now: turned on, nothing good in the last 6 hours and no
// failed attempt in the last 30 minutes. Times from the future (a clock set back) do not block it.
export function shouldAutoCheck(state, now, prefs) {
  if (prefs?.updates?.auto === false) return false;
  const since = at => (at == null ? Infinity : now - at);
  const okAge = since(state?.lastOk);
  if (okAge >= 0 && okAge < CHECK_EVERY) return false;
  const tryAge = since(state?.checkedAt);
  if (state?.status === 'error' && tryAge >= 0 && tryAge < RETRY_AFTER) return false;
  return true;
}

// The version button's dot and the in-game hint: a newer version the player has not put off.
export const hasAttention = state => state?.status === 'available' && Boolean(state.latest) && state.latest.version !== state.dismissedVersion;

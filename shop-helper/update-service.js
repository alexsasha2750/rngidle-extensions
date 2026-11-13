// Looking for a newer release and downloading it, for the menu's version button, the Settings
// card and the in-game button (which reads `updateState` from storage itself). The extension is
// loaded unpacked, so Chrome never updates it on its own.
//   handle(message)  → a Promise for the reply when the message is an update message, else null
//   onSiteReady()    → a Promise; called when a game tab opens (the automatic check, if turned on)
// Replies are { ok: true, state } or { ok: false, error: <code>, state? }.
import { normalizeUiPrefs } from './ui-prefs.js';
import {
  STATE_KEY, applyCheckResult, discover, isDownloadUrl, normalizeState, safeFileName, shouldAutoCheck,
} from './update.js';

export function createUpdateService({ storage, chrome, getTab, site, fetchImpl = globalThis.fetch, now = Date.now }) {
  void getTab; void site; // part of the shared service signature; checks never touch the game tab
  let inFlight = null;
  let deciding = null;
  let queue = Promise.resolve();

  const running = () => {
    try { return chrome.runtime.getManifest().version; } catch { return null; }
  };
  const readPrefs = async () => normalizeUiPrefs((await storage.get('uiPrefs')).uiPrefs);

  // Every change to the stored state goes through here, one at a time, so a check finishing, a
  // download starting and Chrome reporting its progress never overwrite each other. `change`
  // gets the current state and may return { state, reply }. A stored value that needed settling
  // (the player installed an update since the last check) is written back as well.
  function mutate(change = () => null) {
    const step = queue.then(async () => {
      const { [STATE_KEY]: stored } = await storage.get(STATE_KEY);
      const current = running();
      const state = normalizeState(stored, current);
      const outcome = (await change(state)) ?? {};
      const next = outcome.state ?? state;
      if (JSON.stringify(next) !== JSON.stringify(stored ?? normalizeState(null, current))) await storage.set({ [STATE_KEY]: next });
      return outcome.reply ?? { ok: true, state: next };
    });
    queue = step.catch(() => {});
    return step;
  }

  async function runCheck() {
    const prefs = await readPrefs();
    const current = running();
    const result = await discover({ fetchImpl, current, prereleases: prefs.updates.prereleases });
    return mutate(state => {
      const next = applyCheckResult(state, result, now(), current);
      return { state: next, reply: next.status === 'error' ? { ok: false, error: next.error.code, state: next } : undefined };
    });
  }

  // One check at a time; anyone asking meanwhile waits for the same answer.
  function check() {
    if (!inFlight) inFlight = runCheck().finally(() => { inFlight = null; });
    return inFlight;
  }

  // The automatic check: only when turned on and due; otherwise answers with what is stored.
  function checkIfDue() {
    if (inFlight) return inFlight;
    if (!deciding) {
      deciding = (async () => {
        const [reply, prefs] = await Promise.all([mutate(), readPrefs()]);
        return shouldAutoCheck(reply.state, now(), prefs) ? check() : reply;
      })().finally(() => { deciding = null; });
    }
    return deciding;
  }

  // Chrome reports the download's progress here, also waking the worker if it was asleep.
  function onDownloadChanged(delta) {
    const next = delta?.state?.current;
    if (!Number.isInteger(delta?.id) || !['in_progress', 'complete', 'interrupted'].includes(next)) return;
    void mutate(state => (state.downloaded?.id === delta.id && state.downloaded.state !== next
      ? { state: { ...state, downloaded: { ...state.downloaded, state: next } } }
      : null)).catch(() => {});
  }
  try { chrome.downloads?.onChanged?.addListener(onDownloadChanged); } catch { /* no downloads permission */ }

  async function findDownload(id) {
    try {
      const [item] = await chrome.downloads.search({ id });
      return item ?? null;
    } catch {
      return undefined;
    }
  }

  // Catches up on a download that finished or vanished while nobody was listening.
  async function refreshDownload() {
    const { [STATE_KEY]: stored } = await storage.get(STATE_KEY);
    const downloaded = normalizeState(stored, running()).downloaded;
    if (downloaded?.state !== 'in_progress' || typeof chrome.downloads?.search !== 'function') return;
    const item = await findDownload(downloaded.id);
    if (item === null) onDownloadChanged({ id: downloaded.id, state: { current: 'interrupted' } });
    else if (item?.state && item.state !== 'in_progress') onDownloadChanged({ id: downloaded.id, state: { current: item.state } });
  }

  const handlers = {
    UPDATE_CHECK(message) {
      return message.force === true ? check() : checkIfDue();
    },
    async UPDATE_STATUS() {
      await refreshDownload();
      return mutate();
    },
    UPDATE_DOWNLOAD() {
      return mutate(async state => {
        const { latest, downloaded } = state;
        if (state.status !== 'available' || !latest) return { reply: { ok: false, error: 'no_update', state } };
        const url = latest.asset?.url;
        if (!isDownloadUrl(url)) return { reply: { ok: false, error: 'bad_url', state } };
        if (downloaded?.version === latest.version && downloaded.state === 'in_progress') return null;
        let id = null;
        try {
          id = await chrome.downloads.download({ url, filename: safeFileName(latest.asset.name), saveAs: false, conflictAction: 'uniquify' });
        } catch { /* reported below */ }
        if (!Number.isInteger(id)) return { reply: { ok: false, error: 'download_failed', state } };
        return { state: { ...state, downloaded: { version: latest.version, state: 'in_progress', id } } };
      });
    },
    async UPDATE_SHOW() {
      const { state } = await mutate();
      const id = state.downloaded?.id;
      if (!Number.isInteger(id)) return { ok: false, error: 'no_download', state };
      // null: Chrome no longer knows it; undefined: could not ask, so try anyway.
      const item = await findDownload(id);
      if (item === null || item?.exists === false) return { ok: false, error: 'no_download', state };
      try {
        chrome.downloads.show(id);
      } catch {
        return { ok: false, error: 'no_download', state };
      }
      return { ok: true, state };
    },
    UPDATE_DISMISS() {
      return mutate(state => (state.latest
        ? { state: { ...state, dismissedVersion: state.latest.version } }
        : { reply: { ok: false, error: 'no_update', state } }));
    },
  };

  void mutate().catch(() => {});

  return {
    handle(message) {
      const handler = typeof message?.type === 'string' && Object.hasOwn(handlers, message.type) ? handlers[message.type] : null;
      if (!handler) return null;
      try {
        return Promise.resolve(handler(message)).catch(() => ({ ok: false, error: 'unknown' }));
      } catch {
        return Promise.resolve({ ok: false, error: 'unknown' });
      }
    },
    async onSiteReady() {
      try { await checkIfDue(); } catch { /* the next game tab tries again */ }
    },
  };
}

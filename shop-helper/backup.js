// Export and import of the player's settings as text. Importing never switches auto-buy on and
// never carries progress, history or the signed-in account over.
import { normalizePrefs } from './glitch-logic.js';
import { normalizeUiPrefs } from './ui-prefs.js';

export const BACKUP_APP = 'rngidle-shop-helper';
export const BACKUP_FORMAT = 1;
export const MAX_BACKUP_CHARS = 200000;

export function buildBackup({ settings, glitchPrefs, uiPrefs }, now = new Date()) {
  const backup = {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    exportedAt: now.toISOString(),
    glitchPrefs: normalizePrefs(glitchPrefs),
    uiPrefs: normalizeUiPrefs(uiPrefs),
  };
  if (settings && typeof settings === 'object') backup.settings = { ...settings, enabled: false };
  return JSON.stringify(backup, null, 2);
}

// Returns { ok: true, settings?, glitchPrefs?, uiPrefs? } with only the parts the text contained.
export function parseBackup(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'Paste your settings text first.' };
  if (text.length > MAX_BACKUP_CHARS) return { ok: false, error: 'That text is too long to be Shop Helper settings.' };
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'That isn’t valid settings text. Copy it again in full.' }; }
  if (!data || typeof data !== 'object' || data.app !== BACKUP_APP) {
    return { ok: false, error: 'That doesn’t look like Shop Helper settings.' };
  }
  if (data.format !== BACKUP_FORMAT) return { ok: false, error: 'These settings come from a different version.' };

  const result = { ok: true };
  if (data.settings != null) {
    if (typeof data.settings !== 'object' || Array.isArray(data.settings)) return { ok: false, error: 'The auto-buy part of that text is damaged.' };
    result.settings = { ...data.settings, enabled: false };
  }
  if (data.glitchPrefs != null) result.glitchPrefs = normalizePrefs(data.glitchPrefs);
  if (data.uiPrefs != null) result.uiPrefs = normalizeUiPrefs(data.uiPrefs);
  if (!result.settings && !result.glitchPrefs && !result.uiPrefs) return { ok: false, error: 'There are no settings in that text.' };
  return result;
}

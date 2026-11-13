// Glitch's market: live status, the player-answered trial, the purchase that follows a pass,
// and the alert when he visits. Nothing here answers a trial: questions go to the menu and the
// player's answers come back from it.
import {
  isAnswer, interpretAnswer, ITEM_ID, normalizePrefs, normalizeShop, offerState, parseQuestion, REASONS,
  visitKey, wantedAvailable,
} from './glitch-logic.js';

export const GLITCH_ALARM = 'glitch-watch';
const REST_AFTER_BUSY = 3000;
const BUY_ATTEMPTS = 3;
const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createGlitchService({ storage, getTab, site, activity, loadNames, sleep = defaultSleep }) {
  async function readPrefs() {
    const { glitchPrefs } = await storage.get('glitchPrefs');
    return normalizePrefs(glitchPrefs);
  }

  // Signed in, and the account the player already set up (if any).
  async function context() {
    const tab = await getTab();
    if (!tab) return { error: 'Open an RNGidle tab and wait for the game to load.' };
    const user = tab.identity?.user;
    if (!user?.id) return { error: 'Sign in to RNGidle in the open tab.' };
    const accountId = String(user.id);
    const { boundAccount } = await storage.get('boundAccount');
    if (boundAccount && boundAccount !== accountId) {
      return { error: 'A different account is signed in than the one set up for auto-buy.' };
    }
    return { tab, accountId };
  }

  async function loadShop(tabId) {
    const result = await site(tabId, { type: 'SITE_GLITCH' });
    if (!result?.ok) return { error: result?.error || 'Could not reach Glitch.' };
    let wallet = result.data?.wallet;
    if (wallet?.effective == null) {
      const inventory = await site(tabId, { type: 'SITE_INVENTORY' });
      if (inventory?.ok) wallet = inventory.data?.wallet;
    }
    const shop = normalizeShop(result.data, wallet);
    return shop ? { shop } : { error: 'Glitch sent a shelf this extension does not understand.' };
  }

  async function setBadge(on) {
    try {
      await chrome.action?.setBadgeText?.({ text: on ? '!' : '' });
      if (on) await chrome.action?.setBadgeBackgroundColor?.({ color: '#c026d3' });
    } catch { /* the badge is cosmetic */ }
  }

  // Keeps the stored alert in step with the shelf; only writes when something changed.
  async function applyAlert(shop, prefs) {
    const ids = prefs.alert ? wantedAvailable(prefs, shop) : [];
    const { glitchAlert } = await storage.get('glitchAlert');
    if (!ids.length) {
      if (glitchAlert) await storage.remove('glitchAlert');
      await setBadge(false);
      return;
    }
    const key = visitKey(shop);
    const next = { key, ids, endsAt: shop.endsAt, at: glitchAlert?.key === key ? glitchAlert.at : Date.now() };
    if (JSON.stringify(glitchAlert) !== JSON.stringify(next)) await storage.set({ glitchAlert: next });
    await setBadge(true);
  }

  async function status() {
    const tab = await getTab();
    if (!tab) return { ok: true, tab: { open: false, signedIn: false }, shop: null };
    const signedIn = !!tab.identity?.user?.id;
    const loaded = await loadShop(tab.id);
    if (!loaded.shop) return { ok: false, error: loaded.error, tab: { open: true, signedIn } };
    if (signedIn) await applyAlert(loaded.shop, await readPrefs());
    return { ok: true, tab: { open: true, signedIn }, shop: loaded.shop };
  }

  async function startTrial(message) {
    const item = message.item;
    if (typeof item !== 'string' || !ITEM_ID.test(item)) return { ok: false, error: 'Choose a ware first.' };
    const ctx = await context();
    if (ctx.error) return { ok: false, error: ctx.error };
    const loaded = await loadShop(ctx.tab.id);
    if (!loaded.shop) return { ok: false, error: loaded.error };
    const offer = loaded.shop.items.find(entry => entry.id === item);
    const state = offerState(offer, loaded.shop);
    if (!state.buyable) return { ok: false, reason: state.reason, error: REASONS[state.reason] };

    const result = await site(ctx.tab.id, { type: 'SITE_GLITCH_TRIAL', item });
    if (!result?.ok) {
      return { ok: false, status: result?.status, rest: result?.status === 429 ? REST_AFTER_BUSY : 0, error: result?.error || 'Could not start the trial.' };
    }
    const question = parseQuestion(result.data);
    if (!question) return { ok: false, error: 'Glitch asked something this extension does not understand. Use his page in the game instead.' };
    return { ok: true, kind: 'question', question, price: offer.price };
  }

  // A passed trial is turned into the purchase right away, so closing the menu mid-way
  // cannot strand it. One request id covers every retry, so a lost reply never charges twice.
  async function buy(ctx, item, trial) {
    const requestId = crypto.randomUUID();
    let last;
    for (let attempt = 0; attempt < BUY_ATTEMPTS; attempt++) {
      last = await site(ctx.tab.id, { type: 'SITE_GLITCH_BUY', accountId: ctx.accountId, purchase: { item, trial, requestId } });
      if (last?.ok) break;
      if (last?.status >= 400 && last.status < 500 && last.status !== 429) break;
      if (attempt < BUY_ATTEMPTS - 1) await sleep(1000 * (attempt + 1));
    }
    const names = await loadNames();
    const name = names.get(item) || item;
    if (last?.ok) {
      await activity(`Bought ${name} from Glitch.`);
      const refreshed = await loadShop(ctx.tab.id);
      if (refreshed.shop) await applyAlert(refreshed.shop, await readPrefs());
      return { ok: true, kind: 'bought', item };
    }
    if (last?.status >= 400 && last.status < 500 && last.status !== 429) {
      await activity(`${name}: Glitch purchase declined (${last.error}).`);
      return { ok: true, kind: 'declined', item, error: last.error || 'Glitch declined the purchase.' };
    }
    await activity(`${name}: Glitch purchase result unknown. Check your inventory.`);
    return { ok: true, kind: 'uncertain', item, error: 'The result is unknown. Check your inventory before trying again.' };
  }

  async function answer(message) {
    const { item, id, answer: value } = message;
    const validId = (typeof id === 'string' && id) || (typeof id === 'number' && Number.isFinite(id));
    if (typeof item !== 'string' || !ITEM_ID.test(item) || !validId || !isAnswer(value)) {
      return { ok: false, error: 'That answer could not be sent.' };
    }
    const ctx = await context();
    if (ctx.error) return { ok: false, error: ctx.error };
    const result = await site(ctx.tab.id, { type: 'SITE_GLITCH_ANSWER', id, answer: value });
    if (!result?.ok) return { ok: false, status: result?.status, error: result?.error || 'Could not send the answer.' };
    const outcome = interpretAnswer(result.data);
    if (outcome.kind === 'failed') return { ok: true, kind: 'failed', late: outcome.late, answer: outcome.answer, rest: outcome.rest };
    if (outcome.kind === 'next') return { ok: true, kind: 'question', question: outcome.question };
    if (outcome.kind === 'passed') return buy(ctx, item, outcome.id);
    return { ok: false, error: 'Glitch sent a reply this extension does not understand. Check the game before trying again.' };
  }

  async function watch() {
    const prefs = await readPrefs();
    if (!prefs.alert) return;
    const tab = await getTab();
    if (!tab || !tab.identity?.user?.id) return;
    const loaded = await loadShop(tab.id);
    if (loaded.shop) await applyAlert(loaded.shop, prefs);
  }

  // The watch alarm only exists while alerts are on, so it never wakes the worker needlessly.
  async function syncAlarm() {
    const prefs = await readPrefs();
    if (prefs.alert) {
      if (!(await chrome.alarms.get(GLITCH_ALARM))) await chrome.alarms.create(GLITCH_ALARM, { periodInMinutes: 0.5 });
      return;
    }
    await chrome.alarms.clear?.(GLITCH_ALARM);
    await storage.remove('glitchAlert');
    await setBadge(false);
  }

  const handlers = {
    GLITCH_STATUS: status,
    GLITCH_TRIAL_START: startTrial,
    GLITCH_TRIAL_ANSWER: answer,
    GLITCH_PREFS_CHANGED: async () => { await syncAlarm(); await watch(); return { ok: true }; },
  };

  return {
    // Returns a promise for Glitch messages, or null so the caller can try other handlers.
    handle(message) {
      const handler = handlers[message?.type];
      return handler ? handler(message).catch(() => ({ ok: false, error: 'Something went wrong talking to Glitch.' })) : null;
    },
    watch,
    syncAlarm,
  };
}

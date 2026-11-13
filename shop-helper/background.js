import { chooseBlackMarketPurchase, choosePurchase, shopKey } from './logic.js';
import { createGlitchService, GLITCH_ALARM } from './glitch.js';

const ALARM = 'check-shop';
const storage = chrome.storage.local;
let running;
const catalogPromise = fetch(chrome.runtime.getURL('catalog.json')).then(r => r.json());
const versionPromise = fetch(chrome.runtime.getURL('catalog-version.json')).then(r => r.json());
const blackCatalogPromise = fetch(chrome.runtime.getURL('black-catalog.json'))
  .then(r => r.ok ? r.json() : [])
  .then(data => Array.isArray(data) ? data : [])
  .catch(() => []);
const glitchNamesPromise = fetch(chrome.runtime.getURL('glitch-catalog.json'))
  .then(r => r.ok ? r.json() : [])
  .then(data => new Map((Array.isArray(data) ? data : []).filter(item => item && typeof item.id === 'string').map(item => [item.id, String(item.name || item.id)])))
  .catch(() => new Map());

async function status(state, message, extra = {}) {
  await storage.set({ runStatus: { state, message, checkedAt: Date.now(), ...extra } });
}
async function activity(message) {
  const { activity = [] } = await storage.get('activity');
  await storage.set({ activity: [...activity.slice(-19), { time: Date.now(), message }] });
}
async function getTab() {
  const tabs = await chrome.tabs.query({ url: 'https://rngidle.fun/*' });
  for (const tab of tabs) {
    if (tab.id == null) continue;
    try {
      const identity = await chrome.tabs.sendMessage(tab.id, { type: 'SITE_IDENTITY' });
      if (identity?.ok) return { id: tab.id, identity: identity.data };
    } catch { /* A newly opened or suspended tab may not be ready yet. */ }
  }
  return null;
}
async function site(tab, message) {
  try { return await chrome.tabs.sendMessage(tab, message); }
  catch { return { ok: false, error: 'The game tab is unavailable.' }; }
}
async function loadShop(tabId, type) {
  const result = await site(tabId, { type });
  if (!result?.ok) return { error: result?.error || 'unknown error' };
  const shop = result.data;
  if (shop?.wallet?.effective == null) {
    const inventory = await site(tabId, { type: 'SITE_INVENTORY' });
    if (!inventory?.ok || inventory.data?.wallet?.effective == null) return { error: 'Could not load your EP balance; no purchase was made.' };
    shop.wallet = inventory.data.wallet;
  }
  return { shop };
}
function blackMarketSettings(value) {
  return {
    enabled: value?.enabled === true,
    mostExpensive: value?.mostExpensive === true,
    selectedOnly: value?.selectedOnly === true,
    itemIds: [...new Set(Array.isArray(value?.itemIds) ? value.itemIds.filter(id => typeof id === 'string') : [])].sort(),
    minimumEnabled: value?.minimumEnabled === true,
    minimumPrice: value?.minimumPrice
  };
}
function sameBlackMarketSettings(a, b) {
  return JSON.stringify(blackMarketSettings(a)) === JSON.stringify(b);
}
async function recordResult(pending, result, progress, recovering) {
  const lastSlot = pending.key;
  if (result.ok) {
    if (pending.kind === 'blackMarket') {
      progress[pending.uid] = { status: 'complete', lastSlot, requestId: pending.requestId, message: `Bought ${pending.name}.` };
      progress['blackMarket:deal'] = { lastSlot };
      await storage.set({ progress });
      await activity(`Bought ${pending.name}.`);
    } else if (pending.kind === 'bundle') {
      const previous = progress[pending.uid] || {};
      const totalBought = (previous.totalBought || 0) + 1;
      const slotBought = (previous.lastSlot === lastSlot ? previous.slotBought || 0 : 0) + 1;
      const complete = pending.mode === 'once' && totalBought >= pending.targetQuantity;
      progress[pending.uid] = {
        status: complete ? 'complete' : 'purchased', lastSlot, requestId: pending.requestId,
        totalBought, slotBought, slotTarget: pending.targetQuantity,
        targetQuantity: pending.mode === 'once' ? pending.targetQuantity : undefined,
        message: `Bought ${slotBought} Glim bundle${slotBought === 1 ? '' : 's'} in this shop.`
      };
      await storage.set({ progress });
      await activity(`Bought ${pending.name}.`);
    } else {
      const complete = pending.mode === 'once';
      progress[pending.uid] = { status: complete ? 'complete' : 'purchased', lastSlot, requestId: pending.requestId, message: `Bought ${pending.qty} × ${pending.name}.` };
      await storage.set({ progress });
      await activity(`Bought ${pending.qty} × ${pending.name}.`);
    }
    await storage.remove('pendingPurchase');
    return true;
  }
  if (result.status >= 400 && result.status < 500 && result.status !== 429) {
    const previous = progress[pending.uid] || {};
    const partialOnceBundle = pending.kind === 'bundle' && pending.mode === 'once' && previous.totalBought > 0;
    progress[pending.uid] = recovering
      ? { ...previous, status: 'uncertain', lastSlot, message: 'A previous request may have succeeded. Check your inventory, then remove and re-add this item if needed.' }
      : { ...previous, status: partialOnceBundle ? 'complete' : 'error', lastSlot, message: `Purchase declined: ${result.error}` };
    await storage.set({ progress });
    await activity(`${pending.name}: purchase declined (${result.error}).`);
    await storage.remove('pendingPurchase');
    return true;
  }
  await status('waiting', `Purchase result uncertain; will retry the same request: ${result.error || 'network error'}`, { gameTabOpen: true, signedIn: true });
  return false;
}
async function runCheck(depth = 0) {
  if (depth >= 100) return status('error', 'Too many purchases in one check. Pausing until the next check.');
  let { settings, progress = {}, pendingPurchase, boundAccount } = await storage.get(['settings', 'progress', 'pendingPurchase', 'boundAccount']);
  const rules = Array.isArray(settings?.rules) ? settings.rules : [];
  const blackMarketEnabled = settings?.blackMarket?.enabled === true;
  if (!settings?.enabled) return status('paused', 'Automatic buying is paused.');
  if (!rules.length && !blackMarketEnabled) return status('waiting', 'Choose items to watch.');
  const tab = await getTab();
  if (!tab) return status('waiting', 'Open an RNGidle tab and keep it open.', { gameTabOpen: false });
  const user = tab.identity?.user;
  if (!user?.id) return status('waiting', 'Sign in to RNGidle in the open tab.', { gameTabOpen: true, signedIn: false });
  const accountId = String(user.id);
  if (boundAccount && boundAccount !== accountId) return status('error', 'A different account is signed in. Pause and clear the item list before switching accounts.', { gameTabOpen: true, signedIn: true });
  if (!boundAccount) await storage.set({ boundAccount: accountId });

  if (pendingPurchase && progress[pendingPurchase.uid]?.requestId === pendingPurchase.requestId) {
    await storage.remove('pendingPurchase');
    pendingPurchase = null;
  }
  if (pendingPurchase && pendingPurchase.kind !== 'blackMarket' &&
      !rules.some(rule => rule.uid === pendingPurchase.uid && rule.id === pendingPurchase.item)) {
    await activity(`An unfinished purchase for ${pendingPurchase.name} was not retried because its selection was removed.`);
    await storage.remove('pendingPurchase');
    pendingPurchase = null;
  }

  const recovering = !!pendingPurchase;
  let activeShop;
  let activeType;
  let selection = null;
  if (pendingPurchase?.kind === 'blackMarket') {
    const loaded = await loadShop(tab.id, 'SITE_BLACK_MARKET');
    if (!loaded.shop) return status('error', `Could not load the Black Market: ${loaded.error}`, { gameTabOpen: true, signedIn: true });
    activeShop = loaded.shop;
    activeType = 'blackMarket';
  } else {
    if (pendingPurchase || rules.length) {
      const loaded = await loadShop(tab.id, 'SITE_SHOP');
      if (!loaded.shop) return status('error', `Could not load the shop: ${loaded.error}`, { gameTabOpen: true, signedIn: true });
      activeShop = loaded.shop;
      activeType = 'shop';
    }
    if (!pendingPurchase && activeShop) {
      const catalog = await catalogPromise;
      if (activeShop.open && !activeShop.eaten && shopKey(activeShop)) {
        let changed = false;
        for (const rule of rules) {
          const previous = progress[rule.uid];
          if (rule.id !== 'bundle' || rule.mode !== 'once' || previous?.status !== 'purchased' || !previous.totalBought) continue;
          if (!choosePurchase({ rules: [rule] }, progress, activeShop, catalog)) {
            progress[rule.uid] = { ...previous, status: 'complete', message: `Bought ${previous.totalBought} bundle${previous.totalBought === 1 ? '' : 's'}; no more are available for this selection.` };
            changed = true;
          }
        }
        if (changed) await storage.set({ progress });
      }
      selection = choosePurchase(settings, progress, activeShop, catalog);
    }
    if (!pendingPurchase && !selection && blackMarketEnabled) {
      const loaded = await loadShop(tab.id, 'SITE_BLACK_MARKET');
      if (!loaded.shop) return status('error', `Could not load the Black Market: ${loaded.error}`, { gameTabOpen: true, signedIn: true });
      activeShop = loaded.shop;
      activeType = 'blackMarket';
      selection = chooseBlackMarketPurchase(settings, progress, activeShop, await blackCatalogPromise);
    }
  }

  if (!pendingPurchase && !selection) {
    const market = activeType === 'blackMarket';
    const closed = !activeShop?.open || activeShop?.eaten || activeShop?.dealt;
    const message = market
      ? (closed ? 'The Black Market is closed. Waiting for it to reopen.' : 'Watching for eligible Black Market offers.')
      : (closed ? 'The shop is closed. Waiting for it to reopen.' : 'Watching for selected items, stock and enough EP.');
    return status('watching', message, { gameTabOpen: true, signedIn: true });
  }

  const [expected, actual] = await Promise.all([versionPromise, site(tab.id, { type: 'SITE_CATALOG_HASH' })]);
  if (!actual?.ok) return status('error', 'Could not verify current shop prices; no purchase was made.', { gameTabOpen: true, signedIn: true });
  if (actual.data !== expected.sha256) return status('error', 'The game updated its shop catalogue. Update this extension before buying.', { gameTabOpen: true, signedIn: true });

  if (!pendingPurchase) {
    if (selection.kind === 'blackMarket') {
      pendingPurchase = {
        kind: 'blackMarket', uid: selection.uid, item: selection.item.id, name: selection.item.name,
        price: selection.price, key: selection.key, slot: selection.slot, accountId,
        marketSettings: blackMarketSettings(settings.blackMarket), requestId: crypto.randomUUID()
      };
    } else {
      pendingPurchase = {
        ...(selection.kind === 'bundle' ? { kind: 'bundle', targetQuantity: selection.targetQuantity } : {}),
        uid: selection.rule.uid, item: selection.item.id, name: selection.item.name, qty: selection.quantity,
        ruleQuantity: selection.rule.quantity, mode: selection.rule.mode, key: selection.key,
        slot: activeShop.slot, accountId, requestId: crypto.randomUUID()
      };
    }
    await storage.set({ pendingPurchase });
  }
  const fresh = (await storage.get('settings')).settings;
  if (pendingPurchase.kind === 'blackMarket') {
    if (!fresh?.enabled || !sameBlackMarketSettings(fresh.blackMarket, pendingPurchase.marketSettings)) {
      if (!recovering) await storage.remove('pendingPurchase');
      return status('waiting', recovering
        ? 'An unfinished Black Market purchase no longer matches your settings. Check your inventory before changing its filters.'
        : 'Settings changed before the next purchase. The next check will use the new settings.');
    }
  } else {
    const freshRule = fresh?.rules?.find(rule => rule.uid === pendingPurchase.uid && rule.id === pendingPurchase.item);
    if (!fresh?.enabled || !freshRule || freshRule.quantity !== pendingPurchase.ruleQuantity || freshRule.mode !== pendingPurchase.mode) {
      if (!recovering) await storage.remove('pendingPurchase');
      return status('waiting', recovering
        ? 'An unfinished purchase no longer matches your settings. Check your inventory, then remove and re-add the item.'
        : 'Settings changed before the next purchase. The next check will use the new settings.');
    }
  }
  if (pendingPurchase.accountId !== accountId) return status('error', 'A pending purchase belongs to a different account.', { gameTabOpen: true, signedIn: true });
  const result = await site(tab.id, {
    type: pendingPurchase.kind === 'blackMarket' ? 'SITE_BUY_BLACK_MARKET' : 'SITE_BUY',
    accountId,
    purchase: pendingPurchase
  });
  if (!(await recordResult(pendingPurchase, result || {}, progress, recovering))) return;
  return runCheck(depth + 1);
}
function check() {
  if (!running) running = runCheck().catch(error => status('error', `Shop check failed: ${error?.message || 'unknown error'}`)).finally(() => { running = null; });
  return running;
}
async function ensureAlarm() {
  if (!(await chrome.alarms.get(ALARM))) await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
}
const glitch = createGlitchService({ storage, getTab, site, activity, loadNames: () => glitchNamesPromise });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM) void check();
  else if (alarm.name === GLITCH_ALARM) void glitch.watch().catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => { void ensureAlarm(); void glitch.syncAlarm().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { void ensureAlarm(); void glitch.syncAlarm().catch(() => {}); void check(); });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'SITE_READY') { void check(); return; }
  const glitchReply = glitch.handle(message);
  if (glitchReply) { glitchReply.then(sendResponse); return true; }
  if (message?.type === 'CLEAR_BLACK_MARKET_UNCERTAINTY') {
    (async () => {
      if (running) await running;
      const { settings, progress = {}, pendingPurchase } = await storage.get(['settings', 'progress', 'pendingPurchase']);
      if (settings?.enabled) return { ok: false, error: 'Pause automatic purchases and save before clearing uncertain items.' };
      if (pendingPurchase?.kind === 'blackMarket') return { ok: false, error: 'A Black Market request is still pending; resolve it before clearing uncertain items.' };
      const keys = Object.keys(progress).filter(key => key.startsWith('blackMarket:') && key !== 'blackMarket:deal' && progress[key]?.status === 'uncertain');
      for (const key of keys) delete progress[key];
      if (keys.length) await storage.set({ progress });
      return { ok: true, cleared: keys.length };
    })().then(sendResponse, () => sendResponse({ ok: false, error: 'Could not clear uncertain items.' }));
    return true;
  }
  if (message?.type === 'CHECK_NUMBER') {
    (async () => {
      const input = typeof message.number === 'string' ? message.number.trim() : '';
      if (!input || input.length > 250) return { ok: false, error: 'Enter a number of up to 250 characters.' };
      const tab = await getTab();
      if (!tab) return { ok: false, error: 'Open an RNGidle tab and wait for the game to load.' };
      try {
        const frames = await chrome.scripting.executeScript({
          target: { tabId: tab.id }, world: 'MAIN', args: [input],
          func: async number => {
            try {
              const engine = await import('/engine.js');
              const result = engine.composeRollResult(number);
              return { ok: true, result };
            } catch (error) {
              return { ok: false, error: error?.message || 'The game could not analyze this number.' };
            }
          }
        });
        const response = frames?.[0]?.result;
        if (!response?.ok) return { ok: false, error: String(response?.error || 'The game could not analyze this number.').slice(0, 300) };
        const result = response.result;
        if (typeof result?.number !== 'string' || !Number.isFinite(result.totalScore) || !Array.isArray(result.badges)) {
          return { ok: false, error: 'The game returned an unexpected result.' };
        }
        return { ok: true, result: {
          number: result.number,
          totalScore: result.totalScore,
          badges: result.badges.map(badge => ({
            id: String(badge.id ?? ''), label: String(badge.label ?? badge.id ?? ''),
            emoji: String(badge.emoji ?? ''), score: Number(badge.score) || 0,
            isScoring: !!badge.isScoring, multiplier: badge.multiplier ?? null
          }))
        } };
      } catch {
        return { ok: false, error: 'Could not access the game engine. Reload the RNGidle tab and try again.' };
      }
    })().then(sendResponse, () => sendResponse({ ok: false, error: 'Could not check that number.' }));
    return true;
  }
  if (message?.type === 'SETTINGS_CHANGED') {
    (async () => {
      const { settings } = await storage.get('settings');
      if (!settings?.rules?.length && settings?.blackMarket?.enabled !== true) await storage.remove('boundAccount');
      await ensureAlarm();
      await check();
    })().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
});
void ensureAlarm();

import { blackMarketMatches, bundleRunLength, chooseBlackMarketPurchase, choosePurchase, shopKey } from './logic.js';
import { createGlitchService, GLITCH_ALARM } from './glitch.js';
import {
  dryRunProgress, ensureSessionId, normalizeDryRunSeen, normalizeSafety, pruneDryRunSeen, recordSpend, remainingBudget,
  spentInPeriod,
} from './safety.js';
import { addHistory } from './history.js';
import { createNotifier, formatEp, GAME_TABS } from './notify.js';
import { marketStatus, walletOf } from './market.js';
import { normalizeUiPrefs, wantsEvent } from './ui-prefs.js';
import { bundleSignature, rulesOf, withBundleRule } from './bundle.js';
import { createUpdateService } from './update-service.js';
import { registerMenuCommands } from './menu-commands.js';

const ALARM = 'check-shop';
const storage = chrome.storage.local;
const notifier = createNotifier({ storage, chrome });
let running;
let blackWatch;
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
function getSessionId() {
  return ensureSessionId({ session: chrome.storage.session, local: storage, create: () => crypto.randomUUID() });
}
async function logHistory(entry) {
  try { await addHistory(storage, entry); } catch { /* history is informational */ }
}
const placeName = source => (source === 'black' ? 'Black Market' : "Glim's shop");
// What a purchase (pending or simulated) is, in history terms. Price is EP per unit, or null if unknown.
function purchaseFacts({ kind, item, name, qty, price }) {
  const source = kind === 'blackMarket' ? 'black' : kind === 'bundle' ? 'bundle' : 'shop';
  const count = Number.isSafeInteger(qty) && qty > 0 ? qty : 1;
  const unit = typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
  return { source, item, name, qty: count, price: unit, total: unit == null ? null : unit * count };
}
function spentLine(facts, verb = 'Spent') {
  return facts.total == null ? placeName(facts.source) : `${verb} ${formatEp(facts.total)} EP · ${placeName(facts.source)}`;
}
function limitMessage(safety, spent) {
  const day = safety.cap.period === 'day';
  return `Spending limit reached (${formatEp(spent)} of ${formatEp(safety.cap.amount)} EP ${day ? 'today' : 'this browser session'}, ` +
    `resets ${day ? 'at midnight' : 'when the browser restarts'}). Nothing more will be bought until then.`;
}
async function recordResult(pending, result, progress, recovering, sessionId) {
  const lastSlot = pending.key;
  const facts = purchaseFacts(pending);
  if (result.ok) {
    // Spend is written with progress, so a restart can never keep the purchase but lose its cost.
    const spend = recordSpend((await storage.get('spend')).spend, facts, { now: Date.now(), sessionId });
    if (pending.kind === 'blackMarket') {
      progress[pending.uid] = { status: 'complete', lastSlot, requestId: pending.requestId, message: `Bought ${pending.name}.` };
      progress['blackMarket:deal'] = { lastSlot };
      await storage.set({ progress, spend });
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
      await storage.set({ progress, spend });
      await activity(`Bought ${pending.name}.`);
    } else {
      const complete = pending.mode === 'once';
      progress[pending.uid] = { status: complete ? 'complete' : 'purchased', lastSlot, requestId: pending.requestId, message: `Bought ${pending.qty} × ${pending.name}.` };
      await storage.set({ progress, spend });
      await activity(`Bought ${pending.qty} × ${pending.name}.`);
    }
    await storage.remove('pendingPurchase');
    await logHistory({ ...facts, result: 'bought' });
    await notifier.announce('purchase', { title: `Bought ${facts.qty} × ${facts.name}`, message: spentLine(facts), sound: 'success' });
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
    if (recovering) {
      await logHistory({ ...facts, result: 'uncertain', message: 'A previous request may have succeeded. Check your inventory.' });
      await notifier.announce('purchase', {
        title: `Purchase uncertain: ${facts.name}`,
        message: 'An earlier request may have gone through. Check your inventory.',
        sound: 'fail',
      });
    } else {
      const reason = result.error || 'no reason given';
      await logHistory({ ...facts, result: 'declined', message: `Purchase declined: ${reason}` });
      await notifier.announce('purchase', { title: `Purchase declined: ${facts.name}`, message: `${reason} · ${placeName(facts.source)}`, sound: 'fail' });
    }
    return true;
  }
  await status('waiting', `Purchase result uncertain; will retry the same request: ${result.error || 'network error'}`, { gameTabOpen: true, signedIn: true });
  return false;
}
// `dry` carries what earlier dry-run picks in this check would have spent; it is never stored.
async function runCheck(depth = 0, dry = { count: 0, spent: 0 }) {
  if (depth >= 100) return status('error', 'Too many purchases in one check. Pausing until the next check.');
  let { settings, progress = {}, pendingPurchase, boundAccount, spend, dryRunSeen } =
    await storage.get(['settings', 'progress', 'pendingPurchase', 'boundAccount', 'spend', 'dryRunSeen']);
  // The bundle is its own setting; the planner buys it through a rule made from it.
  settings = withBundleRule(settings);
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
  const safety = normalizeSafety(settings.safety);
  // A purchase already sent (recovering) is always retried for real, even in a dry run.
  const dryRun = safety.dryRun && !recovering;
  if (!safety.dryRun && dryRunSeen !== undefined) await storage.remove('dryRunSeen');
  let seen = dryRun ? normalizeDryRunSeen(dryRunSeen) : {};
  const seenBefore = JSON.stringify(seen);
  const now = Date.now();
  const sessionId = await getSessionId();
  const budget = Math.max(0, remainingBudget(safety, spend, { now, sessionId }) - dry.spent);
  // Dry-run picks are never paid for, so later picks see the EP the earlier ones would have used.
  const simulateWallet = shop => {
    const wallet = Number(shop?.wallet?.effective);
    if (dry.spent > 0 && Number.isFinite(wallet)) shop.wallet = { ...shop.wallet, effective: Math.max(0, wallet - dry.spent) };
  };
  let activeShop;
  let activeType;
  let selection = null;
  // Set when the cap, and only the cap, stopped an otherwise eligible purchase.
  let capBlocked = false;
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
      const key = shopKey(activeShop);
      if (!dryRun && activeShop.open && !activeShop.eaten && key) {
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
      let planned = progress;
      if (dryRun) {
        simulateWallet(activeShop);
        seen = pruneDryRunSeen(seen, { shopKey: key });
        planned = dryRunProgress(progress, seen, { rules, shopKey: key });
      }
      selection = choosePurchase(settings, planned, activeShop, catalog, budget);
      if (!selection && budget !== Infinity && choosePurchase(settings, planned, activeShop, catalog)) capBlocked = true;
    }
    if (!pendingPurchase && !selection && blackMarketEnabled) {
      const loaded = await loadShop(tab.id, 'SITE_BLACK_MARKET');
      if (!loaded.shop) return status('error', `Could not load the Black Market: ${loaded.error}`, { gameTabOpen: true, signedIn: true });
      activeShop = loaded.shop;
      activeType = 'blackMarket';
      const blackCatalog = await blackCatalogPromise;
      const key = shopKey(activeShop);
      let planned = progress;
      if (dryRun) {
        simulateWallet(activeShop);
        seen = pruneDryRunSeen(seen, { marketKey: key });
        planned = dryRunProgress(progress, seen, { marketKey: key });
      }
      selection = chooseBlackMarketPurchase(settings, planned, activeShop, blackCatalog, budget);
      if (!selection && budget !== Infinity && chooseBlackMarketPurchase(settings, planned, activeShop, blackCatalog)) capBlocked = true;
    }
  }

  if (!pendingPurchase && !selection) {
    const market = activeType === 'blackMarket';
    const closed = !activeShop?.open || activeShop?.eaten || activeShop?.dealt;
    let state = 'watching';
    let message = market
      ? (closed ? 'The Black Market is closed. Waiting for it to reopen.' : 'Watching for eligible Black Market offers.')
      : (closed ? 'The shop is closed. Waiting for it to reopen.' : 'Watching for selected items, stock and enough EP.');
    if (capBlocked) {
      state = 'waiting';
      message = limitMessage(safety, spentInPeriod(safety, spend, { now, sessionId }) + dry.spent);
    }
    if (dryRun) {
      if (JSON.stringify(seen) !== seenBefore) await storage.set({ dryRunSeen: seen });
      state = 'watching';
      message = dry.count
        ? `Dry run: would have bought ${dry.count} item(s) — nothing was spent.${capBlocked ? ' The spending limit would stop anything more.' : ''}`
        : `Dry run (nothing is bought): ${message}`;
    }
    return status(state, message, { gameTabOpen: true, signedIn: true, ...(capBlocked ? { capReached: true } : {}) });
  }

  const [expected, actual] = await Promise.all([versionPromise, site(tab.id, { type: 'SITE_CATALOG_HASH' })]);
  if (!actual?.ok) return status('error', 'Could not verify current shop prices; no purchase was made.', { gameTabOpen: true, signedIn: true });
  if (actual.data !== expected.sha256) return status('error', 'The game updated its shop catalogue. Update this extension before buying.', { gameTabOpen: true, signedIn: true });

  if (dryRun) {
    // Nothing is sent, saved as pending, or counted: only the record of what would have happened.
    const bundle = selection.kind === 'bundle';
    const facts = purchaseFacts(selection.kind === 'blackMarket'
      ? { kind: 'blackMarket', item: selection.item.id, name: selection.item.name, qty: 1, price: selection.price }
      : {
        kind: selection.kind, item: selection.item.id, name: selection.item.name, price: selection.item.price,
        qty: bundle ? bundleRunLength(selection, progress[selection.rule.uid], activeShop, budget) : selection.quantity,
      });
    seen = { ...seen, [selection.kind === 'blackMarket' ? selection.uid : selection.rule.uid]: selection.key };
    await storage.set({ dryRunSeen: seen });
    await activity(`Dry run: would buy ${facts.qty} × ${facts.name}.`);
    await logHistory({ ...facts, result: 'dryrun', message: 'Dry run: nothing was bought or spent.' });
    await notifier.announce('purchase', {
      title: `Dry run: would buy ${facts.qty} × ${facts.name}`, message: `${spentLine(facts, 'Would spend')} · nothing was spent`, sound: 'success',
    });
    return runCheck(depth + 1, { count: dry.count + 1, spent: dry.spent + (facts.total ?? 0) });
  }

  if (!pendingPurchase) {
    if (selection.kind === 'blackMarket') {
      pendingPurchase = {
        kind: 'blackMarket', uid: selection.uid, item: selection.item.id, name: selection.item.name,
        price: selection.price, key: selection.key, slot: selection.slot, accountId,
        marketSettings: blackMarketSettings(settings.blackMarket), requestId: crypto.randomUUID()
      };
    } else {
      pendingPurchase = {
        ...(selection.kind === 'bundle' ? { kind: 'bundle', targetQuantity: selection.targetQuantity, bundleSig: bundleSignature(settings) } : {}),
        uid: selection.rule.uid, item: selection.item.id, name: selection.item.name, qty: selection.quantity,
        price: selection.item.price, ruleQuantity: selection.rule.quantity, mode: selection.rule.mode, key: selection.key,
        slot: activeShop.slot, accountId, requestId: crypto.randomUUID()
      };
    }
    await storage.set({ pendingPurchase });
  }
  const fresh = withBundleRule((await storage.get('settings')).settings);
  // A cap lowered or a dry run switched on while this purchase was being prepared wins.
  if (!recovering && JSON.stringify(normalizeSafety(fresh?.safety)) !== JSON.stringify(safety)) {
    await storage.remove('pendingPurchase');
    return status('waiting', 'Settings changed before the next purchase. The next check will use the new settings.');
  }
  if (pendingPurchase.kind === 'blackMarket') {
    if (!fresh?.enabled || !sameBlackMarketSettings(fresh.blackMarket, pendingPurchase.marketSettings)) {
      if (!recovering) await storage.remove('pendingPurchase');
      return status('waiting', recovering
        ? 'An unfinished Black Market purchase no longer matches your settings. Check your inventory before changing its filters.'
        : 'Settings changed before the next purchase. The next check will use the new settings.');
    }
  } else {
    const freshRule = fresh?.rules?.find(rule => rule.uid === pendingPurchase.uid && rule.id === pendingPurchase.item);
    // Bundle filters edited while this purchase was being prepared: the next check uses the new ones.
    if (!recovering && pendingPurchase.kind === 'bundle' && pendingPurchase.bundleSig !== undefined && pendingPurchase.bundleSig !== bundleSignature(fresh)) {
      await storage.remove('pendingPurchase');
      return status('waiting', 'Settings changed before the next purchase. The next check will use the new settings.');
    }
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
  if (!(await recordResult(pendingPurchase, result || {}, progress, recovering, sessionId))) return;
  return runCheck(depth + 1);
}
// Watches the Black Market for offers matching the player's filters when auto-buy is not
// already buying there, and announces each market visit's matches once.
async function runBlackWatch() {
  const { uiPrefs, settings, blackAlert } = await storage.get(['uiPrefs', 'settings', 'blackAlert']);
  if (!wantsEvent(normalizeUiPrefs(uiPrefs), 'black')) return;
  if (settings?.enabled && settings?.blackMarket?.enabled === true) return;
  const tab = await getTab();
  if (!tab?.identity?.user?.id) return;
  // Read-only: no wallet is needed to see what is on offer.
  const loaded = await site(tab.id, { type: 'SITE_BLACK_MARKET' });
  const market = loaded?.ok && loaded.data && typeof loaded.data === 'object' ? loaded.data : null;
  if (!market) return;
  const key = shopKey(market);
  if (!market.open || !key) {
    if (blackAlert) await storage.remove('blackAlert');
    return;
  }
  const matches = blackMarketMatches(settings?.blackMarket, market, await blackCatalogPromise);
  const known = blackAlert?.key === key && Array.isArray(blackAlert.ids) ? blackAlert.ids : [];
  if (!matches.length || matches.every(match => known.includes(match.id))) return;
  await storage.set({ blackAlert: { key, ids: [...new Set([...known, ...matches.map(match => match.id)])] } });
  await notifier.announce('black', {
    title: 'Black Market has a match',
    message: matches.map(match => `${match.name} (${formatEp(match.price)} EP)`).join(', '),
    sound: 'alert',
    flash: 'Black Market match!',
  });
}
function watchBlackMarket() {
  if (!blackWatch) blackWatch = runBlackWatch().catch(() => {}).finally(() => { blackWatch = null; });
  return blackWatch;
}
async function marketStatusReply() {
  const tab = await getTab();
  if (!tab) return marketStatus({ tab: null });
  const signedIn = !!tab.identity?.user?.id;
  const [shop, black] = await Promise.all([site(tab.id, { type: 'SITE_SHOP' }), site(tab.id, { type: 'SITE_BLACK_MARKET' })]);
  const hasWallet = (shop?.ok && walletOf(shop.data) != null) || (black?.ok && walletOf(black.data) != null);
  const inventory = signedIn && !hasWallet ? await site(tab.id, { type: 'SITE_INVENTORY' }) : null;
  return marketStatus({ tab: { signedIn }, shop, black, inventory });
}
async function focusGameTab(notificationId) {
  if (typeof notificationId !== 'string' || !notificationId.startsWith('rngidle-')) return;
  try {
    if (notificationId.startsWith('rngidle-glitch-')) await storage.set({ uiTab: 'glitch', uiOpen: true });
    const tabs = await chrome.tabs.query({ url: GAME_TABS });
    const tab = tabs.find(entry => entry.active) ?? tabs[0];
    if (tab?.id != null) {
      await chrome.tabs.update(tab.id, { active: true });
      if (tab.windowId != null) await chrome.windows?.update(tab.windowId, { focused: true });
    }
  } catch { /* the tab or window may have closed */ }
  try { await chrome.notifications.clear(notificationId); } catch { /* already gone */ }
}
function check() {
  if (!running) running = runCheck().catch(error => status('error', `Shop check failed: ${error?.message || 'unknown error'}`)).finally(() => { running = null; });
  return running;
}
async function ensureAlarm() {
  if (!(await chrome.alarms.get(ALARM))) await chrome.alarms.create(ALARM, { periodInMinutes: 1 });
}
const glitch = createGlitchService({
  storage, getTab, site, activity, loadNames: () => glitchNamesPromise, announce: notifier.announce,
});
chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === ALARM) {
    await check();
    await watchBlackMarket();
  } else if (alarm.name === GLITCH_ALARM) await glitch.watch().catch(() => {});
});
chrome.notifications?.onClicked?.addListener(id => focusGameTab(id));
const updates = createUpdateService({ storage, chrome, getTab, site });
registerMenuCommands({ storage, chrome });
chrome.runtime.onInstalled.addListener(() => { void ensureAlarm(); void glitch.syncAlarm().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => {
  void ensureAlarm();
  void glitch.syncAlarm().catch(() => {});
  // A new browser session: the storage.local fallback session id must not carry over.
  void storage.remove('sessionId').catch(() => {}).then(() => check());
});
// The tier is used as a CSS attribute value, so only plain ids pass (e.g. 'numinous_ineffability_303').
const RARITY_TIER = /^[a-z][a-z0-9_]{2,31}$/;
// The game's pill labels are upper case ('COSMIC HORROR'); the menu shows 'Cosmic Horror'.
const titleCase = text => text.replaceAll('_', ' ').toLowerCase().replace(/(^|[\s-])\p{L}/gu, start => start.toUpperCase());
function checkedRarity(rarity) {
  const tier = typeof rarity?.tier === 'string' ? rarity.tier : '';
  if (!RARITY_TIER.test(tier)) return null;
  const given = typeof rarity.label === 'string' ? rarity.label.trim() : '';
  const label = titleCase(given && given.length <= 40 ? given : tier);
  return { tier, label: label.slice(0, 40) };
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'SITE_READY') { void check(); void updates.onSiteReady().catch(() => {}); return; }
  const updateReply = updates.handle(message);
  if (updateReply) { updateReply.then(sendResponse, () => sendResponse({ ok: false, error: 'Could not check for updates.' })); return true; }
  const glitchReply = glitch.handle(message);
  if (glitchReply) { glitchReply.then(sendResponse); return true; }
  if (message?.type === 'MARKET_STATUS') {
    marketStatusReply().then(sendResponse, () => sendResponse({ ok: false, error: 'Could not load the market status.' }));
    return true;
  }
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
              // The game's own rarity for this roll; the checker still works without it.
              let rarity = null;
              try {
                let tier = engine.getCardRarityTier?.(result?.totalScore, result?.number ?? number);
                if (tier === 'transcendant') tier = 'transcendent';
                if (typeof tier === 'string' && tier) {
                  const label = engine.RARITY_PALETTE?.[tier]?.pill?.label;
                  rarity = { tier, label: typeof label === 'string' ? label : '' };
                }
              } catch { rarity = null; }
              return { ok: true, result, rarity };
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
          rarity: checkedRarity(response.rarity),
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
      if (!rulesOf(settings).length && settings?.blackMarket?.enabled !== true) await storage.remove('boundAccount');
      await ensureAlarm();
      await check();
    })().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
});
void ensureAlarm();

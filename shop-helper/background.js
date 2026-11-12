import { choosePurchase } from './logic.js';

const ALARM = 'check-shop';
const storage = chrome.storage.local;
let running;
const catalogPromise = fetch(chrome.runtime.getURL('catalog.json')).then(r => r.json());
const versionPromise = fetch(chrome.runtime.getURL('catalog-version.json')).then(r => r.json());

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
async function recordResult(pending, result, progress, recovering) {
  const lastSlot = pending.key;
  if (result.ok) {
    const complete = pending.mode === 'once';
    progress[pending.uid] = { status: complete ? 'complete' : 'purchased', lastSlot, requestId: pending.requestId, message: `Bought ${pending.qty} × ${pending.name}.` };
    await storage.set({ progress });
    await activity(`Bought ${pending.qty} × ${pending.name}.`);
    await storage.remove('pendingPurchase');
    return true;
  }
  if (result.status >= 400 && result.status < 500 && result.status !== 429) {
    progress[pending.uid] = recovering
      ? { status: 'uncertain', lastSlot, message: 'A previous request may have succeeded. Check your inventory, then remove and re-add this item if needed.' }
      : { status: 'error', lastSlot, message: `Purchase declined: ${result.error}` };
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
  if (!settings?.enabled) return status('paused', 'Automatic buying is paused.');
  if (!Array.isArray(settings.rules) || !settings.rules.length) return status('waiting', 'Choose items to watch.');
  const tab = await getTab();
  if (!tab) return status('waiting', 'Open an RNGidle tab and keep it open.', { gameTabOpen: false });
  const user = tab.identity?.user;
  if (!user?.id) return status('waiting', 'Sign in to RNGidle in the open tab.', { gameTabOpen: true, signedIn: false });
  const accountId = String(user.id);
  if (boundAccount && boundAccount !== accountId) return status('error', 'A different account is signed in. Pause and clear the item list before switching accounts.', { gameTabOpen: true, signedIn: true });
  if (!boundAccount) await storage.set({ boundAccount: accountId });
  const shopResult = await site(tab.id, { type: 'SITE_SHOP' });
  if (!shopResult?.ok) return status('error', `Could not load the shop: ${shopResult?.error || 'unknown error'}`, { gameTabOpen: true, signedIn: true });
  const shop = shopResult.data;
  if (shop?.wallet?.effective == null) {
    const inventory = await site(tab.id, { type: 'SITE_INVENTORY' });
    if (!inventory?.ok || inventory.data?.wallet?.effective == null) return status('error', 'Could not load your EP balance; no purchase was made.', { gameTabOpen: true, signedIn: true });
    shop.wallet = inventory.data.wallet;
  }
  const catalog = await catalogPromise;
  if (pendingPurchase && progress[pendingPurchase.uid]?.requestId === pendingPurchase.requestId) {
    await storage.remove('pendingPurchase');
    pendingPurchase = null;
  }
  if (pendingPurchase && !settings.rules.some(rule => rule.uid === pendingPurchase.uid && rule.id === pendingPurchase.item)) {
    await activity(`An unfinished purchase for ${pendingPurchase.name} was not retried because its selection was removed.`);
    await storage.remove('pendingPurchase');
    pendingPurchase = null;
  }
  const recovering = !!pendingPurchase;
  const selection = pendingPurchase ? null : choosePurchase(settings, progress, shop, catalog);
  if (!pendingPurchase && !selection) {
    const message = !shop?.open || shop?.eaten ? 'The shop is closed. Waiting for it to reopen.' : 'Watching for selected items, stock and enough EP.';
    return status('watching', message, { gameTabOpen: true, signedIn: true });
  }
  const [expected, actual] = await Promise.all([versionPromise, site(tab.id, { type: 'SITE_CATALOG_HASH' })]);
  if (!actual?.ok) return status('error', 'Could not verify current shop prices; no purchase was made.', { gameTabOpen: true, signedIn: true });
  if (actual.data !== expected.sha256) return status('error', 'The game updated its shop catalogue. Update this extension before buying.', { gameTabOpen: true, signedIn: true });
  if (!pendingPurchase) {
    pendingPurchase = { uid: selection.rule.uid, item: selection.item.id, name: selection.item.name, qty: selection.quantity, ruleQuantity: selection.rule.quantity, mode: selection.rule.mode, key: selection.key, slot: shop.slot, accountId, requestId: crypto.randomUUID() };
    await storage.set({ pendingPurchase });
  }
  const fresh = (await storage.get('settings')).settings;
  const freshRule = fresh?.rules?.find(rule => rule.uid === pendingPurchase.uid && rule.id === pendingPurchase.item);
  if (!fresh?.enabled || !freshRule || freshRule.quantity !== pendingPurchase.ruleQuantity || freshRule.mode !== pendingPurchase.mode) {
    if (!recovering) await storage.remove('pendingPurchase');
    return status('waiting', recovering
      ? 'An unfinished purchase no longer matches your settings. Check your inventory, then remove and re-add the item.'
      : 'Settings changed before the next purchase. The next check will use the new settings.');
  }
  if (pendingPurchase.accountId !== accountId) return status('error', 'A pending purchase belongs to a different account.', { gameTabOpen: true, signedIn: true });
  const result = await site(tab.id, { type: 'SITE_BUY', accountId, purchase: pendingPurchase });
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
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void check(); });
chrome.runtime.onInstalled.addListener(() => { void ensureAlarm(); });
chrome.runtime.onStartup.addListener(() => { void ensureAlarm(); void check(); });
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'SITE_READY') { void check(); return; }
  if (message?.type === 'SETTINGS_CHANGED') {
    (async () => {
      const { settings } = await storage.get('settings');
      if (!settings?.rules?.length) await storage.remove('boundAccount');
      await ensureAlarm();
      await check();
    })().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
});
void ensureAlarm();

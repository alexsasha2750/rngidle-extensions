(() => {
  async function jsonRequest(path, options = {}) {
    const response = await fetch(path, {
      method: options.body ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: options.body ? { 'content-type': 'application/json' } : {},
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(20000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = typeof data.error === 'string' ? data.error : (typeof data.message === 'string' ? data.message : `HTTP ${response.status}`);
      return { ok: false, status: response.status, error: reason };
    }
    return { ok: true, data };
  }

  async function handle(message) {
    if (message.type === 'SITE_IDENTITY') return jsonRequest('/api/identity');
    if (message.type === 'SITE_SHOP') return jsonRequest('/api/shop');
    if (message.type === 'SITE_BLACK_MARKET') return jsonRequest('/api/black-market');
    if (message.type === 'SITE_INVENTORY') return jsonRequest('/api/inventory');
    if (message.type === 'SITE_CATALOG_HASH') {
      const response = await fetch('/shop-items.js', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(20000) });
      if (!response.ok) return { ok: false, status: response.status, error: 'Could not check the current shop catalogue.' };
      const hash = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
      return { ok: true, data: Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('') };
    }
    if (message.type === 'SITE_BUY') {
      const identity = await jsonRequest('/api/identity');
      if (!identity.ok) return identity;
      if (!identity.data.user?.id || String(identity.data.user.id) !== message.accountId) {
        return { ok: false, error: 'The signed-in account changed before purchase.' };
      }
      const { item, qty, slot, requestId } = message.purchase || {};
      if (typeof item !== 'string' || !Number.isSafeInteger(qty) || qty < 1 || qty > 1000 ||
          (item === 'bundle' && qty !== 1) ||
          (typeof slot !== 'number' && typeof slot !== 'string') || typeof requestId !== 'string') {
        return { ok: false, status: 400, error: 'Invalid purchase request.' };
      }
      return jsonRequest('/api/shop/buy', { body: { item, qty, slot, proto: 2, force: false, requestId } });
    }
    if (message.type === 'SITE_BUY_BLACK_MARKET') {
      const identity = await jsonRequest('/api/identity');
      if (!identity.ok) return identity;
      if (!identity.data.user?.id || String(identity.data.user.id) !== message.accountId) {
        return { ok: false, error: 'The signed-in account changed before purchase.' };
      }
      const { item, requestId } = message.purchase || {};
      if (typeof item !== 'string' || typeof requestId !== 'string') {
        return { ok: false, status: 400, error: 'Invalid Black Market purchase request.' };
      }
      return jsonRequest('/api/black-market/buy', { body: { item, force: false, requestId } });
    }
    return { ok: false, status: 400, error: 'Unknown request.' };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !message || !['SITE_IDENTITY', 'SITE_SHOP', 'SITE_INVENTORY', 'SITE_CATALOG_HASH', 'SITE_BUY', 'SITE_BLACK_MARKET', 'SITE_BUY_BLACK_MARKET'].includes(message.type)) return;
    handle(message).then(sendResponse, error => sendResponse({ ok: false, error: error?.message || 'Network request failed.' }));
    return true;
  });
  chrome.runtime.sendMessage({ type: 'SITE_READY' }).catch(() => {});
})();

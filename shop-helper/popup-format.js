// Small formatting helpers shared by the menu's modules.

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 });

export function ep(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number >= 1e15 ? number.toExponential(2) : compact.format(number);
}

export function clock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export async function send(message) {
  try {
    const reply = await chrome.runtime.sendMessage(message);
    return reply && typeof reply === 'object' ? reply : { ok: false, error: 'The extension did not answer. Try again.' };
  } catch {
    return { ok: false, error: 'Could not reach the extension. Reload it and try again.' };
  }
}

export const localDay = (time = Date.now()) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export function when(time) {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = localDay(time) === localDay();
  return sameDay
    ? date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

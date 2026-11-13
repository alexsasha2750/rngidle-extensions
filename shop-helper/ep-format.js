// EP in the game's own short form, so numbers in the menu read exactly like the ones in the game
// (score-format.js: formatCompactEP and parseEP). Suffixes are the game's short scale.

export const EP_SUFFIXES = ['', 'k', 'M', 'B', 'T', 'Qd', 'Qn', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'UDc', 'DDc', 'TDc', 'QdDc', 'QnDc', 'SxDc', 'SpDc', 'OcDc', 'NoDc', 'Vg'];

const trim1 = value => String(Number(value.toFixed(1)));

// 12345678 → "12.3M", 950 → "950", 1.2e66 → "1.2e66". Not localised on purpose: the game isn't.
export function formatCompactEP(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const magnitude = Math.abs(n);
  if (magnitude < 1000) return trim1(n);
  let tier = Math.floor(Math.log10(magnitude) / 3);
  let scaled = magnitude / 10 ** (tier * 3);
  if (Number(scaled.toFixed(1)) >= 1000) { tier++; scaled /= 1000; }
  if (tier >= EP_SUFFIXES.length) return n.toExponential(1).replace('.0e', 'e').replace('e+', 'e');
  return (n < 0 ? '-' : '') + trim1(scaled) + EP_SUFFIXES[tier];
}

// "400k", "2.5M", "1B", "3e9", "1,000,000", "12.5 million"-style words are not accepted.
// Returns { value, relativeStep } or null. relativeStep is how coarse the text is (the game shows
// one decimal in compact form, so "12.3M" could really be anywhere in 12.25M–12.35M).
export function parseEP(text) {
  const match = /^\s*([\d.,]+(?:e\d+)?)\s*([a-z]*)\s*$/i.exec(String(text ?? ''));
  if (!match) return null;
  const digits = match[1].replace(/,/g, '');
  const base = Number(digits);
  if (!Number.isFinite(base) || base < 0) return null;
  let tier = 0;
  if (match[2]) {
    tier = EP_SUFFIXES.findIndex(suffix => suffix && suffix.toLowerCase() === match[2].toLowerCase());
    if (tier < 0) return null;
  }
  const value = base * 10 ** (3 * tier);
  const fraction = /\./.test(digits) ? digits.split('.')[1].replace(/e.*$/i, '').length : 0;
  const mantissa = Number(digits.replace(/e.*$/i, ''));
  // Half a unit in the last written place, relative to the value.
  const relativeStep = mantissa > 0 ? 0.5 / (10 ** fraction) / mantissa : 0;
  return { value, relativeStep };
}

// The game's rarity for a checked number: a pill with its name, and a data-rarity attribute that
// popup.css uses to colour the number like a rolled number card in the game.
const t = (key, params) => globalThis.shopHelperI18n?.t(key, params) ?? key;

// Tier ids from the game's engine, e.g. 'rare', 'cosmic_horror', 'numinous_ineffability_303'.
const RARITY_TIER = /^[a-z][a-z0-9_]{2,31}$/;

// Saved checks from before rarity existed (or anything malformed) simply have none.
export function normalizeRarity(value) {
  if (!value || typeof value !== "object" || typeof value.tier !== "string" || !RARITY_TIER.test(value.tier)) return null;
  const label = typeof value.label === "string" && value.label.trim() ? value.label.trim().slice(0, 40) : value.tier.replaceAll("_", " ");
  return { tier: value.tier, label };
}

export function setRarity(element, rarity) {
  if (rarity) element.dataset.rarity = rarity.tier;
  else delete element.dataset.rarity;
  return element;
}

export function rarityPill(rarity, { small = false } = {}) {
  const pill = document.createElement("span");
  pill.className = small ? "rarity-pill is-small" : "rarity-pill";
  setRarity(pill, rarity);
  const description = t("checker.rarityName", { name: rarity.label });
  pill.title = description;
  const hidden = document.createElement("span");
  hidden.className = "visually-hidden";
  hidden.textContent = description;
  const shown = document.createElement("span");
  shown.setAttribute("aria-hidden", "true");
  shown.textContent = rarity.label;
  pill.append(hidden, shown);
  return pill;
}

export function rarityTitle(rarity) {
  return rarity ? t("checker.rarityName", { name: rarity.label }) : "";
}

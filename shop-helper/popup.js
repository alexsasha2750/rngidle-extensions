const state = {
  catalog: [],
  blackCatalog: [],
  snapshot: {},
  draft: { enabled: false, rules: [], blackMarket: defaultBlackMarket(), safety: defaultSafety() },
  saved: { enabled: false, rules: [], blackMarket: defaultBlackMarket(), safety: defaultSafety() },
  ready: false,
  catalogLoaded: false,
  blackCatalogLoaded: false,
  filter: "",
  blackFilter: "",
  saving: false,
  justAdded: null,
};
const priceFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

const elements = {
  enabled: document.getElementById("enabled"),
  enabledState: document.getElementById("enabled-state"),
  signinStatus: document.getElementById("signin-status"),
  signinDot: document.getElementById("signin-dot"),
  tabStatus: document.getElementById("tab-status"),
  tabDot: document.getElementById("tab-dot"),
  lastCheck: document.getElementById("last-check"),
  runState: document.getElementById("run-state"),
  runMessage: document.getElementById("run-message"),
  catalogSearch: document.getElementById("catalog-search"),
  catalogMessage: document.getElementById("catalog-message"),
  catalogList: document.getElementById("catalog-list"),
  selectedCount: document.getElementById("selected-count"),
  unavailableList: document.getElementById("unavailable-list"),
  unavailableItems: document.getElementById("unavailable-items"),
  saveMessage: document.getElementById("save-message"),
  saveButton: document.getElementById("save-button"),
  activityEmpty: document.getElementById("activity-empty"),
  activityList: document.getElementById("activity-list"),
  blackMarketEnabled: document.getElementById("black-market-enabled"),
  blackMarketMostExpensive: document.getElementById("black-market-most-expensive"),
  blackMarketSelectedOnly: document.getElementById("black-market-selected-only"),
  blackMarketMinimumEnabled: document.getElementById("black-market-minimum-enabled"),
  blackMarketMinimumPrice: document.getElementById("black-market-minimum-price"),
  blackMarketSelectionWarning: document.getElementById("black-market-selection-warning"),
  blackMarketSearch: document.getElementById("black-market-search"),
  blackMarketCatalogMessage: document.getElementById("black-market-catalog-message"),
  blackMarketList: document.getElementById("black-market-list"),
  blackMarketSelectedCount: document.getElementById("black-market-selected-count"),
  blackMarketUnavailable: document.getElementById("black-market-unavailable"),
  blackMarketUnavailableItems: document.getElementById("black-market-unavailable-items"),
  blackMarketNoFiltersWarning: document.getElementById("black-market-no-filters-warning"),
  blackMarketUncertainPanel: document.getElementById("black-market-uncertain-panel"),
  clearBlackMarketUncertain: document.getElementById("clear-black-market-uncertain"),
  blackMarketUncertainStatus: document.getElementById("black-market-uncertain-status"),
  clearConfirm: document.getElementById("clear-confirm"),
  clearConfirmYes: document.getElementById("clear-confirm-yes"),
  clearConfirmNo: document.getElementById("clear-confirm-no"),
  saveRow: document.querySelector(".save-row"),
  numberCheckerForm: document.getElementById("number-checker-form"),
  numberCheckerInput: document.getElementById("number-checker-input"),
  numberCheckerButton: document.getElementById("number-checker-button"),
  numberCheckerResult: document.getElementById("number-checker-result"),
  dryRun: document.getElementById("dry-run"),
  dryRunNotice: document.getElementById("dry-run-notice"),
  capEnabled: document.getElementById("cap-enabled"),
  capAmount: document.getElementById("cap-amount"),
  capPeriod: document.getElementById("cap-period"),
  capSpent: document.getElementById("cap-spent"),
  safetySummary: document.getElementById("safety-summary"),
  recent: document.getElementById("number-checker-recent"),
  recentChips: document.getElementById("number-checker-recent-chips"),
  recentClear: document.getElementById("number-checker-recent-clear"),
  compare: document.getElementById("number-checker-compare"),
  compareCols: document.getElementById("compare-cols"),
  compareVerdict: document.getElementById("compare-verdict"),
  compareBadges: document.getElementById("compare-badges"),
  compareClear: document.getElementById("compare-clear"),
};

function defaultBlackMarket() {
  return {
    enabled: false,
    mostExpensive: false,
    selectedOnly: false,
    itemIds: [],
    minimumEnabled: false,
    minimumPrice: 0,
  };
}

function defaultSafety() {
  return { dryRun: false, cap: { enabled: false, amount: 0, period: "day" } };
}

function normalizeSafety(value) {
  const amount = Number(value?.cap?.amount);
  return {
    dryRun: value?.dryRun === true,
    cap: {
      enabled: value?.cap?.enabled === true,
      amount: Number.isFinite(amount) && amount >= 0 ? amount : 0,
      period: value?.cap?.period === "session" ? "session" : "day",
    },
  };
}

function normalizeBlackMarket(value) {
  const itemIds = [];
  const seen = new Set();
  for (const id of Array.isArray(value?.itemIds) ? value.itemIds : []) {
    if (typeof id !== "string" && typeof id !== "number") continue;
    const normalized = String(id);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    itemIds.push(normalized);
  }
  const minimumPrice = Number(value?.minimumPrice);
  return {
    enabled: value?.enabled === true,
    mostExpensive: value?.mostExpensive === true,
    selectedOnly: value?.selectedOnly === true,
    itemIds,
    minimumEnabled: value?.minimumEnabled === true,
    minimumPrice: Number.isFinite(minimumPrice) && minimumPrice >= 0 ? minimumPrice : 0,
  };
}

function normalizeSettings(value) {
  const rules = [];
  const seenIds = new Set();
  const seenUids = new Set();
  for (const rule of Array.isArray(value?.rules) ? value.rules : []) {
    if (!rule || (typeof rule.id !== "string" && typeof rule.id !== "number")) continue;
    const id = String(rule.id);
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    let uid = typeof rule.uid === "string" && rule.uid ? rule.uid : "";
    if (!uid || seenUids.has(uid)) uid = newUid(seenUids);
    seenUids.add(uid);
    rules.push({
      uid,
      id,
      quantity: Number.isInteger(Number(rule.quantity)) && Number(rule.quantity) > 0 ? Number(rule.quantity) : 1,
      mode: rule.mode === "restock" ? "restock" : "once",
    });
  }

  return {
    enabled: value?.enabled === true,
    rules,
    blackMarket: normalizeBlackMarket(value?.blackMarket),
    safety: normalizeSafety(value?.safety),
  };
}

function newUid(existing = []) {
  const used = existing instanceof Set ? existing : new Set(existing);
  let uid;
  do {
    uid = crypto.randomUUID();
  } while (used.has(uid));
  return uid;
}

function cloneSettings(settings) {
  return {
    enabled: settings.enabled,
    rules: settings.rules.map((rule) => ({ ...rule })),
    blackMarket: {
      ...settings.blackMarket,
      itemIds: [...settings.blackMarket.itemIds],
    },
    safety: { dryRun: settings.safety.dryRun, cap: { ...settings.safety.cap } },
  };
}

function settingsChanged() {
  return JSON.stringify(state.draft) !== JSON.stringify(state.saved);
}

function updateSaveState() {
  const dirty = settingsChanged();
  elements.enabled.disabled = !state.ready || state.saving;
  for (const control of [
    elements.blackMarketEnabled,
    elements.blackMarketMostExpensive,
    elements.blackMarketSelectedOnly,
    elements.blackMarketMinimumEnabled,
    elements.blackMarketMinimumPrice,
    elements.blackMarketSearch,
    elements.dryRun,
    elements.capEnabled,
    elements.capAmount,
    elements.capPeriod,
  ]) {
    control.disabled = !state.ready || state.saving;
  }
  for (const control of elements.blackMarketList.querySelectorAll("input, button")) {
    control.disabled = !state.ready || state.saving;
  }
  for (const control of elements.blackMarketUnavailableItems.querySelectorAll("button")) {
    control.disabled = !state.ready || state.saving;
  }
  elements.clearBlackMarketUncertain.disabled = !state.ready || state.saving || state.saved.enabled || state.draft.enabled;
  elements.saveButton.disabled = !state.ready || state.saving || !dirty;
  elements.saveRow.dataset.dirty = String(dirty);
  elements.enabledState.textContent = state.draft.enabled ? "On · changes need saving" : "Paused · changes need saving";
  if (!dirty) {
    elements.enabledState.textContent = state.saved.enabled ? "On" : "Paused";
  }
}

function getRule(itemId) {
  return state.draft.rules.find((rule) => rule.id === itemId);
}

function getProgress(uid) {
  const progress = state.snapshot.progress;
  return progress && typeof progress === "object" ? progress[uid] : undefined;
}

function addText(parent, tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
}

function renderCatalog() {
  elements.catalogList.replaceChildren();
  elements.unavailableItems.replaceChildren();
  const query = state.filter.trim().toLocaleLowerCase();
  const filtered = state.catalog.filter((item) =>
    `${item.name} ${item.id}`.toLocaleLowerCase().includes(query),
  );
  elements.catalogMessage.hidden = filtered.length > 0;

  if (!state.catalogLoaded) {
    elements.catalogMessage.textContent = "Catalog could not be loaded.";
  } else if (filtered.length === 0) {
    elements.catalogMessage.textContent = query ? "No matching items." : "No items are available.";
  }

  for (const [index, item] of filtered.entries()) {
    const rule = getRule(item.id);
    const card = document.createElement("article");
    card.className = "item-card";

    const heading = document.createElement("div");
    heading.className = "item-heading";
    const itemLabel = document.createElement("label");
    itemLabel.className = "item-select";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(rule);
    checkbox.dataset.action = "select-item";
    checkbox.dataset.itemId = item.id;
    checkbox.setAttribute("aria-label", `Select ${item.name}`);
    itemLabel.append(checkbox);
    addText(itemLabel, "span", "item-name", item.name);
    heading.append(itemLabel);
    if (item.price !== undefined && item.price !== null && item.price !== "") {
      const price = Number(item.price);
      if (Number.isFinite(price)) {
        addText(heading, "span", "item-price", `${priceFormatter.format(price)} EP`);
      }
    }
    card.append(heading);

    if (rule) {
      const controls = document.createElement("div");
      controls.className = "item-controls";
      if (state.justAdded === item.id) controls.classList.add("enter");

      const quantityLabel = document.createElement("label");
      quantityLabel.className = "field-label";
      const quantityId = `quantity-${index}`;
      quantityLabel.htmlFor = quantityId;
      addText(quantityLabel, "span", "", "Max per shop");
      const quantity = document.createElement("input");
      quantity.id = quantityId;
      quantity.title = "A whole number from 1 to 1,000";
      quantity.type = "number";
      quantity.min = "1";
      quantity.max = "1000";
      quantity.step = "1";
      quantity.inputMode = "numeric";
      quantity.value = String(rule.quantity);
      quantity.dataset.action = "quantity";
      quantity.dataset.uid = rule.uid;
      quantity.setAttribute("aria-label", `Maximum quantity per shop for ${item.name}`);
      quantityLabel.append(quantity);
      controls.append(quantityLabel);

      const modeLabel = document.createElement("label");
      modeLabel.className = "field-label";
      const modeId = `mode-${index}`;
      modeLabel.htmlFor = modeId;
      addText(modeLabel, "span", "", "Purchase rule");
      const mode = document.createElement("select");
      mode.id = modeId;
      mode.dataset.action = "mode";
      mode.dataset.uid = rule.uid;
      mode.setAttribute("aria-label", `Purchase rule for ${item.name}`);
      for (const [value, label] of [["once", "Buy once"], ["restock", "Every new shop restock"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        mode.append(option);
      }
      mode.value = rule.mode;
      modeLabel.append(mode);
      controls.append(modeLabel);
      card.append(controls);

      const progress = getProgress(rule.uid);
      const progressNode = addText(card, "p", "progress-note", "");
      progressNode.dataset.role = "progress";
      progressNode.dataset.uid = rule.uid;
      setProgressText(progressNode, progress, rule);
      const rearm = document.createElement("button");
      rearm.type = "button";
      rearm.className = "rearm-button";
      rearm.textContent = "Rearm once";
      rearm.hidden = rule.mode !== "once" || progress?.status !== "complete";
      rearm.dataset.action = "rearm";
      rearm.dataset.uid = rule.uid;
      rearm.setAttribute("aria-label", `Rearm completed once rule for ${item.name}`);
      card.append(rearm);
    }

    elements.catalogList.append(card);
  }

  const catalogIds = new Set(state.catalog.map((item) => item.id));
  const unavailable = state.draft.rules.filter((rule) => !catalogIds.has(rule.id));
  elements.unavailableList.hidden = unavailable.length === 0;
  for (const rule of unavailable) {
    const row = document.createElement("div");
    row.className = "unavailable-item";
    addText(row, "span", "", `Item ${rule.id} · quantity ${rule.quantity} · ${rule.mode === "restock" ? "every restock" : "once"}`);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-button";
    remove.textContent = "Remove";
    remove.dataset.action = "remove-rule";
    remove.dataset.uid = rule.uid;
    remove.setAttribute("aria-label", `Remove saved item ${rule.id}`);
    row.append(remove);
    elements.unavailableItems.append(row);
  }

  state.justAdded = null;
  const count = state.draft.rules.length;
  elements.selectedCount.textContent = `${count} selected`;
  updateSaveState();
}

function renderBlackCatalog() {
  elements.blackMarketList.replaceChildren();
  elements.blackMarketUnavailableItems.replaceChildren();
  const query = state.blackFilter.trim().toLocaleLowerCase();
  const filtered = state.blackCatalog.filter((item) =>
    `${item.name} ${item.id}`.toLocaleLowerCase().includes(query),
  );
  elements.blackMarketCatalogMessage.hidden = filtered.length > 0;
  if (!state.blackCatalogLoaded) {
    elements.blackMarketCatalogMessage.textContent = "Black Market catalog could not be loaded.";
  } else if (filtered.length === 0) {
    elements.blackMarketCatalogMessage.textContent = query ? "No matching items." : "No Black Market items are available.";
  }

  const selectedIds = new Set(state.draft.blackMarket.itemIds);
  for (const item of filtered) {
    const label = document.createElement("label");
    label.className = "black-market-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = selectedIds.has(item.id);
    checkbox.dataset.action = "select-black-item";
    checkbox.dataset.itemId = item.id;
    checkbox.setAttribute("aria-label", `Select ${item.name} for Black Market purchases`);
    label.append(checkbox);
    addText(label, "span", "black-item-name", item.name);
    if (item.price !== undefined && item.price !== null && item.price !== "") {
      const price = Number(item.price);
      if (Number.isFinite(price)) addText(label, "span", "black-item-price", `Guide: ${priceFormatter.format(price)} EP`);
    }
    elements.blackMarketList.append(label);
  }

  const catalogIds = new Set(state.blackCatalog.map((item) => item.id));
  const unavailable = state.draft.blackMarket.itemIds.filter((id) => !catalogIds.has(id));
  elements.blackMarketUnavailable.hidden = unavailable.length === 0;
  for (const id of unavailable) {
    const row = document.createElement("div");
    row.className = "unavailable-item";
    addText(row, "span", "", `Saved selection ${id} · not in the Black Market catalog`);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-button";
    remove.textContent = "Remove";
    remove.dataset.action = "remove-black-item";
    remove.dataset.itemId = id;
    remove.setAttribute("aria-label", `Remove saved Black Market selection ${id}`);
    row.append(remove);
    elements.blackMarketUnavailableItems.append(row);
  }
  elements.blackMarketSelectedCount.textContent = `${selectedIds.size} selected`;
  elements.blackMarketSelectionWarning.hidden = !state.draft.blackMarket.selectedOnly || selectedIds.size > 0;
  updateSaveState();
}

function renderBlackMarket() {
  const settings = state.draft.blackMarket;
  elements.blackMarketEnabled.checked = settings.enabled;
  elements.blackMarketMostExpensive.checked = settings.mostExpensive;
  elements.blackMarketSelectedOnly.checked = settings.selectedOnly;
  elements.blackMarketMinimumEnabled.checked = settings.minimumEnabled;
  elements.blackMarketMinimumPrice.value = Number.isFinite(settings.minimumPrice) ? String(settings.minimumPrice) : "";
  elements.blackMarketNoFiltersWarning.hidden = settings.mostExpensive || settings.selectedOnly || settings.minimumEnabled;
  renderBlackCatalog();
  renderBlackMarketRecovery();
}

function uncertainBlackMarketKeys(progress) {
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) return [];
  return Object.entries(progress)
    .filter(([key, entry]) => key.startsWith("blackMarket:") && key !== "blackMarket:deal" && entry?.status === "uncertain")
    .map(([key]) => key);
}

function renderBlackMarketRecovery() {
  elements.blackMarketUncertainPanel.hidden = uncertainBlackMarketKeys(state.snapshot.progress).length === 0;
  elements.clearBlackMarketUncertain.disabled = !state.ready || state.saving || state.saved.enabled || state.draft.enabled;
  if (elements.blackMarketUncertainPanel.hidden || elements.clearBlackMarketUncertain.disabled) {
    elements.clearConfirm.hidden = true;
  }
}

function cannotClearUncertainNow() {
  return !state.ready || state.saving || state.saved.enabled || state.draft.enabled;
}

// The game page blocks window.confirm() inside the in-game panel, so confirm inline.
function askToClearBlackMarketUncertainty() {
  if (cannotClearUncertainNow()) {
    elements.blackMarketUncertainStatus.hidden = false;
    elements.blackMarketUncertainStatus.textContent = "Pause global Automatic purchases and save settings before continuing.";
    return;
  }
  elements.clearConfirm.hidden = false;
  elements.clearConfirmNo.focus();
}

function cancelClearBlackMarketUncertainty() {
  elements.clearConfirm.hidden = true;
  elements.clearBlackMarketUncertain.focus();
}

async function requestBlackMarketUncertaintyClear() {
  elements.clearConfirm.hidden = true;
  if (cannotClearUncertainNow()) {
    elements.blackMarketUncertainStatus.hidden = false;
    elements.blackMarketUncertainStatus.textContent = "Pause global Automatic purchases and save settings before continuing.";
    return;
  }

  const button = elements.clearBlackMarketUncertain;
  button.disabled = true;
  elements.blackMarketUncertainStatus.hidden = false;
  elements.blackMarketUncertainStatus.textContent = "Asking the background service to clear uncertain Black Market results…";
  try {
    const response = await chrome.runtime.sendMessage({ type: "CLEAR_BLACK_MARKET_UNCERTAINTY" });
    if (!response || typeof response !== "object") {
      elements.blackMarketUncertainStatus.textContent = "The background service did not return a result. Try again.";
    } else if (response.ok !== true) {
      elements.blackMarketUncertainStatus.textContent = typeof response.error === "string" && response.error
        ? response.error
        : "Could not clear uncertain Black Market results. Try again.";
    } else {
      const result = response.result && typeof response.result === "object" ? response.result : response;
      if (typeof result.message === "string" && result.message) {
        elements.blackMarketUncertainStatus.textContent = result.message;
      } else if (Number.isSafeInteger(result.cleared) && result.cleared >= 0) {
        elements.blackMarketUncertainStatus.textContent = `Cleared ${result.cleared} uncertain Black Market ${result.cleared === 1 ? "entry" : "entries"}.`;
      } else {
        elements.blackMarketUncertainStatus.textContent = "The background service completed the uncertainty-clear request.";
      }
    }
  } catch {
    elements.blackMarketUncertainStatus.textContent = "Could not reach the background service. Try again.";
  } finally {
    renderBlackMarketRecovery();
    updateSaveState();
  }
}

function setProgressText(node, progress, rule) {
  const status = progress && typeof progress.status === "string" ? progress.status : "";
  const message = progress && typeof progress.message === "string" ? progress.message : "";
  node.hidden = !status && !message;
  const summary = status === "complete" && rule?.mode === "once"
    ? "Completed once. Rearm to allow another purchase."
    : status ? `Progress: ${status}` : "";
  node.textContent = [summary, message].filter(Boolean).join(" · ");
}

function renderProgress() {
  for (const node of elements.catalogList.querySelectorAll('[data-role="progress"]')) {
    const rule = state.draft.rules.find((entry) => entry.uid === node.dataset.uid);
    const progress = getProgress(node.dataset.uid);
    setProgressText(node, progress, rule);
    const rearm = node.parentElement?.querySelector('[data-action="rearm"]');
    if (rearm) rearm.hidden = rule?.mode !== "once" || progress?.status !== "complete";
  }
}

function statusValue(keys) {
  const sources = [
    state.snapshot,
    state.snapshot.runStatus,
    state.snapshot.account,
    state.snapshot.auth,
  ];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) return source[key];
    }
  }
  return undefined;
}

function booleanStatus(value) {
  if (value === true || value === 1) return { label: "Yes", tone: "good" };
  if (value === false || value === 0) return { label: "No", tone: "bad" };
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "open", "signed in", "signed-in", "authenticated", "connected"].includes(normalized)) {
      return { label: "Yes", tone: "good" };
    }
    if (["false", "no", "closed", "signed out", "signed-out", "unauthenticated", "disconnected"].includes(normalized)) {
      return { label: "No", tone: "bad" };
    }
  }
  return { label: "Unknown", tone: "unknown" };
}

function formatDate(value) {
  if (value === undefined || value === null || value === "") return "Not checked yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function renderStatus() {
  const signedIn = booleanStatus(statusValue(["signedIn", "isSignedIn"]));
  const tabOpen = booleanStatus(statusValue(["gameTabOpen", "rngIdleTabOpen", "hasGameTab", "tabOpen"]));
  elements.signinStatus.textContent = `Signed in: ${signedIn.label}`;
  elements.tabStatus.textContent = `Game tab: ${tabOpen.label}`;
  elements.signinDot.className = `status-dot ${signedIn.tone}`;
  elements.tabDot.className = `status-dot ${tabOpen.tone}`;

  const runStatus = state.snapshot.runStatus;
  elements.lastCheck.textContent = formatDate(runStatus?.checkedAt);
  const runState = typeof runStatus?.state === "string" ? runStatus.state : "";
  elements.runState.hidden = !runState;
  elements.runState.textContent = runState;
  const message = typeof runStatus?.message === "string" ? runStatus.message : "";
  elements.runMessage.hidden = !message;
  elements.runMessage.textContent = message;
}

function formatActivityTime(value) {
  if (value === undefined || value === null || value === "") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

function renderActivity() {
  elements.activityList.replaceChildren();
  const activity = Array.isArray(state.snapshot.activity) ? state.snapshot.activity.slice(-5).reverse() : [];
  elements.activityEmpty.hidden = activity.length > 0;
  for (const entry of activity) {
    if (!entry || typeof entry.message !== "string") continue;
    const row = document.createElement("li");
    row.className = "activity-item";
    const time = formatActivityTime(entry.time);
    if (time) addText(row, "span", "activity-time", time);
    addText(row, "span", "activity-text", entry.message);
    elements.activityList.append(row);
  }
  elements.activityEmpty.hidden = elements.activityList.childElementCount > 0;
}

function markDirty(message = "Unsaved changes") {
  elements.saveMessage.textContent = message;
  updateSaveState();
}

const compactFormatter = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 });

function formatEPValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "—");
  return Math.abs(number) >= 1e21 ? number.toExponential(3) : priceFormatter.format(number);
}

function compactEPValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) >= 1e21) return "";
  return Math.abs(number) >= 1e15 ? number.toExponential(2) : compactFormatter.format(number);
}

function checkerText(container, className, text) {
  return addText(container, "span", className, text);
}

function displayCheckerMessage(className, message) {
  elements.numberCheckerResult.replaceChildren();
  addText(elements.numberCheckerResult, "p", className, message);
}

function displayNumberResult(result) {
  const container = elements.numberCheckerResult;
  container.replaceChildren();

  const summary = document.createElement("div");
  summary.className = "checker-summary";
  const numberBlock = document.createElement("div");
  numberBlock.className = "checker-number-block";
  addText(numberBlock, "span", "checker-result-label", "Number");
  addText(numberBlock, "strong", "checker-number", String(result.number ?? "—"));
  summary.append(numberBlock);

  const scoreBlock = document.createElement("div");
  scoreBlock.className = "checker-score-block";
  addText(scoreBlock, "span", "checker-score-label", "Total score");
  addText(scoreBlock, "strong", "checker-score", `${formatEPValue(result.totalScore)} EP`);
  const compact = compactEPValue(result.totalScore);
  if (compact) addText(scoreBlock, "span", "checker-score-compact", `≈ ${compact} EP`);
  summary.append(scoreBlock);
  container.append(summary);
  addPinButton(container, result);

  const badges = Array.isArray(result.badges) ? result.badges : [];
  const scoringCount = badges.filter((badge) => badge?.isScoring !== false).length;
  const head = document.createElement("div");
  head.className = "checker-badges-head";
  const badgeHeading = addText(head, "h3", "checker-badges-heading", "Badges");
  badgeHeading.id = "number-checker-badges-heading";
  addText(head, "span", "count-badge", `${badges.length} found · ${scoringCount} score`);
  container.append(head);

  if (badges.length === 0) {
    addText(container, "p", "checker-no-badges", "No badges returned for this number.");
    return;
  }

  const list = document.createElement("ul");
  list.className = "checker-badges";
  list.setAttribute("aria-labelledby", badgeHeading.id);
  for (const [index, badge] of badges.entries()) {
    const row = document.createElement("li");
    row.className = "checker-badge";
    row.style.setProperty("--i", String(index));
    const name = [badge?.emoji, badge?.label].filter((value) => value !== undefined && value !== null && String(value)).map(String).join(" ");
    addText(row, "span", "checker-badge-name", name || String(badge?.id ?? "Badge"));
    if (badge?.isScoring === false) {
      row.classList.add("is-muted");
      addText(row, "span", "checker-nonscoring", "Doesn’t score");
    } else {
      row.classList.add("is-scoring");
      if (badge?.score !== undefined && badge.score !== null) {
        checkerText(row, "checker-badge-score", `${formatEPValue(badge.score)} EP`);
      }
      if (badge?.multiplier !== undefined && badge.multiplier !== null) {
        checkerText(row, "checker-badge-multiplier", `×${String(badge.multiplier)}`);
      }
    }
    list.append(row);
  }
  container.append(list);
}

async function checkNumber(event) {
  event.preventDefault();
  const number = elements.numberCheckerInput.value.trim();
  if (!number) {
    displayCheckerMessage("checker-error", "Enter a number or expression to check.");
    elements.numberCheckerInput.focus();
    return;
  }

  elements.numberCheckerButton.disabled = true;
  elements.numberCheckerButton.classList.add("is-busy");
  elements.numberCheckerResult.setAttribute("aria-busy", "true");
  displayCheckerMessage("checker-loading", "Checking preview…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "CHECK_NUMBER", number });
    if (!response || response.ok !== true) {
      displayCheckerMessage("checker-error", response?.error || "Could not check that value. Try another number or expression.");
    } else if (!response.result || typeof response.result !== "object") {
      displayCheckerMessage("checker-error", "The number checker returned an incomplete result. Try again.");
    } else {
      displayNumberResult(response.result);
      rememberCheck(response.result);
      // On short screens the score can land below the fold; bring it into view.
      elements.numberCheckerResult.querySelector(".checker-summary")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  } catch (error) {
    const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
    displayCheckerMessage("checker-error", `Could not reach the number checker. Make sure an RNGidle tab is open, then try again${detail}`);
  } finally {
    elements.numberCheckerButton.disabled = false;
    elements.numberCheckerButton.classList.remove("is-busy");
    elements.numberCheckerResult.removeAttribute("aria-busy");
  }
}

// ---------- safety: dry run and spending limit ----------

function safetySummaryText(safety) {
  const parts = [];
  if (safety.cap.enabled && safety.cap.amount > 0) {
    parts.push(`Limit ${compactEPValue(safety.cap.amount) || formatEPValue(safety.cap.amount)} / ${safety.cap.period === "day" ? "day" : "session"}`);
  }
  if (safety.dryRun) parts.push("Dry run");
  return parts.join(" · ") || "Off";
}

function localDayKey(time = Date.now()) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// How much auto-buy has spent in the current limit period, from the background worker's record.
async function spentInPeriod(period) {
  const spend = state.snapshot.spend;
  if (!spend || typeof spend !== "object") return 0;
  if (period === "day") return spend.day === localDayKey() ? Number(spend.dayTotal) || 0 : 0;
  let sessionId = state.snapshot.sessionId;
  try {
    const stored = await chrome.storage.session.get("sessionId");
    if (stored?.sessionId) sessionId = stored.sessionId;
  } catch {
    // Older Chrome builds or blocked contexts fall back to the copy kept in local storage.
  }
  return spend.session && spend.session === sessionId ? Number(spend.sessionTotal) || 0 : 0;
}

async function renderSpent() {
  const cap = state.saved.safety.cap;
  const strong = document.createElement("strong");
  if (!cap.enabled || !(cap.amount > 0)) {
    elements.capSpent.replaceChildren("Spent so far · ", Object.assign(strong, { textContent: "no limit set" }));
    return;
  }
  const spent = await spentInPeriod(cap.period);
  const label = cap.period === "day" ? "Spent today" : "Spent this session";
  strong.textContent = `${compactEPValue(spent) || "0"} of ${compactEPValue(cap.amount) || formatEPValue(cap.amount)} EP`;
  elements.capSpent.replaceChildren(`${label} · `, strong);
}

function renderSafety() {
  const { safety } = state.draft;
  elements.dryRun.checked = safety.dryRun;
  elements.capEnabled.checked = safety.cap.enabled;
  if (document.activeElement !== elements.capAmount) elements.capAmount.value = safety.cap.amount > 0 ? String(safety.cap.amount) : "";
  elements.capPeriod.value = safety.cap.period;
  elements.capAmount.placeholder = "e.g. 5000000";
  elements.safetySummary.textContent = safetySummaryText(safety);
  elements.dryRunNotice.hidden = !state.saved.safety.dryRun;
  void renderSpent();
}

function bindSafety() {
  elements.dryRun.addEventListener("change", () => {
    state.draft.safety.dryRun = elements.dryRun.checked;
    renderSafety();
    markDirty();
  });
  elements.capEnabled.addEventListener("change", () => {
    state.draft.safety.cap.enabled = elements.capEnabled.checked;
    renderSafety();
    markDirty();
  });
  elements.capAmount.addEventListener("input", () => {
    const amount = Number(elements.capAmount.value);
    state.draft.safety.cap.amount = elements.capAmount.value !== "" && Number.isFinite(amount) && amount >= 0 ? amount : 0;
    elements.safetySummary.textContent = safetySummaryText(state.draft.safety);
    markDirty();
  });
  elements.capPeriod.addEventListener("change", () => {
    state.draft.safety.cap.period = elements.capPeriod.value === "session" ? "session" : "day";
    renderSafety();
    markDirty();
  });
}

// Settings pasted in from a backup load as unsaved changes. Auto-buy stays off and the rules get
// fresh ids, so nothing here can spend EP or reuse another install's progress until you save.
function importSettings(raw) {
  const imported = normalizeSettings(raw);
  const used = new Set();
  imported.rules = imported.rules.map((rule) => {
    const uid = newUid(used);
    used.add(uid);
    return { ...rule, uid };
  });
  imported.enabled = false;
  state.draft = cloneSettings(imported);
  elements.enabled.checked = false;
  renderCatalog();
  renderBlackMarket();
  renderSafety();
  markDirty("Imported settings are not saved yet.");
}

// ---------- number checker: recent checks and compare ----------

const RECENT_LIMIT = 8;
const checker = { recent: [], pinned: null, latest: null };

function summarizeResult(result) {
  return {
    number: String(result.number ?? ""),
    totalScore: Number(result.totalScore),
    badges: (Array.isArray(result.badges) ? result.badges : []).slice(0, 60).map((badge) => ({
      id: String(badge?.id ?? badge?.label ?? ""),
      label: String(badge?.label ?? badge?.id ?? ""),
      emoji: String(badge?.emoji ?? ""),
      isScoring: badge?.isScoring !== false,
    })),
  };
}

function badgeName(badge) {
  return [badge.emoji, badge.label].filter(Boolean).join(" ") || badge.id;
}

// Splits two results' scoring badges into shared and one-sided ones.
function diffBadges(a, b) {
  const scoring = (summary) => new Map(summary.badges.filter((badge) => badge.isScoring).map((badge) => [badge.id, badge]));
  const left = scoring(a), right = scoring(b);
  return {
    both: [...left.keys()].filter((id) => right.has(id)).map((id) => left.get(id)),
    onlyA: [...left.keys()].filter((id) => !right.has(id)).map((id) => left.get(id)),
    onlyB: [...right.keys()].filter((id) => !left.has(id)).map((id) => right.get(id)),
  };
}

function persistChecker() {
  chrome.storage.local.set({ checkerRecent: checker.recent, checkerPinned: checker.pinned }).catch(() => {});
}

function renderRecent() {
  elements.recentChips.replaceChildren();
  elements.recent.hidden = checker.recent.length === 0;
  for (const entry of checker.recent) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip chip-button";
    chip.dataset.example = entry.number;
    chip.textContent = entry.number.length > 14 ? `${entry.number.slice(0, 13)}…` : entry.number;
    chip.title = `${entry.number} · ${compactEPValue(entry.totalScore) || formatEPValue(entry.totalScore)} EP`;
    elements.recentChips.append(chip);
  }
}

function addCompareColumn(summary, label) {
  const column = document.createElement("div");
  column.className = "compare-col";
  addText(column, "span", "compare-label", label);
  addText(column, "strong", "compare-number", summary.number.length > 18 ? `${summary.number.slice(0, 17)}…` : summary.number);
  addText(column, "span", "compare-score", `${formatEPValue(summary.totalScore)} EP`);
  elements.compareCols.append(column);
}

function renderCompare() {
  const { pinned, latest } = checker;
  const show = !!pinned && !!latest && pinned.number !== latest.number;
  elements.compare.hidden = !pinned;
  elements.compareCols.replaceChildren();
  elements.compareBadges.replaceChildren();
  if (!pinned) return;
  addCompareColumn(pinned, "Pinned");
  if (!show) {
    elements.compareVerdict.textContent = "Check another number to compare it with the pinned one.";
    return;
  }
  addCompareColumn(latest, "Latest");
  const delta = latest.totalScore - pinned.totalScore;
  const ratio = pinned.totalScore > 0 && latest.totalScore > 0 ? latest.totalScore / pinned.totalScore : null;
  elements.compareVerdict.textContent = delta === 0 ? "Both score the same."
    : `${latest.number.length > 18 ? "The latest" : latest.number} scores ${compactEPValue(Math.abs(delta)) || formatEPValue(Math.abs(delta))} EP ${delta > 0 ? "more" : "less"}${ratio ? ` (×${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(2)})` : ""}.`;
  const diff = diffBadges(pinned, latest);
  for (const [heading, badges] of [["Only pinned", diff.onlyA], ["Only latest", diff.onlyB], ["Both", diff.both]]) {
    if (!badges.length) continue;
    const group = document.createElement("div");
    group.className = "compare-group";
    addText(group, "span", "compare-label", heading);
    for (const badge of badges) addText(group, "span", "chip", badgeName(badge));
    elements.compareBadges.append(group);
  }
}

function rememberCheck(result) {
  const summary = summarizeResult(result);
  checker.latest = summary;
  checker.recent = [summary, ...checker.recent.filter((entry) => entry.number !== summary.number)].slice(0, RECENT_LIMIT);
  persistChecker();
  renderRecent();
  renderCompare();
}

function addPinButton(container, result) {
  const row = document.createElement("div");
  row.className = "checker-actions";
  const pinned = checker.pinned?.number === String(result.number ?? "");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn-ghost btn-small";
  button.textContent = pinned ? "Pinned for comparison" : "Pin to compare";
  button.disabled = pinned;
  button.addEventListener("click", () => {
    checker.pinned = summarizeResult(result);
    persistChecker();
    button.textContent = "Pinned for comparison";
    button.disabled = true;
    renderCompare();
  });
  row.append(button);
  container.append(row);
}

async function loadCheckerExtras() {
  try {
    const stored = await chrome.storage.local.get(["checkerRecent", "checkerPinned"]);
    const valid = (entry) => entry && typeof entry.number === "string" && Number.isFinite(Number(entry.totalScore)) && Array.isArray(entry.badges);
    checker.recent = Array.isArray(stored.checkerRecent) ? stored.checkerRecent.filter(valid).slice(0, RECENT_LIMIT) : [];
    checker.pinned = valid(stored.checkerPinned) ? stored.checkerPinned : null;
  } catch {
    checker.recent = [];
    checker.pinned = null;
  }
  renderRecent();
  renderCompare();
}

function bindCheckerExtras() {
  elements.recentChips.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-example]");
    if (!chip) return;
    elements.numberCheckerInput.value = chip.dataset.example;
    elements.numberCheckerForm.requestSubmit();
  });
  elements.recentClear.addEventListener("click", () => {
    checker.recent = [];
    persistChecker();
    renderRecent();
  });
  elements.compareClear.addEventListener("click", () => {
    checker.pinned = null;
    persistChecker();
    renderCompare();
    const pin = elements.numberCheckerResult.querySelector(".checker-actions button");
    if (pin) { pin.disabled = false; pin.textContent = "Pin to compare"; }
  });
}

function bindEvents() {
  bindSafety();
  bindCheckerExtras();
  document.addEventListener("shophelper:import-settings", (event) => importSettings(event.detail));
  elements.numberCheckerForm.addEventListener("submit", checkNumber);

  elements.enabled.addEventListener("change", () => {
    state.draft.enabled = elements.enabled.checked;
    markDirty();
  });

  elements.blackMarketEnabled.addEventListener("change", () => {
    state.draft.blackMarket.enabled = elements.blackMarketEnabled.checked;
    markDirty();
  });

  const syncBlackMarketFilters = () => {
    state.draft.blackMarket.mostExpensive = elements.blackMarketMostExpensive.checked;
    state.draft.blackMarket.selectedOnly = elements.blackMarketSelectedOnly.checked;
    state.draft.blackMarket.minimumEnabled = elements.blackMarketMinimumEnabled.checked;
    elements.blackMarketNoFiltersWarning.hidden = state.draft.blackMarket.mostExpensive ||
      state.draft.blackMarket.selectedOnly || state.draft.blackMarket.minimumEnabled;
    renderBlackCatalog();
    markDirty();
  };
  elements.blackMarketMostExpensive.addEventListener("change", syncBlackMarketFilters);
  elements.blackMarketSelectedOnly.addEventListener("change", syncBlackMarketFilters);
  elements.blackMarketMinimumEnabled.addEventListener("change", syncBlackMarketFilters);

  elements.blackMarketMinimumPrice.addEventListener("input", () => {
    const value = elements.blackMarketMinimumPrice.value;
    state.draft.blackMarket.minimumPrice = value === "" ? "" : Number(value);
    markDirty();
  });

  elements.blackMarketSearch.addEventListener("input", () => {
    state.blackFilter = elements.blackMarketSearch.value;
    renderBlackCatalog();
  });

  elements.blackMarketList.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.action !== "select-black-item") return;
    const itemId = target.dataset.itemId;
    if (!itemId) return;
    const selected = new Set(state.draft.blackMarket.itemIds);
    if (target.checked) selected.add(itemId);
    else selected.delete(itemId);
    state.draft.blackMarket.itemIds = [...selected];
    markDirty();
    renderBlackCatalog();
  });

  elements.blackMarketUnavailableItems.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.dataset.action !== "remove-black-item") return;
    state.draft.blackMarket.itemIds = state.draft.blackMarket.itemIds.filter((id) => id !== target.dataset.itemId);
    markDirty();
    renderBlackCatalog();
  });

  elements.clearBlackMarketUncertain.addEventListener("click", askToClearBlackMarketUncertainty);
  elements.clearConfirmYes.addEventListener("click", requestBlackMarketUncertaintyClear);
  elements.clearConfirmNo.addEventListener("click", cancelClearBlackMarketUncertainty);

  elements.catalogSearch.addEventListener("input", () => {
    state.filter = elements.catalogSearch.value;
    renderCatalog();
  });

  elements.catalogList.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.dataset.action === "select-item") {
      const itemId = target.dataset.itemId;
      if (target instanceof HTMLInputElement && itemId) {
        if (target.checked && !getRule(itemId)) {
          state.draft.rules.push({ uid: newUid(state.draft.rules.map((rule) => rule.uid)), id: itemId, quantity: 1000, mode: "once" });
          state.justAdded = itemId;
        } else if (!target.checked) {
          state.draft.rules = state.draft.rules.filter((rule) => rule.id !== itemId);
        }
        markDirty();
        renderCatalog();
      }
      return;
    }

    const rule = state.draft.rules.find((entry) => entry.uid === target.dataset.uid);
    if (!rule) return;
    if (target.dataset.action === "quantity" && target instanceof HTMLInputElement) {
      rule.quantity = target.value === "" ? "" : Number(target.value);
      markDirty("Unsaved changes. Quantity must be a whole number from 1 to 1,000.");
    } else if (target.dataset.action === "mode" && target instanceof HTMLSelectElement) {
      const nextMode = target.value === "restock" ? "restock" : "once";
      if (rule.mode !== nextMode && getProgress(rule.uid)?.status === "complete") {
        rule.uid = newUid(state.draft.rules.map((entry) => entry.uid));
      }
      rule.mode = nextMode;
      markDirty();
      renderCatalog();
    }
  });

  elements.catalogList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.dataset.action !== "rearm") return;
    const rule = state.draft.rules.find((entry) => entry.uid === target.dataset.uid);
    if (!rule || rule.mode !== "once" || getProgress(rule.uid)?.status !== "complete") return;
    rule.uid = newUid(state.draft.rules.map((entry) => entry.uid));
    markDirty("Once rule rearmed. Save settings to apply it.");
    renderCatalog();
  });

  elements.catalogList.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.dataset.action !== "quantity") return;
    const rule = state.draft.rules.find((entry) => entry.uid === target.dataset.uid);
    if (!rule) return;
    rule.quantity = target.value === "" ? "" : Number(target.value);
    markDirty("Unsaved changes. Quantity must be a whole number from 1 to 1,000.");
  });

  elements.unavailableItems.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.dataset.action !== "remove-rule") return;
    state.draft.rules = state.draft.rules.filter((rule) => rule.uid !== target.dataset.uid);
    markDirty();
    renderCatalog();
  });

  elements.saveButton.addEventListener("click", saveSettings);
}

function readStorage() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(null, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result || {});
    });
  });
}

function loadCatalog() {
  return fetch(chrome.runtime.getURL("catalog.json")).then((response) => {
    if (!response.ok) throw new Error("Catalog fetch failed");
    return response.json();
  }).then((catalog) => {
    if (!Array.isArray(catalog)) throw new Error("Catalog is not a list");
    const items = new Map();
    for (const item of catalog) {
      if (!item || item.id === undefined || item.id === null || item.name === undefined || item.name === null) continue;
      const id = String(item.id);
      if (!items.has(id)) items.set(id, { id, name: String(item.name), price: item.price });
    }
    items.set("bundle", { id: "bundle", name: "Any bundle", price: null });
    return [...items.values()];
  });
}

function loadBlackCatalog() {
  return fetch(chrome.runtime.getURL("black-catalog.json")).then((response) => {
    if (!response.ok) throw new Error("Black Market catalog fetch failed");
    return response.json();
  }).then((catalog) => {
    if (!Array.isArray(catalog)) throw new Error("Black Market catalog is not a list");
    const items = new Map();
    for (const item of catalog) {
      if (!item || item.id === undefined || item.id === null || item.name === undefined || item.name === null) continue;
      const id = String(item.id);
      if (!id || items.has(id)) continue;
      items.set(id, { id, name: String(item.name), price: item.price });
    }
    return [...items.values()];
  });
}

function validateSettings() {
  const seenUids = new Set();
  const seenIds = new Set();
  for (const rule of state.draft.rules) {
    if (!rule.uid || seenUids.has(rule.uid)) return "Each purchase rule must have a unique ID.";
    seenUids.add(rule.uid);
    if (seenIds.has(rule.id)) return "Each item can have only one purchase rule.";
    seenIds.add(rule.id);
    if (!Number.isInteger(rule.quantity) || rule.quantity < 1 || rule.quantity > 1000) {
      return "Quantity must be a whole number from 1 to 1,000 for every selected item.";
    }
    if (rule.mode !== "once" && rule.mode !== "restock") {
      return "Choose a purchase rule for every selected item.";
    }
  }
  const minimumPrice = state.draft.blackMarket.minimumPrice;
  if (state.draft.blackMarket.minimumEnabled &&
    (typeof minimumPrice !== "number" || !Number.isFinite(minimumPrice) || minimumPrice < 0)) {
    return "Enter a valid minimum item price of 0 EP or more.";
  }
  const cap = state.draft.safety.cap;
  if (cap.enabled && !(Number.isFinite(cap.amount) && cap.amount > 0)) {
    return "Enter a spending limit above 0 EP, or turn the limit off.";
  }
  return "";
}

async function saveSettings() {
  const error = validateSettings();
  if (error) {
    elements.saveMessage.textContent = error;
    return;
  }

  const settings = {
    enabled: state.draft.enabled,
    rules: state.draft.rules.map((rule) => ({
      uid: rule.uid,
      id: rule.id,
      quantity: rule.quantity,
      mode: rule.mode,
    })),
    blackMarket: {
      enabled: state.draft.blackMarket.enabled,
      mostExpensive: state.draft.blackMarket.mostExpensive,
      selectedOnly: state.draft.blackMarket.selectedOnly,
      itemIds: [...new Set(state.draft.blackMarket.itemIds)],
      minimumEnabled: state.draft.blackMarket.minimumEnabled,
      minimumPrice: Number.isFinite(state.draft.blackMarket.minimumPrice) && state.draft.blackMarket.minimumPrice >= 0
        ? state.draft.blackMarket.minimumPrice
        : 0,
    },
    safety: {
      dryRun: state.draft.safety.dryRun,
      cap: {
        enabled: state.draft.safety.cap.enabled,
        amount: Number.isFinite(state.draft.safety.cap.amount) && state.draft.safety.cap.amount >= 0 ? state.draft.safety.cap.amount : 0,
        period: state.draft.safety.cap.period,
      },
    },
  };
  state.saving = true;
  elements.saveMessage.textContent = "Saving…";
  updateSaveState();
  try {
    await new Promise((resolve, reject) => {
      chrome.storage.local.set({ settings }, () => {
        const storageError = chrome.runtime.lastError;
        if (storageError) reject(new Error(storageError.message));
        else resolve();
      });
    });
    state.snapshot.settings = settings;
    state.saved = normalizeSettings(settings);
    state.draft = cloneSettings(state.saved);
    state.saving = false;
    elements.enabled.checked = state.draft.enabled;
    elements.saveMessage.textContent = "Settings saved.";
    updateSaveState();
    renderCatalog();
    renderBlackMarket();
    renderSafety();

    try {
      const response = chrome.runtime.sendMessage({ type: "SETTINGS_CHANGED" });
      if (response && typeof response.catch === "function") response.catch(() => {});
    } catch {
      // The save is already complete; a missing listener should not undo it.
    }
  } catch {
    state.saving = false;
    elements.saveMessage.textContent = "Could not save settings. Try again.";
    updateSaveState();
  }
}

function handleStorageChanges(changes, areaName) {
  if (areaName !== "local") return;
  let settingsUpdated = false;
  for (const [key, change] of Object.entries(changes)) {
    if (change.newValue === undefined) delete state.snapshot[key];
    else state.snapshot[key] = change.newValue;
    if (key === "settings") settingsUpdated = true;
  }

  if (settingsUpdated && !settingsChanged()) {
    state.saved = normalizeSettings(state.snapshot.settings);
    state.draft = cloneSettings(state.saved);
    elements.enabled.checked = state.draft.enabled;
    renderCatalog();
    renderBlackMarket();
    renderSafety();
  } else if (settingsUpdated) {
    elements.saveMessage.textContent = "Settings changed elsewhere; your unsaved edits are still here.";
  }

  if ("spend" in changes || "sessionId" in changes) void renderSpent();

  renderStatus();
  if ("progress" in changes) {
    renderProgress();
    renderBlackMarketRecovery();
  }
  if ("activity" in changes) renderActivity();
}

async function initialize() {
  bindEvents();
  chrome.storage.onChanged.addListener(handleStorageChanges);
  const [storageResult, catalogResult, blackCatalogResult] = await Promise.allSettled([
    readStorage(),
    loadCatalog(),
    loadBlackCatalog(),
  ]);

  if (storageResult.status === "fulfilled") {
    state.snapshot = storageResult.value;
    state.saved = normalizeSettings(state.snapshot.settings);
    state.draft = cloneSettings(state.saved);
    state.ready = true;
    elements.enabled.checked = state.draft.enabled;
  } else {
    elements.saveMessage.textContent = "Could not read saved settings.";
  }

  if (catalogResult.status === "fulfilled") {
    state.catalog = catalogResult.value;
    state.catalogLoaded = true;
  } else {
    state.catalogLoaded = false;
  }

  if (blackCatalogResult.status === "fulfilled") {
    state.blackCatalog = blackCatalogResult.value;
    state.blackCatalogLoaded = true;
  } else {
    state.blackCatalogLoaded = false;
  }

  renderStatus();
  renderCatalog();
  renderBlackMarket();
  renderSafety();
  renderActivity();
  updateSaveState();
  void loadCheckerExtras();
}

initialize();

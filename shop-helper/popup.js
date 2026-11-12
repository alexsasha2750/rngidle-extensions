const state = {
  catalog: [],
  snapshot: {},
  draft: { enabled: false, rules: [] },
  saved: { enabled: false, rules: [] },
  ready: false,
  catalogLoaded: false,
  filter: "",
  saving: false,
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
};

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

  return { enabled: value?.enabled === true, rules };
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
  };
}

function settingsChanged() {
  return JSON.stringify(state.draft) !== JSON.stringify(state.saved);
}

function updateSaveState() {
  const dirty = settingsChanged();
  elements.enabled.disabled = !state.ready || state.saving;
  elements.saveButton.disabled = !state.ready || state.saving || !dirty;
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

      const quantityLabel = document.createElement("label");
      quantityLabel.className = "field-label";
      const quantityId = `quantity-${index}`;
      quantityLabel.htmlFor = quantityId;
      addText(quantityLabel, "span", "", "Up to this many per shop");
      const quantity = document.createElement("input");
      quantity.id = quantityId;
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

  const count = state.draft.rules.length;
  elements.selectedCount.textContent = `${count} selected`;
  updateSaveState();
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

function markDirty(message = "Unsaved changes. Save to apply them.") {
  elements.saveMessage.textContent = message;
  updateSaveState();
}

function bindEvents() {
  elements.enabled.addEventListener("change", () => {
    state.draft.enabled = elements.enabled.checked;
    markDirty();
  });

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
          state.draft.rules.push({ uid: newUid(state.draft.rules.map((rule) => rule.uid)), id: itemId, quantity: 1, mode: "once" });
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
  } else if (settingsUpdated) {
    elements.saveMessage.textContent = "Settings changed elsewhere; your unsaved edits are still here.";
  }

  renderStatus();
  if ("progress" in changes) renderProgress();
  if ("activity" in changes) renderActivity();
}

async function initialize() {
  bindEvents();
  chrome.storage.onChanged.addListener(handleStorageChanges);
  const [storageResult, catalogResult] = await Promise.allSettled([readStorage(), loadCatalog()]);

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

  renderStatus();
  renderCatalog();
  renderActivity();
  updateSaveState();
}

initialize();

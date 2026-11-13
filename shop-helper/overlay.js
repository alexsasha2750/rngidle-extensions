// Adds a floating button and a slide-in copy of the extension menu to rngidle.fun.
// The menu is the extension's own popup page in an iframe, so it stays open while you play.
(() => {
  "use strict";

  const HOST_ID = "rngidle-shop-helper-overlay";
  if (window.top !== window || document.getElementById(HOST_ID)) return;
  if (typeof chrome === "undefined" || !chrome.runtime?.id) return;

  const manifest = chrome.runtime.getManifest();
  const versionLabel = manifest.version_name || `v${manifest.version}`;
  const frameUrl = chrome.runtime.getURL("popup.html?embedded=1");
  const frameOrigin = new URL(frameUrl).origin;

  const state = { launcher: true, open: false, enabled: false, run: "" };
  let frame = null;
  let disposed = false;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText = "all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483000;";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      *, *::before, *::after { box-sizing: border-box; }
      .scene { --spring: cubic-bezier(0.34, 1.56, 0.64, 1); --ease: cubic-bezier(0.22, 1, 0.36, 1); font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      .scene.no-anim * { transition: none !important; animation: none !important; }

      .launcher {
        position: fixed; right: 18px; bottom: 18px; width: 54px; height: 54px; padding: 0;
        display: grid; place-items: center; border: 0; border-radius: 50%; color: #fff; cursor: pointer;
        background: linear-gradient(135deg, #8b6cff, #4f8cff 55%, #38bdf8);
        box-shadow: 0 12px 32px rgba(80, 70, 220, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.38);
        transition: transform 0.45s var(--spring), box-shadow 0.3s, opacity 0.3s, visibility 0s;
        animation: launcher-in 0.7s var(--spring) both;
      }
      .launcher:hover { transform: translateY(-3px) scale(1.07); box-shadow: 0 16px 38px rgba(80, 70, 220, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.38); }
      .launcher:active { transform: scale(0.93); }
      .launcher:focus-visible { outline: 3px solid #bde9ff; outline-offset: 3px; }
      .launcher[data-visible="false"] { opacity: 0; visibility: hidden; transform: scale(0.4) translateY(14px); pointer-events: none; transition: transform 0.4s var(--ease), opacity 0.25s, visibility 0s 0.4s; }
      .launcher svg { position: absolute; transition: transform 0.55s var(--spring), opacity 0.25s; }
      .die { width: 30px; height: 30px; }
      .chev { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; opacity: 0; transform: rotate(-90deg) scale(0.4); }
      .launcher[aria-expanded="true"] .die { opacity: 0; transform: rotate(120deg) scale(0.4); }
      .launcher[aria-expanded="true"] .chev { opacity: 1; transform: none; }

      .launcher::before { content: ""; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid rgba(52, 211, 153, 0.6); opacity: 0; pointer-events: none; }
      .launcher[data-status="good"]::before { animation: ring 2.6s ease-out infinite; }

      .dot { position: absolute; top: 1px; right: 1px; width: 15px; height: 15px; border-radius: 50%; border: 2.5px solid #0b0c1d; background: #737aa3; opacity: 0; transform: scale(0.3); transition: background 0.3s, opacity 0.3s, transform 0.4s var(--spring); }
      .launcher[data-status="good"] .dot, .launcher[data-status="warn"] .dot, .launcher[data-status="bad"] .dot { opacity: 1; transform: none; }
      .launcher[data-status="good"] .dot { background: #34d399; }
      .launcher[data-status="warn"] .dot { background: #fbbf24; }
      .launcher[data-status="bad"] .dot { background: #fb7185; }

      .tip {
        position: absolute; right: calc(100% + 12px); top: 50%; white-space: nowrap; pointer-events: none;
        padding: 7px 11px; border-radius: 10px; font: 600 12px/1.2 ui-sans-serif, system-ui, sans-serif; color: #eef0ff;
        background: #151833; border: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 8px 22px rgba(0, 0, 0, 0.4);
        opacity: 0; transform: translate(8px, -50%); transition: opacity 0.2s, transform 0.3s var(--spring);
      }
      .launcher:hover .tip, .launcher:focus-visible .tip { opacity: 1; transform: translate(0, -50%); }
      .launcher[aria-expanded="true"] .tip { display: none; }
      @media (hover: none) { .tip { display: none; } }

      .panel {
        position: fixed; right: 18px; bottom: 84px; width: 400px; max-width: calc(100vw - 24px);
        height: min(640px, calc(100vh - 104px)); height: min(640px, calc(100dvh - 104px)); min-height: 280px;
        overflow: hidden; border-radius: 22px; background: #090a16;
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 34px 90px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(139, 108, 255, 0.18), 0 0 60px rgba(120, 92, 255, 0.18);
        transform-origin: calc(100% - 32px) 100%;
        opacity: 0; visibility: hidden; transform: translateY(20px) scale(0.88); pointer-events: none;
        transition: opacity 0.25s var(--ease), transform 0.4s var(--ease), visibility 0s 0.4s;
      }
      .panel[data-open="true"] {
        opacity: 1; visibility: visible; transform: none; pointer-events: auto;
        transition: opacity 0.25s var(--ease), transform 0.55s var(--spring), visibility 0s;
      }
      iframe { display: block; width: 100%; height: 100%; border: 0; background: #090a16; color-scheme: dark; }

      @media (max-width: 480px) {
        .launcher { right: 14px; bottom: 14px; }
        .panel { right: 12px; left: 12px; width: auto; max-width: none; bottom: 78px; }
      }
      @media (max-height: 520px) { .panel { bottom: 12px; right: 84px; height: calc(100vh - 24px); } }

      @keyframes launcher-in { from { opacity: 0; transform: scale(0.3) translateY(24px); } to { opacity: 1; transform: none; } }
      @keyframes ring { 0% { transform: scale(0.9); opacity: 0.75; } 100% { transform: scale(1.45); opacity: 0; } }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; transition-delay: 0ms !important; }
      }
    </style>
    <div class="scene no-anim">
      <button class="launcher" type="button" aria-expanded="false" aria-controls="panel" data-visible="true" data-status="off">
        <svg class="die" viewBox="0 0 128 128" aria-hidden="true">
          <g transform="rotate(-9 64 64)">
            <rect x="24" y="24" width="80" height="80" rx="20" fill="#fff"></rect>
            <circle cx="45" cy="45" r="7.5" fill="#5b43d6"></circle><circle cx="83" cy="45" r="7.5" fill="#5b43d6"></circle>
            <circle cx="64" cy="64" r="7.5" fill="#5b43d6"></circle>
            <circle cx="45" cy="83" r="7.5" fill="#5b43d6"></circle><circle cx="83" cy="83" r="7.5" fill="#5b43d6"></circle>
          </g>
        </svg>
        <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
        <span class="dot" aria-hidden="true"></span>
        <span class="tip"></span>
      </button>
      <div class="panel" id="panel" role="dialog" aria-label="RNGidle Shop Helper" data-open="false" inert></div>
    </div>`;

  const scene = root.querySelector(".scene");
  const launcher = root.querySelector(".launcher");
  const panel = root.querySelector(".panel");
  const tip = root.querySelector(".tip");

  // Keep keystrokes made on our button from reaching the game's own shortcuts.
  for (const type of ["keydown", "keyup", "keypress"]) {
    host.addEventListener(type, (event) => event.stopPropagation());
  }

  function ensureFrame() {
    if (frame) return;
    frame = document.createElement("iframe");
    frame.title = "RNGidle Shop Helper";
    frame.src = frameUrl;
    panel.append(frame);
  }

  function statusKey() {
    if (!state.enabled) return "off";
    if (state.run === "error") return "bad";
    if (state.run === "waiting") return "warn";
    return "good";
  }

  function render() {
    const open = state.launcher && state.open;
    if (open) ensureFrame();
    const status = statusKey();
    launcher.dataset.visible = String(state.launcher);
    launcher.dataset.status = status;
    launcher.tabIndex = state.launcher ? 0 : -1;
    launcher.setAttribute("aria-expanded", String(open));
    launcher.setAttribute("aria-label", open ? "Hide RNGidle Shop Helper" : "Open RNGidle Shop Helper");
    tip.textContent = `Shop Helper ${versionLabel} · auto-buy ${state.enabled ? "on" : "off"}`;
    panel.dataset.open = String(open);
    panel.inert = !open;
  }

  function save(values) {
    try { chrome.storage.local.set(values).catch(() => {}); } catch { /* extension was reloaded */ }
  }

  function setOpen(open) {
    state.open = open;
    render();
    save({ uiOpen: open });
    if (open) setTimeout(() => frame?.focus(), 220);
  }

  launcher.addEventListener("click", () => setOpen(!state.open));
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.open) {
      setOpen(false);
      launcher.focus();
    }
  });

  function onMessage(event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== frameOrigin) return;
    const data = event.data;
    if (data && data.source === "rngidle-shop-helper" && data.type === "hide") {
      setOpen(false);
      launcher.focus();
    }
  }
  window.addEventListener("message", onMessage);

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("message", onMessage);
    host.remove();
  }

  function onStorageChanged(changes, area) {
    if (area !== "local") return;
    if (!chrome.runtime?.id) { dispose(); return; }
    if (changes.uiLauncher) {
      state.launcher = changes.uiLauncher.newValue !== false;
      // Hiding the button also closes the menu, so bringing the button back doesn't reopen it.
      if (!state.launcher && state.open) {
        state.open = false;
        save({ uiOpen: false });
      }
    }
    if (changes.uiOpen) state.open = changes.uiOpen.newValue === true;
    if (changes.settings) state.enabled = changes.settings.newValue?.enabled === true;
    if (changes.runStatus) state.run = changes.runStatus.newValue?.state ?? "";
    render();
  }

  document.documentElement.append(host);

  chrome.storage.local.get(["uiLauncher", "uiOpen", "settings", "runStatus"]).then((saved) => {
    state.launcher = saved.uiLauncher !== false;
    state.open = state.launcher && saved.uiOpen === true;
    state.enabled = saved.settings?.enabled === true;
    state.run = saved.runStatus?.state ?? "";
    render();
    chrome.storage.onChanged.addListener(onStorageChanged);
    // Enable transitions only after the first paint so a saved "open" state doesn't animate on load.
    requestAnimationFrame(() => requestAnimationFrame(() => scene.classList.remove("no-anim")));
  }).catch(() => dispose());
})();

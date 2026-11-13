// Adds a floating button and a slide-in copy of the extension menu to rngidle.fun.
// The menu is the extension's own popup page in an iframe, so it stays open while you play.
// The button can be dragged anywhere, faded or tucked into a screen edge; launcher-geometry.js
// (loaded just before this file) works out where it, the menu and the prompt go.
(() => {
  "use strict";

  const HOST_ID = "rngidle-shop-helper-overlay";
  if (window.top !== window || document.getElementById(HOST_ID)) return;
  if (typeof chrome === "undefined" || !chrome.runtime?.id) return;

  const manifest = chrome.runtime.getManifest();
  const versionLabel = manifest.version_name || `v${manifest.version}`;
  const frameUrl = chrome.runtime.getURL("popup.html?embedded=1");
  const frameOrigin = new URL(frameUrl).origin;
  // Without the geometry helper the button keeps its CSS corner and cannot be moved.
  const geo = globalThis.shopHelperLauncherGeometry ?? null;
  const i18n = globalThis.shopHelperI18n ?? null;
  const t = (key, params) => (i18n ? i18n.t(key, params) : key);

  const MODES = ["normal", "faded", "edge"];
  const SIZES = ["normal", "small"];
  const DRAG_THRESHOLD = 6;
  const KEY_STEP = 12;
  const KEY_STEP_BIG = 48;

  const state = {
    launcher: true, open: false, enabled: false, run: "", alert: null, seen: "", theme: "auto",
    mode: "normal", size: "normal", pos: null,
    update: null, updateSeen: "", updateNote: "",
    peek: false, hover: false,
  };
  const lightQuery = window.matchMedia("(prefers-color-scheme: light)");
  let frame = null;
  let disposed = false;
  let stopI18n = null;

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

      .dock {
        position: fixed; right: 18px; bottom: 18px; width: 54px; height: 54px; pointer-events: none;
        translate: 0 0; transition: translate 0.3s var(--ease), left 0.3s var(--ease), top 0.3s var(--ease);
      }
      .dock[data-size="small"] { width: 36px; height: 36px; }
      .dock[data-dragging="true"] { transition: translate 0.2s var(--ease) !important; }
      .dock[data-instant="true"] { transition: none !important; }

      .launcher {
        position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; pointer-events: auto;
        display: grid; place-items: center; border: 0; border-radius: 50%; color: #fff; cursor: pointer;
        touch-action: none; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent;
        background: linear-gradient(135deg, #8b6cff, #4f8cff 55%, #38bdf8);
        box-shadow: 0 12px 32px rgba(80, 70, 220, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.38);
        transition: transform 0.45s var(--spring), box-shadow 0.3s, opacity 0.3s, visibility 0s;
        animation: launcher-in 0.7s var(--spring);
      }
      .launcher:hover { transform: translateY(-3px) scale(1.07); box-shadow: 0 16px 38px rgba(80, 70, 220, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.38); }
      .launcher:active { transform: scale(0.93); }
      .launcher:focus-visible { outline: 3px solid #bde9ff; outline-offset: 3px; }
      .dock[data-dragging="true"] .launcher { cursor: grabbing; transform: scale(1.08); box-shadow: 0 22px 46px rgba(80, 70, 220, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.38); }
      .launcher[data-visible="false"] { opacity: 0; visibility: hidden; transform: scale(0.4) translateY(14px); pointer-events: none; transition: transform 0.4s var(--ease), opacity 0.25s, visibility 0s 0.4s; }
      .launcher svg { position: absolute; transition: transform 0.55s var(--spring), opacity 0.25s; }
      .die { width: 30px; height: 30px; }
      .chev { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; opacity: 0; transform: rotate(-90deg) scale(0.4); }
      .launcher[aria-expanded="true"] .die { opacity: 0; transform: rotate(120deg) scale(0.4); }
      .launcher[aria-expanded="true"] .chev { opacity: 1; transform: none; }
      .dock[data-size="small"] .die { width: 20px; height: 20px; }
      .dock[data-size="small"] .chev { width: 17px; height: 17px; }
      .dock[data-size="small"] .launcher { box-shadow: 0 8px 22px rgba(80, 70, 220, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.38); }

      .launcher::before { content: ""; position: absolute; inset: -4px; border-radius: 50%; border: 2px solid rgba(52, 211, 153, 0.6); opacity: 0; pointer-events: none; }
      .launcher[data-status="good"]::before { animation: ring 2.6s ease-out infinite; }
      .launcher::after { content: ""; position: absolute; inset: -4px; border-radius: 50%; border: 3px solid #e879f9; opacity: 0; pointer-events: none; }
      .launcher[data-update="true"]::after { border-color: #38bdf8; box-shadow: 0 0 14px rgba(56, 189, 248, 0.55); animation: ring-alert 1.8s ease-out infinite; }
      .launcher[data-alert="true"]::after { border-color: #e879f9; box-shadow: none; animation: ring-alert 1.4s ease-out infinite; }
      .dock[data-size="small"] .launcher::before { inset: -3px; border-width: 1.5px; }
      .dock[data-size="small"] .launcher::after { inset: -3px; border-width: 2px; }

      .dot { position: absolute; top: 1px; right: 1px; width: 15px; height: 15px; border-radius: 50%; border: 2.5px solid #0b0c1d; background: #737aa3; opacity: 0; transform: scale(0.3); transition: background 0.3s, opacity 0.3s, transform 0.4s var(--spring); }
      .launcher[data-status="good"] .dot, .launcher[data-status="warn"] .dot, .launcher[data-status="bad"] .dot { opacity: 1; transform: none; }
      .launcher[data-status="good"] .dot { background: #34d399; }
      .launcher[data-status="warn"] .dot { background: #fbbf24; }
      .launcher[data-status="bad"] .dot { background: #fb7185; }
      .dock[data-size="small"] .dot { top: -1px; right: -1px; width: 11px; height: 11px; border-width: 2px; }

      .grip { position: absolute; top: 50%; width: 12px; height: 44px; margin-top: -22px; display: grid; place-items: center; opacity: 0; pointer-events: none; transition: opacity 0.2s; }
      .dock[data-edge="right"] .grip { left: 0; }
      .dock[data-edge="left"] .grip { right: 0; }
      .dock[data-size="small"] .grip { height: 34px; margin-top: -17px; }
      .grip svg { position: static; width: 6px; height: 11px; fill: none; stroke: #fff; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
      .dock[data-edge="left"] .grip svg { transform: scaleX(-1); }

      /* Tucked at the edge: only a sliver with a grip shows until pointed at, focused or pressed.
         (Pointing is tracked in script: a touch screen keeps :hover stuck after a tap.) */
      .dock[data-mode="edge"][data-awake="false"]:not(:has(.launcher:focus-visible)) {
        translate: var(--tuck, 0px) 0; transition: translate 0.4s var(--ease) 0.5s, left 0.3s var(--ease), top 0.3s var(--ease);
      }
      .dock[data-mode="edge"][data-awake="false"]:not(:has(.launcher:focus-visible)) :is(.die, .dot, .tip) { opacity: 0; }
      .dock[data-mode="edge"][data-awake="false"]:not(:has(.launcher:focus-visible)) .launcher::before { animation: none; }
      .dock[data-mode="edge"][data-awake="false"]:not(:has(.launcher:focus-visible)) .grip { opacity: 1; pointer-events: auto; }
      /* Faded: see-through until pointed at, focused, pressed, opened or alerting. */
      .dock[data-mode="faded"][data-awake="false"]:not(:has(.launcher:focus-visible)) .launcher[data-visible="true"] { opacity: 0.28; }

      .bubble {
        position: fixed; right: 18px; bottom: 84px; width: 270px; max-width: calc(100vw - 24px); padding: 12px 14px;
        border-radius: 16px; color: #eef0ff; background: #151833; border: 1px solid rgba(217, 70, 239, 0.6);
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55), 0 0 36px rgba(217, 70, 239, 0.3);
        font: 500 13px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; overflow-wrap: break-word;
        transform-origin: calc(100% - 28px) 100%; opacity: 0; visibility: hidden; transform: translate(var(--from-x, 0px), var(--from-y, 10px)) scale(0.9); pointer-events: none;
        transition: opacity 0.2s, transform 0.45s var(--spring), visibility 0s 0.45s;
      }
      .bubble[data-show="true"] { opacity: 1; visibility: visible; transform: none; pointer-events: auto; transition: opacity 0.2s, transform 0.55s var(--spring), visibility 0s; }
      .bubble strong { display: block; margin-bottom: 2px; font-size: 13.5px; color: #f5d0fe; }
      .bubble p { margin: 0 0 10px; color: #c5c9e6; }
      .bubble .bubble-note { margin: -4px 0 10px; font-size: 12px; font-weight: 600; color: #fda4af; }
      .bubble .bubble-note[data-tone="busy"] { color: #bae6fd; }
      .bubble-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      .bubble button { flex: 1 1 auto; min-height: 34px; padding: 0 12px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.18); font: 650 12.5px ui-sans-serif, system-ui, sans-serif; color: #eef0ff; background: rgba(255, 255, 255, 0.08); cursor: pointer; }
      .bubble button.go { border-color: transparent; background: linear-gradient(135deg, #d946ef, #8b6cff); color: #fff; }
      .bubble button:disabled { opacity: 0.65; cursor: progress; }
      .bubble button:focus-visible { outline: 2px solid #bde9ff; outline-offset: 2px; }
      .bubble button.details { display: block; min-height: 0; margin: 8px 0 0; padding: 2px 0; border: 0; border-radius: 4px; background: none; font: 600 12px/1.3 ui-sans-serif, system-ui, sans-serif; color: #c4b5fd; text-decoration: underline; text-underline-offset: 2px; }
      .bubble [hidden] { display: none !important; }
      .bubble[data-kind="update"] { border-color: rgba(56, 189, 248, 0.55); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55), 0 0 36px rgba(99, 102, 241, 0.32); }
      .bubble[data-kind="update"] strong { color: #c7d2fe; }
      .bubble[data-kind="update"] button.go { background: linear-gradient(135deg, #8b6cff, #4f8cff 60%, #38bdf8); }

      .tip {
        position: absolute; right: calc(100% + 12px); top: 50%; width: max-content; max-width: 260px; pointer-events: none; text-align: start;
        padding: 7px 11px; border-radius: 10px; font: 600 12px/1.25 ui-sans-serif, system-ui, sans-serif; color: #eef0ff;
        background: #151833; border: 1px solid rgba(255, 255, 255, 0.14); box-shadow: 0 8px 22px rgba(0, 0, 0, 0.4);
        opacity: 0; transform: translate(8px, -50%); transition: opacity 0.2s, transform 0.3s var(--spring);
      }
      .tip-main, .tip-hint { display: block; }
      .tip-hint { margin-top: 3px; font-weight: 500; font-size: 11px; color: #a4abd3; }
      .tip-hint:empty { display: none; }
      .dock[data-edge="left"] .tip { right: auto; left: calc(100% + 12px); transform: translate(-8px, -50%); }
      .launcher:hover .tip, .launcher:focus-visible .tip { opacity: 1; transform: translate(0, -50%); }
      .launcher[aria-expanded="true"] .tip, .dock[data-dragging="true"] .tip { display: none; }
      @media (hover: none) { .tip { display: none; } }

      .panel {
        position: fixed; right: 18px; bottom: 84px; width: 400px; max-width: calc(100vw - 24px);
        height: min(640px, calc(100vh - 104px)); height: min(640px, calc(100dvh - 104px)); min-height: 280px;
        overflow: hidden; border-radius: 22px; background: #090a16;
        border: 1px solid rgba(255, 255, 255, 0.14);
        box-shadow: 0 34px 90px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(139, 108, 255, 0.18), 0 0 60px rgba(120, 92, 255, 0.18);
        transform-origin: calc(100% - 32px) 100%;
        opacity: 0; visibility: hidden; transform: translate(var(--from-x, 0px), var(--from-y, 20px)) scale(0.88); pointer-events: none;
        transition: opacity 0.25s var(--ease), transform 0.4s var(--ease), visibility 0s 0.4s;
      }
      .panel[data-open="true"] {
        opacity: 1; visibility: visible; transform: none; pointer-events: auto;
        transition: opacity 0.25s var(--ease), transform 0.55s var(--spring), visibility 0s;
      }
      iframe { display: block; width: 100%; height: 100%; border: 0; background: #090a16; color-scheme: dark; }

      .scene[data-theme="light"] .bubble, .scene[data-theme="light"] .tip { color: #1b1e3a; background: #fff; border-color: rgba(120, 70, 210, 0.4); box-shadow: 0 14px 36px rgba(40, 40, 90, 0.22); }
      .scene[data-theme="light"] .bubble strong { color: #a21caf; }
      .scene[data-theme="light"] .bubble p { color: #4a5170; }
      .scene[data-theme="light"] .bubble .bubble-note { color: #be123c; }
      .scene[data-theme="light"] .bubble .bubble-note[data-tone="busy"] { color: #0369a1; }
      .scene[data-theme="light"] .bubble button { color: #1b1e3a; background: rgba(27, 30, 58, 0.06); border-color: rgba(27, 30, 58, 0.2); }
      .scene[data-theme="light"] .bubble button.go { color: #fff; background: linear-gradient(135deg, #d946ef, #8b6cff); border-color: transparent; }
      .scene[data-theme="light"] .bubble button.details { color: #5b43d6; background: none; }
      .scene[data-theme="light"] .bubble[data-kind="update"] { border-color: rgba(59, 130, 246, 0.45); }
      .scene[data-theme="light"] .bubble[data-kind="update"] strong { color: #4338ca; }
      .scene[data-theme="light"] .bubble[data-kind="update"] button.go { background: linear-gradient(135deg, #8b6cff, #4f8cff 60%, #38bdf8); }
      .scene[data-theme="light"] .tip-hint { color: #4a5170; }
      .scene[data-theme="light"] .panel, .scene[data-theme="light"] iframe { background: #f3f4fb; color-scheme: light; }
      .scene[data-theme="light"] .panel { border-color: rgba(27, 30, 58, 0.16); box-shadow: 0 30px 80px rgba(40, 40, 90, 0.3), 0 0 0 1px rgba(139, 108, 255, 0.2); }
      .scene[data-theme="light"] .dot { border-color: #fff; }

      /* Used only until the position is worked out (and if the geometry helper is missing). */
      @media (max-width: 480px) {
        .dock { right: 14px; bottom: 14px; }
        .panel { right: 12px; left: 12px; width: auto; max-width: none; bottom: 78px; }
        .bubble { right: 12px; bottom: 78px; }
      }
      @media (max-height: 520px) { .panel { bottom: 12px; right: 84px; height: calc(100vh - 24px); } }

      @keyframes launcher-in { from { opacity: 0; transform: scale(0.3) translateY(24px); } to { opacity: 1; transform: none; } }
      @keyframes ring { 0% { transform: scale(0.9); opacity: 0.75; } 100% { transform: scale(1.45); opacity: 0; } }
      @keyframes ring-alert { 0% { transform: scale(0.95); opacity: 0.95; } 100% { transform: scale(1.7); opacity: 0; } }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; transition-delay: 0ms !important; }
      }
    </style>
    <div class="scene no-anim">
      <div class="panel" id="panel" role="dialog" data-open="false" inert></div>
      <div class="bubble" role="status" data-show="false" data-kind="glitch" inert>
        <strong class="bubble-title"></strong>
        <p class="bubble-text"></p>
        <p class="bubble-note" hidden></p>
        <div class="bubble-actions"><button class="go" type="button"></button><button class="later" type="button"></button></div>
        <button class="details" type="button" hidden></button>
      </div>
      <div class="dock" data-mode="normal" data-size="normal" data-edge="right" data-awake="false" data-dragging="false">
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
          <span class="grip" aria-hidden="true"><svg viewBox="0 0 8 14"><path d="M6 2 2 7l4 5"></path></svg></span>
          <span class="tip" aria-hidden="true"><span class="tip-main"></span><span class="tip-hint"></span></span>
        </button>
      </div>
    </div>`;

  const scene = root.querySelector(".scene");
  const dock = root.querySelector(".dock");
  const launcher = root.querySelector(".launcher");
  const panel = root.querySelector(".panel");
  const tipMain = root.querySelector(".tip-main");
  const tipHint = root.querySelector(".tip-hint");
  const bubble = root.querySelector(".bubble");
  const bubbleTitle = bubble.querySelector(".bubble-title");
  const bubbleText = bubble.querySelector(".bubble-text");
  const bubbleNote = bubble.querySelector(".bubble-note");
  const goButton = bubble.querySelector(".go");
  const laterButton = bubble.querySelector(".later");
  const detailsButton = bubble.querySelector(".details");

  // Keep keystrokes made on our button from reaching the game's own shortcuts.
  for (const type of ["keydown", "keyup", "keypress"]) {
    host.addEventListener(type, (event) => event.stopPropagation());
  }
  // Presses, drags and clicks that start on our controls stay ours: the game never sees them. Moves
  // and releases are only held back during such a press, so a drag in the game that ends over the
  // button still reaches the game.
  let gesture = false;
  let gestureTimer = 0;
  for (const type of ["pointerdown", "mousedown", "touchstart"]) {
    host.addEventListener(type, (event) => {
      gesture = true;
      clearTimeout(gestureTimer);
      event.stopPropagation();
    });
  }
  for (const type of ["pointermove", "mousemove", "touchmove", "pointerup", "mouseup", "touchend", "pointercancel", "touchcancel"]) {
    host.addEventListener(type, (event) => {
      if (!gesture) return;
      event.stopPropagation();
      if (/up|end|cancel/.test(type)) {
        clearTimeout(gestureTimer);
        gestureTimer = setTimeout(() => { gesture = false; }, 0);
      }
    });
  }
  for (const type of ["click", "dblclick"]) host.addEventListener(type, (event) => event.stopPropagation());

  const themeOf = (prefs) => (prefs?.theme === "light" || prefs?.theme === "dark" ? prefs.theme : "auto");
  const resolvedTheme = () => (state.theme === "auto" ? (lightQuery.matches ? "light" : "dark") : state.theme);
  lightQuery.addEventListener("change", () => render());

  // Same rules as normalizeUiPrefs' launcher group in ui-prefs.js (content scripts cannot import it).
  function launcherPrefsOf(prefs) {
    const value = prefs?.launcher;
    return {
      mode: MODES.includes(value?.mode) ? value.mode : "normal",
      size: SIZES.includes(value?.size) ? value.size : "normal",
      pos: geo ? geo.normalizePos(value?.pos) : null,
    };
  }

  // Sounds and the tab-title flash are asked for by the background worker (alerts, auto-buy results).
  let flashTimer = null;
  let flashTitleBefore = "";
  function stopFlash() {
    if (!flashTimer) return;
    clearInterval(flashTimer);
    flashTimer = null;
    document.title = flashTitleBefore;
  }
  function flashTitle(text) {
    if (!document.hidden) return;
    stopFlash();
    flashTitleBefore = document.title;
    const started = Date.now();
    let on = false;
    flashTimer = setInterval(() => {
      if (Date.now() - started > 60000) { stopFlash(); return; }
      on = !on;
      document.title = on ? `🔔 ${text}` : flashTitleBefore;
    }, 1000);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) stopFlash(); });

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || !message) return;
    if (message.type === "HELPER_SOUND" && typeof message.name === "string") {
      globalThis.shopHelperSound?.play(message.name, message.volume);
      host.dataset.lastSound = message.name;
    } else if (message.type === "HELPER_FLASH" && typeof message.text === "string") {
      flashTitle(message.text.slice(0, 80));
    }
  });

  function cleanAlert(value) {
    return value && typeof value.key === "string" && Array.isArray(value.ids) && value.ids.length ? value : null;
  }

  // The update checker's saved state (written by the background worker; may not exist yet).
  function pendingUpdate(value) {
    if (!value || typeof value !== "object" || value.status !== "available") return null;
    const latest = value.latest;
    if (!latest || typeof latest !== "object" || typeof latest.version !== "string" || !latest.version) return null;
    if (latest.version === value.dismissedVersion) return null;
    const done = value.downloaded;
    if (done && typeof done === "object" && done.version === latest.version && done.state !== "interrupted") return null;
    const name = typeof latest.versionName === "string" && latest.versionName.trim() ? latest.versionName.trim() : latest.version;
    return { version: latest.version, name: name.slice(0, 40) };
  }

  function ensureFrame() {
    if (frame) return;
    frame = document.createElement("iframe");
    frame.title = t("overlay.menuLabel");
    frame.src = frameUrl;
    panel.append(frame);
  }

  function statusKey() {
    if (!state.enabled) return "off";
    if (state.run === "error") return "bad";
    if (state.run === "waiting") return "warn";
    return "good";
  }

  // ---------- where things go ----------

  let current = null;
  let dragPoint = null;
  let press = null;
  const px = (value) => `${value}px`;

  function viewport() {
    const el = document.documentElement;
    const standards = document.compatMode === "CSS1Compat" && el;
    const vw = standards && el.clientWidth > 0 ? Math.min(window.innerWidth, el.clientWidth) : window.innerWidth;
    const vh = standards && el.clientHeight > 0 ? Math.min(window.innerHeight, el.clientHeight) : window.innerHeight;
    return { vw, vh };
  }

  function layout() {
    if (!geo) return;
    const { vw, vh } = viewport();
    const size = geo.sizeOf(state.size);
    const point = dragPoint ?? geo.restingPoint(state.pos, state.mode, vw, vh, size);
    const edge = dragPoint ? geo.edgeOfPoint(dragPoint, vw, size) : geo.edgeOf(state.pos);
    current = { left: point.left, top: point.top, size };
    Object.assign(dock.style, { left: px(point.left), top: px(point.top), right: "auto", bottom: "auto" });
    dock.style.setProperty("--tuck", px(geo.tuckShift(edge, point.left, vw, size)));
    dock.dataset.edge = edge;

    // The menu and the prompt open next to the button, or from the default corner while it is hidden.
    const anchor = state.launcher ? { ...point, size } : { ...geo.defaultPoint(vw, vh, size), size };
    const place = geo.panelPlacement({ button: anchor, vw, vh });
    Object.assign(panel.style, {
      left: px(place.left), top: px(place.top), width: px(place.width), height: px(place.height),
      right: "auto", bottom: "auto", maxWidth: "none", minHeight: "0", transformOrigin: `${place.originX}px ${place.originY}px`,
    });
    panel.style.setProperty("--from-x", px(place.fromX));
    panel.style.setProperty("--from-y", px(place.fromY));
    panel.dataset.side = place.side;

    bubble.style.width = px(Math.min(geo.BUBBLE_WIDTH, Math.max(0, vw - 2 * geo.EDGE)));
    const spot = geo.bubblePlacement({ button: anchor, vw, vh, height: bubble.offsetHeight });
    Object.assign(bubble.style, {
      left: px(spot.left), top: px(spot.top), width: px(spot.width), right: "auto", bottom: "auto", maxWidth: "none",
      transformOrigin: `${spot.originX}px ${spot.originY}px`,
    });
    bubble.style.setProperty("--from-x", px(spot.fromX));
    bubble.style.setProperty("--from-y", px(spot.fromY));
    bubble.dataset.side = spot.side;
  }

  // Faded and tucked buttons come fully into view while something needs the player.
  function syncAwake() {
    const alerting = state.launcher && (!!state.alert || !!state.update);
    dock.dataset.awake = String(state.open || alerting || state.peek || state.hover || !!press?.moved);
  }

  function fillBubble(kind) {
    bubble.dataset.kind = kind;
    if (kind === "glitch") {
      bubbleTitle.textContent = t("overlay.glitchTitle");
      bubbleText.textContent = t("overlay.glitchText", { count: state.alert.ids.length });
      bubbleNote.hidden = true;
      goButton.textContent = t("overlay.glitchOpen");
      goButton.disabled = false;
      laterButton.textContent = t("overlay.glitchDismiss");
      detailsButton.hidden = true;
      return;
    }
    bubbleTitle.textContent = t("overlay.updateTitle");
    bubbleText.textContent = t("overlay.updateText", { version: state.update.name });
    const note = {
      downloading: () => t("overlay.updateDownloading"), started: () => t("overlay.updateStarted"), failed: () => t("overlay.updateFailed"),
    }[state.updateNote];
    bubbleNote.hidden = !note;
    bubbleNote.textContent = note ? note() : "";
    bubbleNote.dataset.tone = state.updateNote === "failed" ? "bad" : "busy";
    goButton.textContent = t("overlay.updateDownload");
    goButton.disabled = state.updateNote === "downloading" || state.updateNote === "started";
    laterButton.textContent = t("overlay.updateLater");
    detailsButton.textContent = t("overlay.updateDetails");
    detailsButton.hidden = false;
  }

  function render() {
    const open = state.open;
    if (open) ensureFrame();
    const status = statusKey();
    launcher.dataset.visible = String(state.launcher);
    launcher.dataset.status = status;
    launcher.tabIndex = state.launcher ? 0 : -1;
    launcher.setAttribute("aria-expanded", String(open));
    launcher.setAttribute("aria-label", open ? t("overlay.hideMenu") : t("overlay.openMenu"));
    if (geo) launcher.setAttribute("aria-description", t("overlay.moveHint"));
    scene.dataset.theme = resolvedTheme();
    panel.setAttribute("aria-label", t("overlay.menuLabel"));
    if (frame) frame.title = t("overlay.menuLabel");

    const alerting = state.launcher && !!state.alert;
    const updating = state.launcher && !!state.update;
    launcher.dataset.alert = String(alerting);
    launcher.dataset.update = String(updating && !alerting);
    tipMain.textContent = alerting ? t("overlay.tipGlitch")
      : updating ? t("overlay.tipUpdate", { version: state.update.name })
        : state.enabled ? t("overlay.tipOn", { version: versionLabel }) : t("overlay.tipOff", { version: versionLabel });
    tipHint.textContent = geo ? t("overlay.dragHint") : "";

    // Glitch's prompt comes first; the update prompt waits until his is gone.
    const glitchPrompt = alerting && !open && state.alert.key !== state.seen;
    const updatePrompt = !glitchPrompt && updating && !open && state.update.version !== state.updateSeen;
    if (glitchPrompt) fillBubble("glitch");
    else if (updatePrompt) fillBubble("update");
    const showBubble = glitchPrompt || updatePrompt;
    if (!showBubble && bubble.contains(root.activeElement) && state.launcher) launcher.focus({ preventScroll: true });
    bubble.dataset.show = String(showBubble);
    bubble.inert = !showBubble;
    panel.dataset.open = String(open);
    panel.inert = !open;
    dock.dataset.mode = state.mode;
    dock.dataset.size = state.size;
    syncAwake();
    layout();
  }

  function save(values) {
    try { chrome.storage.local.set(values).catch(() => {}); } catch { /* extension was reloaded */ }
  }

  // Writes the whole preferences object back, changing only the button's position.
  async function savePos(pos) {
    try {
      const { uiPrefs } = await chrome.storage.local.get("uiPrefs");
      const base = uiPrefs && typeof uiPrefs === "object" && !Array.isArray(uiPrefs) ? uiPrefs : {};
      const launcherPrefs = { ...launcherPrefsOf(base), pos: geo.normalizePos(pos) };
      await chrome.storage.local.set({ uiPrefs: { ...base, launcher: launcherPrefs } });
    } catch { /* extension was reloaded */ }
  }

  function setOpen(open) {
    state.open = open;
    render();
    save({ uiOpen: open });
    if (open) setTimeout(() => frame?.focus(), 220);
  }

  // ---------- moving the button ----------

  let peekTimer = 0;
  let clickBlockedUntil = 0;
  let keySaveTimer = 0;
  const blockSelection = (event) => event.preventDefault();

  function setPeek(on, holdMs = 0) {
    clearTimeout(peekTimer);
    if (!on && holdMs > 0) {
      peekTimer = setTimeout(() => setPeek(false), holdMs);
      return;
    }
    state.peek = on;
    syncAwake();
  }

  // A mouse or pen pointing at the button wakes it; a finger uses the press below instead.
  launcher.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "touch") return;
    state.hover = true;
    syncAwake();
  });
  launcher.addEventListener("pointerleave", (event) => {
    if (!state.hover) return;
    state.hover = false;
    syncAwake();
  });

  launcher.addEventListener("pointerdown", (event) => {
    if (!geo || !current || !state.launcher || press) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, left: current.left, top: current.top, moved: false };
    try { launcher.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ }
    document.addEventListener("selectstart", blockSelection, true);
    setPeek(true);
  });

  launcher.addEventListener("pointermove", (event) => {
    if (!press || event.pointerId !== press.id) return;
    const dx = event.clientX - press.x;
    const dy = event.clientY - press.y;
    if (!press.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      press.moved = true;
      dock.dataset.dragging = "true";
      syncAwake();
    }
    event.preventDefault();
    const { vw, vh } = viewport();
    dragPoint = geo.clampPoint({ left: press.left + dx, top: press.top + dy }, vw, vh, current.size);
    layout();
  });

  function endPress(event, cancelled) {
    if (!press || event.pointerId !== press.id) return;
    const moved = press.moved;
    press = null;
    document.removeEventListener("selectstart", blockSelection, true);
    try { launcher.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    dock.dataset.dragging = "false";
    if (moved) {
      // The click that follows a drag must not open or close the menu.
      clickBlockedUntil = performance.now() + 400;
      if (!cancelled && dragPoint) {
        const { vw, vh } = viewport();
        const size = geo.sizeOf(state.size);
        state.pos = geo.posFromPoint(geo.snapPoint(dragPoint, vw, vh, size, state.mode), vw, vh, size);
        void savePos(state.pos);
      }
      dragPoint = null;
      layout();
    }
    // A finger has no hover, so a touched button stays out for a moment.
    setPeek(false, event.pointerType === "mouse" ? 0 : 1600);
  }
  launcher.addEventListener("pointerup", (event) => endPress(event, false));
  launcher.addEventListener("pointercancel", (event) => endPress(event, true));
  launcher.addEventListener("lostpointercapture", (event) => endPress(event, false));

  // Shift + arrow keys move the focused button (Shift + Alt: bigger steps).
  launcher.addEventListener("keydown", (event) => {
    if (!geo || !current || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!step) return;
    event.preventDefault();
    const { vw, vh } = viewport();
    const size = geo.sizeOf(state.size);
    const distance = event.altKey ? KEY_STEP_BIG : KEY_STEP;
    const next = { left: current.left + step[0] * distance, top: current.top + step[1] * distance };
    // Tucked at the edge, left and right hop between the two edges.
    if (state.mode === "edge" && step[0]) next.left = step[0] < 0 ? 0 : vw;
    state.pos = geo.posFromPoint(geo.clampPoint(next, vw, vh, size), vw, vh, size);
    layout();
    clearTimeout(keySaveTimer);
    keySaveTimer = setTimeout(() => void savePos(state.pos), 300);
  });

  launcher.addEventListener("click", () => {
    if (performance.now() < clickBlockedUntil) {
      clickBlockedUntil = 0;
      return;
    }
    setOpen(!state.open);
  });

  // ---------- the prompt ----------

  async function downloadUpdate() {
    const version = state.update?.version;
    if (!version || state.updateNote === "downloading") return;
    state.updateNote = "downloading";
    render();
    let reply = null;
    try { reply = await chrome.runtime.sendMessage({ type: "UPDATE_DOWNLOAD" }); } catch { reply = null; }
    if (state.update?.version !== version) return;
    if (reply?.ok === true) {
      state.updateNote = "started";
      render();
      setTimeout(() => {
        if (state.update?.version === version) state.updateSeen = version;
        state.updateNote = "";
        render();
      }, 4000);
    } else {
      state.updateNote = "failed";
      render();
    }
  }

  function dismissUpdate() {
    state.updateSeen = state.update?.version ?? "";
    state.updateNote = "";
    render();
    try { chrome.runtime.sendMessage({ type: "UPDATE_DISMISS" }).catch(() => {}); } catch { /* extension was reloaded */ }
  }

  goButton.addEventListener("click", () => {
    if (bubble.dataset.kind === "update") { void downloadUpdate(); return; }
    state.seen = state.alert?.key ?? "";
    save({ uiTab: "glitch" });
    setOpen(true);
  });
  laterButton.addEventListener("click", () => {
    if (bubble.dataset.kind === "update") { dismissUpdate(); return; }
    state.seen = state.alert?.key ?? "";
    render();
  });
  detailsButton.addEventListener("click", () => {
    state.updateSeen = state.update?.version ?? "";
    setOpen(true);
  });

  function closeFromInside() {
    setOpen(false);
    if (state.launcher) launcher.focus();
  }
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.open) closeFromInside();
  });

  function onMessage(event) {
    if (!frame || event.source !== frame.contentWindow || event.origin !== frameOrigin) return;
    const data = event.data;
    if (data && data.source === "rngidle-shop-helper" && data.type === "hide") closeFromInside();
  }
  window.addEventListener("message", onMessage);

  let resizeTimer = 0;
  function onResize() {
    dock.dataset.instant = "true";
    layout();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { dock.dataset.instant = "false"; }, 200);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("message", onMessage);
    window.removeEventListener("resize", onResize);
    document.removeEventListener("selectstart", blockSelection, true);
    stopI18n?.();
    host.remove();
  }

  function onStorageChanged(changes, area) {
    if (area !== "local") return;
    if (!chrome.runtime?.id) { dispose(); return; }
    if (changes.uiLauncher) {
      const visible = changes.uiLauncher.newValue !== false;
      // Turning the button off (footer switch or Settings) while the menu is open closes the menu
      // as well, as it always has. Afterwards the shortcut can still open the menu without it.
      if (state.launcher && !visible && state.open && !changes.uiOpen) {
        state.open = false;
        save({ uiOpen: false });
      }
      state.launcher = visible;
    }
    if (changes.uiOpen) {
      const next = changes.uiOpen.newValue === true;
      // Opened from elsewhere (the shortcut): take keyboard focus if this is the tab in use.
      if (next && !state.open && !document.hidden && document.hasFocus()) setTimeout(() => frame?.focus(), 220);
      state.open = next;
    }
    if (changes.glitchAlert) state.alert = cleanAlert(changes.glitchAlert.newValue);
    if (changes.uiPrefs) {
      state.theme = themeOf(changes.uiPrefs.newValue);
      Object.assign(state, launcherPrefsOf(changes.uiPrefs.newValue));
    }
    if (changes.updateState) {
      const next = pendingUpdate(changes.updateState.newValue);
      if (next?.version !== state.update?.version) state.updateNote = "";
      state.update = next;
    }
    if (changes.settings) state.enabled = changes.settings.newValue?.enabled === true;
    if (changes.runStatus) state.run = changes.runStatus.newValue?.state ?? "";
    render();
  }

  document.documentElement.append(host);

  Promise.all([
    chrome.storage.local.get(["uiLauncher", "uiOpen", "settings", "runStatus", "glitchAlert", "uiPrefs", "updateState"]),
    i18n?.ready,
  ]).then(([saved]) => {
    if (disposed) return;
    state.alert = cleanAlert(saved.glitchAlert);
    state.theme = themeOf(saved.uiPrefs);
    Object.assign(state, launcherPrefsOf(saved.uiPrefs));
    state.update = pendingUpdate(saved.updateState);
    state.launcher = saved.uiLauncher !== false;
    // The menu can be open without the button (opened with the keyboard shortcut).
    state.open = saved.uiOpen === true;
    state.enabled = saved.settings?.enabled === true;
    state.run = saved.runStatus?.state ?? "";
    render();
    chrome.storage.onChanged.addListener(onStorageChanged);
    window.addEventListener("resize", onResize);
    stopI18n = i18n?.onChange?.(() => render()) ?? null;
    // Enable transitions only after the first paint so a saved "open" state doesn't animate on load.
    requestAnimationFrame(() => requestAnimationFrame(() => scene.classList.remove("no-anim")));
  }).catch(() => dispose());
})();

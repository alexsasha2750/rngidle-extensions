"use strict";

// Tabs, version label, in-game panel controls and other UI-only behaviour.
// Purchase logic and settings live in popup.js; nothing here talks to the game.
(() => {
  const storage = chrome.storage.local;
  const embedded = document.documentElement.dataset.mode === "embedded";
  const PARENT_ORIGIN = "https://rngidle.fun";

  function setupTabs(tablist, storageKey, { onUserSelect } = {}) {
    const tabs = [...tablist.querySelectorAll('[role="tab"]')];
    const panelOf = (tab) => document.getElementById(tab.getAttribute("aria-controls"));
    let current = Math.max(0, tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true"));

    function select(index, { animate = true, persist = true } = {}) {
      index = Math.min(Math.max(index, 0), tabs.length - 1);
      const direction = index >= current ? 1 : -1;
      tabs.forEach((tab, i) => {
        const active = i === index;
        const panel = panelOf(tab);
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        if (!panel) return;
        panel.classList.remove("is-active", "entering");
        if (!active) {
          panel.hidden = true;
          return;
        }
        panel.hidden = false;
        panel.classList.add("is-active");
        if (animate && i !== current) {
          panel.style.setProperty("--dir", String(direction));
          panel.classList.add("entering");
          panel.addEventListener("animationend", () => panel.classList.remove("entering"), { once: true });
        }
      });
      tablist.dataset.index = String(index);
      current = index;
      if (persist) storage.set({ [storageKey]: tabs[index].dataset.tab }).catch(() => {});
    }

    tablist.addEventListener("click", (event) => {
      const tab = event.target.closest('[role="tab"]');
      if (!tab) return;
      select(tabs.indexOf(tab));
      onUserSelect?.(tab, event);
    });

    tablist.addEventListener("keydown", (event) => {
      const keys = { ArrowRight: 1, ArrowLeft: -1, Home: "first", End: "last" };
      if (!(event.key in keys)) return;
      event.preventDefault();
      const step = keys[event.key];
      const next = step === "first" ? 0 : step === "last" ? tabs.length - 1
        : (current + step + tabs.length) % tabs.length;
      select(next);
      tabs[next].focus();
    });

    return {
      restore(tabName) {
        const index = tabs.findIndex((tab) => tab.dataset.tab === tabName);
        if (index >= 0 && index !== current) select(index, { animate: false, persist: false });
      },
    };
  }

  const checkerInput = document.getElementById("number-checker-input");
  const mainTabs = setupTabs(document.querySelector(".tabs"), "uiTab", {
    onUserSelect(tab, event) {
      // A mouse click on the checker tab goes straight to typing; keyboard users keep their place.
      if (tab.dataset.tab === "checker" && event.detail > 0) checkerInput.focus({ preventScroll: true });
    },
  });
  const subTabs = setupTabs(document.querySelector(".subtabs"), "uiSubtab", {
    onUserSelect() {
      // If the page was scrolled past the shop switcher, bring the new list back to the top.
      const bar = document.querySelector(".subtabs");
      if (bar.getBoundingClientRect().top < document.querySelector(".viewport").getBoundingClientRect().top) {
        bar.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    },
  });

  storage.get(["uiTab", "uiSubtab"]).then((saved) => {
    mainTabs.restore(saved.uiTab);
    subTabs.restore(saved.uiSubtab);
  }).catch(() => {});

  // Version label.
  const manifest = chrome.runtime.getManifest();
  const versionPill = document.getElementById("app-version");
  versionPill.textContent = manifest.version_name || `v${manifest.version}`;
  versionPill.title = `Extension version ${manifest.version}`;

  // Tapping an example fills the field and runs the check.
  document.getElementById("number-checker-examples").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-example]");
    if (!chip) return;
    checkerInput.value = chip.dataset.example;
    document.getElementById("number-checker-form").requestSubmit();
  });

  // Show/hide the floating in-game button.
  const launcherToggle = document.getElementById("launcher-toggle");
  storage.get("uiLauncher").then(({ uiLauncher }) => {
    launcherToggle.checked = uiLauncher !== false;
  }).catch(() => {});
  launcherToggle.addEventListener("change", () => {
    storage.set({ uiLauncher: launcherToggle.checked }).catch(() => {});
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.uiLauncher) launcherToggle.checked = changes.uiLauncher.newValue !== false;
  });

  // Controls that only exist inside the game page.
  if (embedded) {
    const hideButton = document.getElementById("hide-panel");
    const hide = () => window.parent.postMessage({ source: "rngidle-shop-helper", type: "hide" }, PARENT_ORIGIN);
    hideButton.hidden = false;
    hideButton.addEventListener("click", hide);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.target instanceof HTMLElement && event.target.matches("input, select, textarea")) return;
      hide();
    });
    document.querySelector(".footer-note").textContent = "Stays open while you play";
  }
})();

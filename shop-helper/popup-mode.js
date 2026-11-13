// Runs before first paint so the page is sized for the toolbar popup or the in-game panel.
document.documentElement.dataset.mode =
  new URLSearchParams(location.search).get("embedded") === "1" ? "embedded" : "popup";

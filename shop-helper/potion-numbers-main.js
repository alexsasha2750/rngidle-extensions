// "Show potion numbers": a potion's result chip in the bulk-roll potion table says only how much EP
// its best number reached ("… · best 1.2M EP") when hovered, though the game keeps the number itself
// (variant and badge potions alike). With the setting on, this adds " · number …" right after that
// EP figure. It runs in the page's own world to read the game's potion log and only rewrites
// hover text: nothing is sent to the game and nothing it computes is changed.
// potion-numbers.js (extension world) switches it with the data attribute below.
(() => {
  const ATTR = 'data-shop-helper-potion-numbers';
  const MARK = 'shNumber';

  function suffixFor(entry) {
    const number = entry?.best?.number;
    return typeof number === 'string' && number.trim() ? ` · number ${number.trim().slice(0, 60)}` : '';
  }

  // The chips on screen are the last few entries of the log, oldest first. Adding is idempotent
  // and `on = false` takes our text back out.
  function retitle(chips, log, on) {
    if (!chips.length || !Array.isArray(log)) return;
    const entries = log.slice(Math.max(0, log.length - chips.length));
    chips.forEach((chip, index) => {
      const added = chip.dataset?.[MARK] || '';
      let title = chip.getAttribute('title') || '';
      if (added && title.endsWith(added)) title = title.slice(0, -added.length);
      const suffix = on && title ? suffixFor(entries[index]) : '';
      if (chip.getAttribute('title') !== title + suffix) chip.setAttribute('title', title + suffix);
      if (suffix) chip.dataset[MARK] = suffix; else delete chip.dataset[MARK];
    });
  }

  function apply(log, on) {
    for (const history of document.querySelectorAll('.pt-history')) {
      retitle([...history.children].filter(node => node.classList.contains('pt-chip') && !node.classList.contains('pt-chip-more')), log, on);
    }
  }

  globalThis.shopHelperPotionNumbers = { suffixFor, retitle };
  if (typeof document === 'undefined' || !document.documentElement || typeof MutationObserver === 'undefined') return;

  const root = document.documentElement;
  const enabled = () => root.getAttribute(ATTR) === '1';
  let stop = null;
  let starting = false;

  async function start() {
    if (stop || starting) return;
    starting = true;
    let game;
    try { game = await import('/item-cast.js'); } catch { game = null; }
    starting = false;
    if (!game || typeof game.modsNow !== 'function' || typeof game.onModsChange !== 'function' || !enabled() || stop) return;
    let frame = 0;
    const run = () => { frame = 0; apply(game.modsNow()?.log, true); };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(run); };
    const off = game.onModsChange(schedule);
    const observer = new MutationObserver(schedule);
    observer.observe(document.body || root, { childList: true, subtree: true, attributes: true, attributeFilter: ['title'] });
    stop = () => {
      off();
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      apply(game.modsNow()?.log, false);
      stop = null;
    };
    schedule();
  }

  const sync = () => { if (enabled()) void start(); else stop?.(); };
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: [ATTR] });
  sync();
})();

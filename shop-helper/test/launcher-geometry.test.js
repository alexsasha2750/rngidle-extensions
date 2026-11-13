import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { LAUNCHER_MODES, LAUNCHER_SIZES, normalizeLauncherPos } from '../ui-prefs.js';

await import('../launcher-geometry.js');
const geo = globalThis.shopHelperLauncherGeometry;
const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');

const VIEWPORTS = [[320, 568], [400, 700], [1100, 800], [1920, 1080], [640, 360]];
const DESKTOPS = [[1100, 800], [1920, 1080]];
const CORNERS = { 'top-left': { x: 0, y: 0 }, 'top-right': { x: 1, y: 0 }, 'bottom-left': { x: 0, y: 1 }, 'bottom-right': { x: 1, y: 1 } };
const SPOTS = {
  ...CORNERS,
  'left edge': { x: 0, y: 0.5 }, 'right edge': { x: 1, y: 0.5 }, 'top edge': { x: 0.5, y: 0 }, 'bottom edge': { x: 0.5, y: 1 },
  middle: { x: 0.5, y: 0.5 }, default: null,
};
const SIZES = Object.keys(geo.SIZES);
const MODES = ['normal', 'faded', 'edge'];
const buttonAt = (pos, vw, vh, size, mode = 'normal') => ({ ...geo.restingPoint(pos, mode, vw, vh, geo.sizeOf(size)), size: geo.sizeOf(size) });
const box = place => ({ left: place.left, top: place.top, width: place.width, height: place.height });
const overlaps = (a, b) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
const asBox = button => ({ left: button.left, top: button.top, width: button.size, height: button.size });

test('positions are cleaned exactly like the saved preferences', () => {
  const samples = [null, undefined, {}, { x: 0.2 }, { y: 0.3 }, { x: 2, y: -1 }, { x: '0.25', y: '0.5' }, { x: 'left', y: 0.5 },
    { x: null, y: null }, { x: NaN, y: 0 }, { x: Infinity, y: 0.5 }, { x: 0.999, y: 0.001 }, 'corner', 7];
  for (const sample of samples) assert.deepEqual(geo.normalizePos(sample), normalizeLauncherPos(sample), JSON.stringify(sample));
});

test('the default corner is where the button has always been', () => {
  assert.deepEqual(geo.pointFromPos(null, 1100, 800, 54), { left: 1100 - 18 - 54, top: 800 - 18 - 54 });
  assert.deepEqual(geo.pointFromPos(null, 1920, 1080, 36), { left: 1920 - 18 - 36, top: 1080 - 18 - 36 });
  assert.deepEqual(geo.pointFromPos(null, 320, 568, 54), { left: 320 - 14 - 54, top: 568 - 14 - 54 }, 'phones keep the closer corner');
  assert.equal(geo.sizeOf('small'), 36);
  assert.equal(geo.sizeOf('huge'), 54);
});

test('fractions of the free space round-trip to pixels and back', () => {
  for (const [vw, vh] of VIEWPORTS) {
    for (const size of SIZES.map(geo.sizeOf)) {
      const free = geo.freeSpace(vw, vh, size);
      assert.deepEqual(free, { width: vw - size - 12, height: vh - size - 12 });
      for (const x of [0, 0.25, 0.5, 0.8, 1]) {
        for (const y of [0, 0.33, 1]) {
          const point = geo.pointFromPos({ x, y }, vw, vh, size);
          const back = geo.posFromPoint(point, vw, vh, size);
          // Pixels are whole and fractions keep 4 decimals, so a round trip is off by under a pixel.
          assert.ok(Math.abs(back.x - x) * free.width < 1, `${vw}x${vh} x=${x}`);
          assert.ok(Math.abs(back.y - y) * free.height < 1, `${vw}x${vh} y=${y}`);
          assert.deepEqual(geo.pointFromPos(back, vw, vh, size), point);
        }
      }
      assert.deepEqual(geo.pointFromPos({ x: 0, y: 0 }, vw, vh, size), { left: 6, top: 6 });
      assert.deepEqual(geo.pointFromPos({ x: 1, y: 1 }, vw, vh, size), { left: vw - 6 - size, top: vh - 6 - size });
    }
  }
});

test('a saved spot keeps its place when the window is resized', () => {
  const pos = geo.posFromPoint({ left: 300, top: 200 }, 1100, 800, 54);
  const bigger = geo.pointFromPos(pos, 1920, 1080, 54);
  assert.ok(Math.abs((bigger.left - 6) / (1920 - 66) - (300 - 6) / (1100 - 66)) < 0.001);
  const tiny = geo.pointFromPos(pos, 320, 568, 54);
  assert.ok(tiny.left >= 6 && tiny.left <= 320 - 60 && tiny.top >= 6 && tiny.top <= 568 - 60);
});

test('a dragged button never leaves the window', () => {
  for (const [vw, vh] of VIEWPORTS) {
    for (const size of [54, 36]) {
      for (const point of [{ left: -500, top: -500 }, { left: 99999, top: 99999 }, { left: vw / 2, top: -3 }, { left: 'x', top: null }]) {
        const clamped = geo.clampPoint(point, vw, vh, size);
        assert.ok(clamped.left >= 6 && clamped.left + size <= vw - 6, `${vw}x${vh} left ${clamped.left}`);
        assert.ok(clamped.top >= 6 && clamped.top + size <= vh - 6, `${vw}x${vh} top ${clamped.top}`);
      }
    }
  }
  assert.deepEqual(geo.posFromPoint({ left: -50, top: 5000 }, 1100, 800, 54), { x: 0, y: 1 });
});

test('drops near an edge stick to it, and a tucked button picks the nearer side', () => {
  const [vw, vh, size] = [1100, 800, 54];
  assert.deepEqual(geo.snapPoint({ left: 15, top: 300 }, vw, vh, size, 'normal'), { left: 6, top: 300 });
  assert.deepEqual(geo.snapPoint({ left: vw - size - 15, top: vh - size - 10 }, vw, vh, size, 'faded'), { left: vw - 6 - size, top: vh - 6 - size });
  assert.deepEqual(geo.snapPoint({ left: 300, top: 300 }, vw, vh, size, 'normal'), { left: 300, top: 300 }, 'far from edges it stays put');
  assert.deepEqual(geo.snapPoint({ left: 300, top: 300 }, vw, vh, size, 'edge'), { left: 6, top: 300 });
  assert.deepEqual(geo.snapPoint({ left: 700, top: 300 }, vw, vh, size, 'edge'), { left: vw - 6 - size, top: 300 });
  assert.equal(geo.edgeOf(null), 'right', 'the default corner tucks to the right');
  assert.equal(geo.edgeOf({ x: 0.49, y: 0.2 }), 'left');
  assert.equal(geo.edgeOf({ x: 0.5, y: 0.2 }), 'right');
  assert.equal(geo.edgeOfPoint({ left: 100, top: 0 }, vw, size), 'left');
  assert.equal(geo.edgeOfPoint({ left: 900, top: 0 }, vw, size), 'right');
});

test('a tucked button rests against its edge and leaves only a sliver on screen', () => {
  for (const [vw, vh] of VIEWPORTS) {
    for (const size of [54, 36]) {
      const left = geo.restingPoint({ x: 0.3, y: 0.4 }, 'edge', vw, vh, size);
      assert.equal(left.left, 6);
      assert.equal(left.left + geo.tuckShift('left', left.left, vw, size) + size, geo.SLIVER);
      const right = geo.restingPoint({ x: 0.7, y: 0.4 }, 'edge', vw, vh, size);
      assert.equal(right.left, vw - 6 - size);
      assert.equal(vw - (right.left + geo.tuckShift('right', right.left, vw, size)), geo.SLIVER);
      const corner = geo.restingPoint(null, 'edge', vw, vh, size);
      assert.equal(vw - (corner.left + geo.tuckShift('right', corner.left, vw, size)), geo.SLIVER);
      assert.deepEqual(geo.restingPoint({ x: 0.3, y: 0.4 }, 'normal', vw, vh, size), geo.pointFromPos({ x: 0.3, y: 0.4 }, vw, vh, size));
    }
  }
});

test('the menu panel and the prompt stay inside the window wherever the button is', () => {
  for (const [vw, vh] of VIEWPORTS) {
    for (const size of SIZES) {
      for (const mode of MODES) {
        for (const [name, pos] of Object.entries(SPOTS)) {
          const where = `${vw}x${vh} ${size} ${mode} ${name}`;
          const button = buttonAt(pos, vw, vh, size, mode);
          const panel = geo.panelPlacement({ button, vw, vh });
          assert.ok(geo.inside(box(panel), vw, vh, geo.EDGE), `panel outside: ${where} ${JSON.stringify(panel)}`);
          assert.ok(panel.height >= Math.min(geo.PANEL_MIN, vh - 24), `panel too short: ${where}`);
          assert.ok(panel.originX >= 0 && panel.originX <= panel.width && panel.originY >= 0 && panel.originY <= panel.height, `origin: ${where}`);
          if (vw <= geo.NARROW) assert.equal(panel.width, vw - 24, `phones get a full-width panel: ${where}`);
          for (const height of [90, 130, 200]) {
            const bubble = geo.bubblePlacement({ button, vw, vh, height });
            assert.ok(geo.inside({ ...box(bubble), height }, vw, vh, geo.EDGE), `bubble outside: ${where} ${JSON.stringify(bubble)}`);
            assert.ok(bubble.width <= geo.BUBBLE_WIDTH);
          }
        }
      }
    }
  }
});

test('the panel opens away from the button, above it low on the screen and below it high up', () => {
  for (const [vw, vh] of VIEWPORTS) {
    for (const size of SIZES) {
      for (const [name, pos] of Object.entries(CORNERS)) {
        const button = buttonAt(pos, vw, vh, size);
        const panel = geo.panelPlacement({ button, vw, vh });
        assert.ok(!overlaps(box(panel), asBox(button)), `corner panel covers the button: ${vw}x${vh} ${size} ${name}`);
        const bubble = geo.bubblePlacement({ button, vw, vh, height: 130 });
        assert.ok(!overlaps({ ...box(bubble), height: 130 }, asBox(button)), `corner bubble covers the button: ${vw}x${vh} ${name}`);
        if (vh > geo.SHORT) assert.equal(panel.side, pos.y === 1 ? 'above' : 'below', `${vw}x${vh} ${name}`);
      }
    }
  }
  for (const [vw, vh] of DESKTOPS) {
    for (const [name, pos] of Object.entries(SPOTS)) {
      const button = buttonAt(pos, vw, vh, 'normal');
      const panel = geo.panelPlacement({ button, vw, vh });
      assert.ok(!overlaps(box(panel), asBox(button)), `desktop panel covers the button: ${vw}x${vh} ${name}`);
      if (pos && pos.x === 1) assert.ok(panel.left + panel.width <= button.left + button.size, `lined up with the right side: ${name}`);
      if (pos && pos.x === 0) assert.ok(panel.left >= button.left, `lined up with the left side: ${name}`);
    }
  }
});

test('the default corner opens the panel exactly where it always opened', () => {
  const big = geo.panelPlacement({ button: buttonAt(null, 1920, 1080, 'normal'), vw: 1920, vh: 1080 });
  assert.deepEqual(box(big), { left: 1920 - 18 - 400, top: 1080 - 84 - 640, width: 400, height: 640 });
  assert.equal(big.originY, 640, 'it grows out of the button below it');
  const laptop = geo.panelPlacement({ button: buttonAt(null, 1100, 800, 'normal'), vw: 1100, vh: 800 });
  assert.deepEqual(box(laptop), { left: 1100 - 18 - 400, top: 800 - 84 - 640, width: 400, height: 640 });
  // Landscape phone: beside the button, using the whole height (as the old short-screen rule did).
  const landscape = geo.panelPlacement({ button: buttonAt(null, 640, 360, 'normal'), vw: 640, vh: 360 });
  assert.equal(landscape.side, 'left');
  assert.deepEqual(box(landscape), { left: 640 - 84 - 400, top: 12, width: 400, height: 336 });
  const phone = geo.panelPlacement({ button: buttonAt(null, 400, 700, 'normal'), vw: 400, vh: 700 });
  assert.equal(phone.side, 'above');
  assert.equal(phone.width, 376);
  assert.equal(phone.height, 700 - 104);
});

test('a button halfway down a wide window gets the panel beside it', () => {
  const button = buttonAt({ x: 1, y: 0.5 }, 1100, 800, 'normal');
  const panel = geo.panelPlacement({ button, vw: 1100, vh: 800 });
  assert.equal(panel.side, 'left');
  assert.equal(panel.left + panel.width, button.left - geo.GAP);
  assert.equal(panel.height, 640);
  assert.equal(panel.fromX, 20, 'it slides in from the button');
});

// The in-game button and its settings card.
const overlay = read('overlay.js');
const card = read('popup-launcher.js');
const keysIn = source => [...source.matchAll(/\bt\(\s*["'`]([a-z]+\.[\w.]+)["'`]/g)].map(match => match[1]);
const strip = source => source.replace(/\/\/.*$/gm, '');

test('the button and its card speak only their own language files, and use every string in them', () => {
  const overlayKeys = keysIn(overlay);
  const cardKeys = keysIn(card);
  assert.ok(overlayKeys.length > 10 && cardKeys.length > 10);
  assert.ok(overlayKeys.every(key => key.startsWith('overlay.')), 'the game page only loads the overlay namespace');
  assert.ok(cardKeys.every(key => key.startsWith('launcher.')));
  const used = new Set([...overlayKeys, ...cardKeys]);
  for (const [namespace, file] of [['overlay', 'locales/en/overlay.json'], ['launcher', 'locales/en/launcher.json']]) {
    for (const key of Object.keys(JSON.parse(read(file)))) assert.ok(used.has(`${namespace}.${key}`), `${namespace}.${key} is never used`);
  }
  for (const english of ['Glitch is here', '>Dismiss<', '"Dismiss"', 'Open RNGidle Shop Helper', 'auto-buy', 'wares you want', 'Update available']) {
    assert.ok(!strip(overlay).includes(english), `“${english}” should come from locales/en/overlay.json`);
  }
});

test('the button reads its preferences like ui-prefs.js does', () => {
  const list = name => JSON.parse(overlay.match(new RegExp(`const ${name} = (\\[[^\\]]*\\])`))[1]);
  assert.deepEqual(list('MODES'), LAUNCHER_MODES);
  assert.deepEqual(list('SIZES'), LAUNCHER_SIZES);
  assert.deepEqual(Object.keys(geo.SIZES), LAUNCHER_SIZES);
});

test('the settings card builds its controls safely and only once', () => {
  const source = strip(card);
  assert.ok(!/\b(?:alert|confirm|prompt)\(/.test(source), 'no blocking dialogs');
  assert.ok(!/\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML/.test(source), 'no HTML injection');
  const html = read('popup.html');
  assert.ok(html.includes('id="launcher-card"') && html.includes('src="popup-launcher.js"'));
  const pageIds = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]));
  for (const [, id] of card.matchAll(/\bid: '([^']+)'/g)) assert.ok(!pageIds.has(id), `#${id} is already used in popup.html`);
});

test('the geometry helper loads before the in-game button when the manifest lists it', () => {
  const [script] = JSON.parse(read('manifest.json')).content_scripts;
  const at = script.js.indexOf('launcher-geometry.js');
  if (at === -1) return; // until then the button keeps its corner and cannot be dragged
  assert.ok(at < script.js.indexOf('overlay.js'));
});

// Where the floating in-game button, its menu panel and its prompt go on the screen. Pure maths
// with no DOM access, so it can be tested in node. A plain script (no import or export): it loads
// as a content script before overlay.js and publishes itself on globalThis, like i18n.js.
//
// A saved position is a pair of fractions (0 to 1) of the free space the button can move in: the
// viewport minus the button minus a small margin on each side. That keeps the button in the same
// relative spot when the window is resized. No saved position means the default bottom-right corner.
(() => {
  const MARGIN = 6; // between the button and the window edge
  const SLIVER = 12; // how much of a tucked button stays on screen
  const GAP = 12; // between the button and the panel or prompt
  const EDGE = 12; // between the panel or prompt and the window edge
  const SNAP = 16; // a drop this close to an edge sticks to it
  const SIZES = { normal: 54, small: 36 };
  const PANEL_WIDTH = 400;
  const PANEL_HEIGHT = 640;
  const PANEL_MIN = 280;
  const PANEL_COMFY = 420; // less room than this on the preferred side: try beside the button
  const BUBBLE_WIDTH = 270;
  const NARROW = 480; // phones: full-width panel
  const SHORT = 520; // landscape phones: the panel uses the whole height

  const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));
  const round = value => Math.round(value);

  // Same rules as normalizeLauncherPos in ui-prefs.js (a test keeps them in step).
  const fraction = value => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : null;
  };
  function normalizePos(value) {
    const x = value?.x === undefined ? null : fraction(value.x);
    const y = value?.y === undefined ? null : fraction(value.y);
    return x === null || y === null ? null : { x, y };
  }

  const sizeOf = size => SIZES[size] ?? SIZES.normal;
  const defaultOffset = vw => (vw <= NARROW ? 14 : 18);

  function freeSpace(vw, vh, size) {
    return { width: Math.max(0, vw - size - 2 * MARGIN), height: Math.max(0, vh - size - 2 * MARGIN) };
  }

  // Keeps the button's top-left corner where the whole button stays on screen.
  function clampPoint(point, vw, vh, size) {
    return {
      left: round(clamp(Number(point?.left) || 0, MARGIN, vw - MARGIN - size)),
      top: round(clamp(Number(point?.top) || 0, MARGIN, vh - MARGIN - size)),
    };
  }

  function defaultPoint(vw, vh, size) {
    const offset = defaultOffset(vw);
    return clampPoint({ left: vw - offset - size, top: vh - offset - size }, vw, vh, size);
  }

  function pointFromPos(pos, vw, vh, size) {
    const clean = normalizePos(pos);
    if (!clean) return defaultPoint(vw, vh, size);
    const free = freeSpace(vw, vh, size);
    return clampPoint({ left: MARGIN + clean.x * free.width, top: MARGIN + clean.y * free.height }, vw, vh, size);
  }

  function posFromPoint(point, vw, vh, size) {
    const free = freeSpace(vw, vh, size);
    const { left, top } = clampPoint(point, vw, vh, size);
    const part = (value, room) => (room > 0 ? Math.round(clamp((value - MARGIN) / room, 0, 1) * 10000) / 10000 : 0);
    return { x: part(left, free.width), y: part(top, free.height) };
  }

  // Which side a tucked button hides in: the half of the screen it sits in.
  const edgeOf = pos => {
    const clean = normalizePos(pos);
    return clean && clean.x < 0.5 ? 'left' : 'right';
  };
  const edgeOfPoint = (point, vw, size) => (point.left + size / 2 < vw / 2 ? 'left' : 'right');

  // Where the button rests. Tucked at the edge, it always sits against its edge.
  function restingPoint(pos, mode, vw, vh, size) {
    const clean = normalizePos(pos);
    if (!clean) return defaultPoint(vw, vh, size);
    if (mode === 'edge') return pointFromPos({ x: clean.x < 0.5 ? 0 : 1, y: clean.y }, vw, vh, size);
    return pointFromPos(clean, vw, vh, size);
  }

  // How far to slide a resting button sideways so only a sliver shows at its edge.
  function tuckShift(edge, left, vw, size) {
    return round(edge === 'left' ? SLIVER - size - left : vw - SLIVER - left);
  }

  // Where a dropped button ends up: against an edge it was dropped close to, and (tucked mode)
  // always against the nearer side.
  function snapPoint(point, vw, vh, size, mode) {
    const { left, top } = clampPoint(point, vw, vh, size);
    const maxLeft = Math.max(MARGIN, vw - MARGIN - size);
    const maxTop = Math.max(MARGIN, vh - MARGIN - size);
    let x = left;
    let y = top;
    if (mode === 'edge') x = left + size / 2 < vw / 2 ? MARGIN : maxLeft;
    else if (left - MARGIN <= SNAP) x = MARGIN;
    else if (maxLeft - left <= SNAP) x = maxLeft;
    if (top - MARGIN <= SNAP) y = MARGIN;
    else if (maxTop - top <= SNAP) y = maxTop;
    return { left: round(x), top: round(y) };
  }

  const panelHeightFor = vh => (vh <= SHORT ? vh - 2 * EDGE : Math.min(PANEL_HEIGHT, vh - 104));

  // The menu panel opens above a button in the lower half of the screen and below one in the
  // upper half, lined up with the button's side. Without enough room there it opens beside the
  // button, and failing that it takes what room there is (it may then cover the button, which is
  // drawn on top). It always stays inside the window.
  function panelPlacement({ button, vw, vh }) {
    const { left: bx, top: by, size } = button;
    const cx = bx + size / 2;
    const cy = by + size / 2;
    const narrow = vw <= NARROW;
    const width = Math.max(0, narrow ? vw - 2 * EDGE : Math.min(PANEL_WIDTH, vw - 2 * EDGE));
    const fullHeight = Math.max(0, vh - 2 * EDGE);
    const wanted = Math.min(panelHeightFor(vh), fullHeight);
    const lower = cy > vh / 2;
    const room = { above: by - GAP - EDGE, below: vh - EDGE - (by + size + GAP) };
    const alignRight = cx > vw / 2;
    let side = lower ? 'above' : 'below';
    let left = narrow ? EDGE : alignRight ? bx + size - width : bx;
    let top;
    let height;

    const roomLeft = bx - GAP - EDGE;
    const roomRight = vw - EDGE - (bx + size + GAP);
    const beside = narrow ? null
      : alignRight ? (roomLeft >= width ? 'left' : roomRight >= width ? 'right' : null)
        : (roomRight >= width ? 'right' : roomLeft >= width ? 'left' : null);

    if (room[side] >= Math.min(wanted, PANEL_COMFY)) {
      height = Math.min(wanted, room[side]);
    } else if (beside) {
      side = beside;
      height = wanted;
      left = side === 'left' ? bx - GAP - width : bx + size + GAP;
      top = cy - height / 2;
    } else {
      if (room.above > room.below) side = 'above';
      else if (room.below > room.above) side = 'below';
      height = Math.min(wanted, Math.max(room[side], PANEL_MIN));
    }
    if (top === undefined) top = side === 'above' ? by - GAP - height : by + size + GAP;

    height = Math.max(0, Math.min(height, fullHeight));
    left = clamp(left, EDGE, vw - EDGE - width);
    top = clamp(top, EDGE, vh - EDGE - height);
    const shift = { above: [0, 20], below: [0, -20], left: [20, 0], right: [-20, 0] }[side];
    return {
      side,
      left: round(left), top: round(top), width: round(width), height: round(height),
      // Grow out of the button.
      originX: round(clamp(cx - left, 0, width)), originY: round(clamp(cy - top, 0, height)),
      fromX: shift[0], fromY: shift[1],
    };
  }

  // The prompt bubble next to the button: above it in the lower half, below it in the upper half,
  // on the other side or beside it when that does not fit, and always inside the window.
  function bubblePlacement({ button, vw, vh, width = BUBBLE_WIDTH, height = 120 }) {
    const { left: bx, top: by, size } = button;
    const cx = bx + size / 2;
    const cy = by + size / 2;
    const w = Math.max(0, Math.min(width, vw - 2 * EDGE));
    const h = Math.max(0, Math.min(height, vh - 2 * EDGE));
    const fits = top => top >= EDGE && top + h <= vh - EDGE;
    const above = by - GAP - h;
    const below = by + size + GAP;
    const alignRight = cx > vw / 2;
    let side = cy > vh / 2 ? 'above' : 'below';
    let top = side === 'above' ? above : below;
    let left = alignRight ? bx + size - w : bx;
    if (!fits(top)) {
      const other = side === 'above' ? 'below' : 'above';
      const otherTop = other === 'above' ? above : below;
      if (fits(otherTop)) {
        side = other;
        top = otherTop;
      } else {
        const roomLeft = bx - GAP - EDGE;
        const roomRight = vw - EDGE - (bx + size + GAP);
        if (Math.max(roomLeft, roomRight) >= w) {
          side = roomLeft >= w && (alignRight || roomRight < w) ? 'left' : 'right';
          left = side === 'left' ? bx - GAP - w : bx + size + GAP;
          top = cy - h / 2;
        }
      }
    }
    left = clamp(left, EDGE, vw - EDGE - w);
    top = clamp(top, EDGE, vh - EDGE - h);
    const shift = { above: [0, 10], below: [0, -10], left: [10, 0], right: [-10, 0] }[side];
    return {
      side,
      left: round(left), top: round(top), width: round(w),
      originX: round(clamp(cx - left, 0, w)), originY: round(clamp(cy - top, 0, h)),
      fromX: shift[0], fromY: shift[1],
    };
  }

  // True when a box lies fully inside the window, `margin` pixels in from every side.
  const inside = (box, vw, vh, margin = 0) => box.left >= margin && box.top >= margin
    && box.left + box.width <= vw - margin && box.top + box.height <= vh - margin;

  globalThis.shopHelperLauncherGeometry = {
    MARGIN, SLIVER, GAP, EDGE, SNAP, SIZES, PANEL_WIDTH, PANEL_HEIGHT, PANEL_MIN, BUBBLE_WIDTH, NARROW, SHORT,
    clamp, normalizePos, sizeOf, defaultOffset, freeSpace, clampPoint, defaultPoint, pointFromPos, posFromPoint,
    edgeOf, edgeOfPoint, restingPoint, tuckShift, snapPoint, panelHeightFor, panelPlacement, bubblePlacement, inside,
  };
})();

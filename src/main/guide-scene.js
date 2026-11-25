'use strict';

// Pure layout for guide marks and cards. No Electron import: main passes
// screenToDip (screen.screenToDipRect(null, rect)) and the display list.

const CARD_WIDTH = 280;
const CARD_MARGIN = 8;
const LABEL_HEIGHT = 24;
const LABEL_GAP = 5;
const LABEL_MAX_WIDTH = 200;

// Card height estimate (DIP). Deterministic from content so overlap checks are meaningful.
const CARD_PADDING = 24;     // top + bottom padding
const CARD_TITLE_HEIGHT = 28;
const CARD_LINE_HEIGHT = 18;
const CARD_CHARS_PER_LINE = 36;
const CARD_ITEM_GAP = 6;
const CARD_ROW_HEIGHT = 24;  // table header and each table row
const CARD_BUTTONS_HEIGHT = 36; // a walkthrough card's Next / Stop row

const lines = (text) => Math.max(1, Math.ceil(String(text || '').length / CARD_CHARS_PER_LINE));

function estimateCardHeight(card) {
  let h = CARD_PADDING + (card.title ? CARD_TITLE_HEIGHT : 0);
  if (card.kind === 'steps') {
    for (const item of card.items || []) h += lines(item) * CARD_LINE_HEIGHT + CARD_ITEM_GAP;
  } else if (card.kind === 'table') {
    h += CARD_ROW_HEIGHT * (1 + (card.rows || []).length);
  } else {
    h += lines(card.text) * CARD_LINE_HEIGHT;
  }
  if (Array.isArray(card.buttons) && card.buttons.length) h += CARD_BUTTONS_HEIGHT;
  return h;
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const center = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const inside = (p, r) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;

function displayAt(displays, point) {
  return displays.find((d) => inside(point, d.bounds))
    || displays.reduce((best, d) => {
      const c = center(d.bounds);
      const dist = Math.hypot(c.x - point.x, c.y - point.y);
      return !best || dist < best.dist ? { d, dist } : best;
    }, null)?.d;
}

function labelFor(box, display) {
  const width = Math.min(LABEL_MAX_WIDTH, display.bounds.width - 8);
  const x = Math.max(4, Math.min(box.x, display.bounds.width - width - 4));
  let y = box.y - LABEL_GAP - LABEL_HEIGHT;
  if (y < 0) y = box.y + box.height + LABEL_GAP;
  return { x, y, width };
}

function placeCard(card, win, display, obstacles) {
  const width = CARD_WIDTH;
  const height = estimateCardHeight(card);
  const dw = display.bounds.width;
  const dh = display.bounds.height;
  const leftSpace = win.x;
  const rightSpace = dw - (win.x + win.width);
  const sides = [
    { space: rightSpace, x: win.x + win.width + CARD_MARGIN },
    { space: leftSpace, x: win.x - CARD_MARGIN - width },
  ].sort((a, b) => b.space - a.space);
  const clampY = (y) => Math.max(0, Math.min(y, dh - height));
  for (const side of sides) {
    if (side.space < width + CARD_MARGIN * 2) continue;
    const ys = [clampY(win.y)];
    for (const o of obstacles) ys.push(clampY(o.y + o.height + CARD_MARGIN), clampY(o.y - CARD_MARGIN - height));
    for (const y of ys) {
      const box = { x: side.x, y, width, height };
      if (!obstacles.some((o) => overlaps(box, o))) return box;
    }
  }
  return {
    x: Math.max(0, win.x + win.width - width - CARD_MARGIN),
    y: Math.max(0, win.y + win.height - height - CARD_MARGIN),
    width, height,
  };
}

function layoutScene({ marks = [], cards = [], window: win }, { displays, screenToDip }) {
  const scene = new Map(displays.map((d) => [d.id, { marks: [], cards: [] }]));
  const obstacles = new Map(displays.map((d) => [d.id, []]));
  for (const mark of marks) {
    const dip = screenToDip(mark.bounds);
    const display = displayAt(displays, center(dip));
    if (!display) continue;
    const box = { x: dip.x - display.bounds.x, y: dip.y - display.bounds.y, width: dip.width, height: dip.height };
    const placed = { id: mark.id, kind: mark.kind, box };
    if (mark.text !== undefined) placed.text = mark.text;
    const hitbox = { ...box };
    if (mark.text) {
      placed.label = labelFor(box, display);
      obstacles.get(display.id).push({ ...placed.label, height: LABEL_HEIGHT });
    }
    if (mark.toBounds) {
      const c = center(screenToDip(mark.toBounds));
      placed.to = { x: c.x - display.bounds.x, y: c.y - display.bounds.y };
    }
    obstacles.get(display.id).push(hitbox);
    scene.get(display.id).marks.push(placed);
  }
  if (win) {
    const dipWin = screenToDip(win);
    // Every display gets the window in its own space, so a spotlight dims only the window (may be partly off-display).
    for (const d of displays) {
      scene.get(d.id).window = { x: dipWin.x - d.bounds.x, y: dipWin.y - d.bounds.y, width: dipWin.width, height: dipWin.height };
    }
    const display = displayAt(displays, center(dipWin));
    if (display) {
      const rel = { x: dipWin.x - display.bounds.x, y: dipWin.y - display.bounds.y, width: dipWin.width, height: dipWin.height };
      const taken = obstacles.get(display.id);
      for (const card of cards) {
        const box = placeCard(card, rel, display, taken);
        taken.push(box);
        scene.get(display.id).cards.push({ ...card, box });
      }
    }
  }
  return scene;
}

module.exports = { layoutScene, estimateCardHeight, CARD_WIDTH, CARD_BUTTONS_HEIGHT };

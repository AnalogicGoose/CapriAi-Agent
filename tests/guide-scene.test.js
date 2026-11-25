'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { layoutScene } = require('../src/main/guide-scene');

const A = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };
const B = { id: 2, bounds: { x: 1920, y: 0, width: 1707, height: 960 }, scaleFactor: 1.5 };
const identity = (r) => ({ ...r });
// Fake of screen.screenToDipRect: native px right of x=1920 live on the 150% display.
const mixed = (r) => (r.x < 1920 ? { ...r }
  : { x: 1920 + (r.x - 1920) / 1.5, y: r.y / 1.5, width: r.width / 1.5, height: r.height / 1.5 });
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('places a ring relative to its display in DIP', () => {
  const scene = layoutScene({ marks: [{ id: 'm', kind: 'ring', bounds: { x: 100, y: 200, width: 50, height: 40 } }], cards: [], window: { x: 0, y: 0, width: 800, height: 600 } },
    { displays: [A], screenToDip: identity });
  assert.deepEqual(scene.get(1).marks[0].box, { x: 100, y: 200, width: 50, height: 40 });
});

test('mixed DPI: a target on the 150% display is divided by its scale, not the primary\'s', () => {
  const scene = layoutScene({ marks: [{ id: 'm', kind: 'ring', bounds: { x: 3270, y: 300, width: 150, height: 90 } }], cards: [], window: { x: 3000, y: 0, width: 600, height: 600 } },
    { displays: [A, B], screenToDip: mixed });
  assert.equal(scene.get(1).marks.length, 0);
  assert.deepEqual(scene.get(2).marks[0].box, { x: 900, y: 200, width: 100, height: 60 });
});

test('cards avoid mark boxes and pick the wider free side', () => {
  const win = { x: 300, y: 100, width: 400, height: 500 };
  const marks = [{ id: 'm', kind: 'ring', bounds: { x: 1000, y: 100, width: 200, height: 100 } }];
  const cards = [{ kind: 'note', title: 'Hi', text: 'Click the ring.' }];
  const scene = layoutScene({ marks, cards, window: win }, { displays: [A], screenToDip: identity });
  const { cards: placed, marks: pm } = scene.get(1);
  assert.equal(placed.length, 1);
  assert.equal(placed[0].box.width, 280);
  assert.ok(placed[0].box.x >= win.x + win.width, 'right side is wider');
  for (const m of pm) assert.equal(overlap(placed[0].box, m.box), false);
});

test('card falls inside the window corner when neither side fits', () => {
  const win = { x: 10, y: 10, width: 1900, height: 1000 };
  const scene = layoutScene({ marks: [], cards: [{ kind: 'note', title: 'T', text: 'x' }], window: win }, { displays: [A], screenToDip: identity });
  const b = scene.get(1).cards[0].box;
  assert.ok(b.x + b.width <= win.x + win.width && b.y + b.height <= win.y + win.height);
  assert.ok(b.x > win.x + win.width / 2 && b.y > win.y + win.height / 2);
});

test('labels flip below when there\'s no room above', () => {
  const win = { x: 0, y: 0, width: 800, height: 600 };
  const mk = (y) => ({ id: 'l', kind: 'label', text: 'Here', bounds: { x: 100, y, width: 80, height: 30 } });
  const top = layoutScene({ marks: [mk(10)], cards: [], window: win }, { displays: [A], screenToDip: identity }).get(1).marks[0];
  assert.equal(top.label.y, 10 + 30 + 5);
  const mid = layoutScene({ marks: [mk(200)], cards: [], window: win }, { displays: [A], screenToDip: identity }).get(1).marks[0];
  assert.equal(mid.label.y, 200 - 5 - 24);
});

test('arrow keeps a destination point in the same display space', () => {
  const marks = [{ id: 'a', kind: 'arrow', bounds: { x: 3000, y: 300, width: 60, height: 60 }, toBounds: { x: 3300, y: 600, width: 60, height: 30 } }];
  const scene = layoutScene({ marks, cards: [], window: { x: 3000, y: 0, width: 600, height: 600 } }, { displays: [A, B], screenToDip: mixed });
  const m = scene.get(2).marks[0];
  assert.deepEqual(m.to, { x: 940, y: 410 });
});

test('each display scene carries the annotated window in its own DIP space for the spotlight', () => {
  const win = { x: 1800, y: 100, width: 400, height: 300 };
  const scene = layoutScene({ marks: [], cards: [], window: win }, { displays: [A, B], screenToDip: identity });
  assert.deepEqual(scene.get(1).window, { x: 1800, y: 100, width: 400, height: 300 });
  assert.deepEqual(scene.get(2).window, { x: -120, y: 100, width: 400, height: 300 }, 'partly off-display is kept as is');
  assert.equal(layoutScene({ marks: [], cards: [] }, { displays: [A], screenToDip: identity }).get(1).window, undefined);
});

test('a card with buttons reserves room for its button row', () => {
  const { estimateCardHeight, CARD_BUTTONS_HEIGHT } = require('../src/main/guide-scene');
  const card = { kind: 'steps', title: 'Walk', items: ['Click Display'] };
  assert.equal(CARD_BUTTONS_HEIGHT, 36);
  assert.equal(estimateCardHeight({ ...card, buttons: [{ id: 'next' }, { id: 'stop' }] }), estimateCardHeight(card) + 36);
  assert.equal(estimateCardHeight({ ...card, buttons: [] }), estimateCardHeight(card));
});

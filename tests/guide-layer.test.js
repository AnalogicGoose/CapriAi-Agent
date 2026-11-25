'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createGuideLayer } = require('../src/main/guide-layer');

const A = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 };
const B = { id: 2, bounds: { x: 1920, y: -100, width: 1707, height: 960 }, scaleFactor: 1.5 };

function fakes(displays = [A, B]) {
  const windows = [];
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.calls = [];
      this.destroyed = false;
      this.webContents = Object.assign(new EventEmitter(), {
        sent: [],
        ipc: new EventEmitter(),
        send: (channel, payload) => this.webContents.sent.push([channel, payload]),
        isDestroyed: () => this.destroyed,
      });
      windows.push(this);
    }
    loadFile(file) { this.calls.push(['loadFile', file]); return Promise.resolve(); }
    setContentProtection(...args) { this.calls.push(['setContentProtection', ...args]); }
    setIgnoreMouseEvents(...args) { this.calls.push(['setIgnoreMouseEvents', ...args]); }
    setAlwaysOnTop(...args) { this.calls.push(['setAlwaysOnTop', ...args]); }
    setBounds(...args) { this.calls.push(['setBounds', ...args]); }
    showInactive() { this.calls.push(['showInactive']); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const screen = { getAllDisplays: () => displays };
  return { windows, BrowserWindow: FakeWindow, screen };
}

const ring = { id: 'm1', kind: 'ring', box: { x: 10, y: 20, width: 30, height: 40 } };
const card = { kind: 'steps', title: 'Step 1', items: ['Click Save'], box: { x: 100, y: 100, width: 280, height: 100 },
  buttons: [{ id: 'next', label: 'Next' }, { id: 'stop', label: 'Stop' }] };
const scene = (entries) => new Map(entries);
const empty = { marks: [], cards: [] };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('creates one content-protected, non-focusable, click-through window per display with content', async () => {
  const f = fakes();
  const layer = createGuideLayer({ ...f, preload: '/p/guide-preload.js', page: '/p/guide.html' });
  await layer.render(scene([[1, { marks: [ring], cards: [] }], [2, empty]]));
  assert.equal(f.windows.length, 1);
  const [win] = f.windows;
  const o = win.options;
  assert.deepEqual({ x: o.x, y: o.y, width: o.width, height: o.height }, A.bounds);
  assert.equal(o.frame, false);
  assert.equal(o.transparent, true);
  assert.equal(o.focusable, false);
  assert.equal(o.skipTaskbar, true);
  assert.equal(o.show, false);
  assert.equal(o.webPreferences.preload, '/p/guide-preload.js');
  assert.equal(o.webPreferences.sandbox, true);
  assert.equal(o.webPreferences.contextIsolation, true);
  assert.equal(o.webPreferences.nodeIntegration, false);
  assert.deepEqual(win.calls.find((c) => c[0] === 'setContentProtection'), ['setContentProtection', true]);
  assert.deepEqual(win.calls.find((c) => c[0] === 'setIgnoreMouseEvents'), ['setIgnoreMouseEvents', true]);
  assert.deepEqual(win.calls.find((c) => c[0] === 'setAlwaysOnTop'), ['setAlwaysOnTop', true, 'screen-saver']);
  assert.deepEqual(win.calls.find((c) => c[0] === 'loadFile'), ['loadFile', '/p/guide.html']);
  assert.deepEqual(win.webContents.sent, [['guide:scene', { marks: [ring], cards: [] }]]);
  assert.ok(win.calls.some((c) => c[0] === 'showInactive'));

  // A second render reuses the window and sends the new scene; a second display gets its own window.
  await layer.render(scene([[1, { marks: [], cards: [card] }], [2, { marks: [ring], cards: [] }]]));
  assert.equal(f.windows.length, 2);
  assert.deepEqual(win.webContents.sent.at(-1), ['guide:scene', { marks: [], cards: [card] }]);
  assert.deepEqual(f.windows[1].options.x, B.bounds.x);
  assert.deepEqual(f.windows[1].options.y, B.bounds.y);
});

test('destroys windows for displays that become empty and on clear()', async () => {
  const f = fakes();
  const layer = createGuideLayer({ ...f, preload: 'p', page: 'g' });
  await layer.render(scene([[1, { marks: [ring], cards: [] }], [2, { marks: [ring], cards: [] }]]));
  const [one, two] = f.windows;
  await layer.render(scene([[1, empty], [2, { marks: [ring], cards: [] }]]));
  assert.equal(one.destroyed, true);
  assert.equal(two.destroyed, false);
  await layer.render(new Map([[2, { marks: [ring], cards: [] }]]));
  assert.equal(f.windows.length, 2, 'existing window reused');
  layer.clear();
  assert.equal(two.destroyed, true);
  // Content for a display that no longer exists is ignored.
  await layer.render(scene([[99, { marks: [ring], cards: [] }]]));
  assert.equal(f.windows.length, 2);
});

test('ignores card actions from other webContents', async () => {
  const f = fakes();
  const layer = createGuideLayer({ ...f, preload: 'p', page: 'g' });
  const seen = [];
  layer.onCardAction((displayId, actionId) => seen.push([displayId, actionId]));
  await layer.render(scene([[1, { marks: [], cards: [card] }], [2, { marks: [ring], cards: [] }]]));
  const [one, two] = f.windows;
  one.webContents.ipc.emit('guide:card-action', { sender: { id: 'intruder' } }, 'next');
  one.webContents.ipc.emit('guide:card-action', { sender: two.webContents }, 'next');
  one.webContents.ipc.emit('guide:card-action', { sender: one.webContents }, 'not-a-button');
  one.webContents.ipc.emit('guide:card-action', { sender: one.webContents }, { id: 'next' });
  two.webContents.ipc.emit('guide:card-action', { sender: two.webContents }, 'next');
  assert.deepEqual(seen, []);
  one.webContents.ipc.emit('guide:card-action', { sender: one.webContents }, 'next');
  assert.deepEqual(seen, [[1, 'next']]);
  layer.clear();
  one.webContents.ipc.emit('guide:card-action', { sender: one.webContents }, 'stop');
  assert.deepEqual(seen, [[1, 'next']]);
});

test('setCardInteractive toggles setIgnoreMouseEvents(false/true, { forward: true })', async () => {
  const f = fakes();
  const layer = createGuideLayer({ ...f, preload: 'p', page: 'g' });
  await layer.render(scene([[1, { marks: [], cards: [card] }]]));
  const [win] = f.windows;
  const mouse = () => win.calls.filter((c) => c[0] === 'setIgnoreMouseEvents');
  layer.setCardInteractive(1, true);
  assert.deepEqual(mouse().at(-1), ['setIgnoreMouseEvents', false]);
  layer.setCardInteractive(1, false);
  assert.deepEqual(mouse().at(-1), ['setIgnoreMouseEvents', true, { forward: true }]);
  const count = mouse().length;
  layer.setCardInteractive(2, true); // no window there: no-op
  assert.equal(mouse().length, count);
});

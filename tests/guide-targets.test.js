'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GuideTargets } = require('../src/main/guide-targets');

function fixture({ matches = [], controls = [], inspected = [] } = {}) {
  const win = { id: 5, pid: 9, x: -1000, y: 0, width: 2000, height: 800 };
  const state = { win, now: 1000, ocrQueries: [], inspectQueries: [] };
  const map = new Map(controls.map(c => [c.id, c]));
  const accessibility = {
    controlBounds: id => map.has(id) ? { bounds: map.get(id).bounds, window: state.observedWindow || win, at: 1000 } : null,
    inspect: async query => { state.inspectQueries.push(query); return { controls: inspected }; },
    readPixels: async (window, query) => { state.ocrQueries.push(query); return matches; },
  };
  const display = { id: 7, bounds: { x: -1000, y: 0, width: 1000, height: 800 } };
  const frames = new Map([['snap', { display, width: 500, height: 400, foreground: 5, window: win, at: 1000 }]]);
  const screen = { frames, displays: () => [display], toNativePoint: p => p };
  const service = new GuideTargets({ accessibility, screen, foreground: () => state.win, now: () => state.now });
  return { service, state, controls: map, frames, display };
}
const ctx = { signal: undefined, check() {} };
const box = (x, y, width, height) => ({ x, y, width, height });

test('control target uses the inspected bounds and rejects a changed window', async () => {
  const f = fixture({ controls: [{ id: 'c1', bounds: box(10, 20, 30, 40) }] });
  const ok = await f.service.resolve({ type: 'control', id: 'c1' }, ctx);
  assert.deepEqual(ok, { ok: true, bounds: box(10, 20, 30, 40), window: f.state.win });
  assert.equal((await f.service.resolve({ type: 'control', id: 'nope' }, ctx)).reason, 'stale');
  f.state.win = { ...f.state.win, id: 6 };
  assert.deepEqual(await f.service.resolve({ type: 'control', id: 'c1' }, ctx), { ok: false, reason: 'stale' });
});

test('text target returns ambiguous for two matches without nth, and the second with nth 2', async () => {
  const f = fixture({ matches: [{ bounds: box(10, 10, 20, 10) }, { bounds: box(100, 100, 20, 10) }] });
  assert.deepEqual(await f.service.resolve({ type: 'text', text: 'Save' }, ctx), { ok: false, reason: 'ambiguous' });
  const second = await f.service.resolve({ type: 'text', text: 'Save', nth: 2 }, ctx);
  assert.deepEqual(second.bounds, box(100, 100, 20, 10));
  assert.equal((await f.service.resolve({ type: 'text', text: 'Save', nth: 3 }, ctx)).reason, 'not-found');
  assert.equal((await fixture().service.resolve({ type: 'text', text: 'x' }, ctx)).reason, 'not-found');
});

test('snapshot target maps image pixels to native pixels like ScreenAccess.point', async () => {
  const f = fixture();
  const r = await f.service.resolve({ type: 'snapshot', snapshotId: 'snap', x: 250, y: 100, width: 10, height: 10 }, ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(r.bounds, box(-500, 200, 20, 20));
  assert.equal((await f.service.resolve({ type: 'snapshot', snapshotId: 'gone', x: 0, y: 0, width: 1, height: 1 }, ctx)).reason, 'stale');
});

test('name target prefers exact UIA name plus role, then falls back to OCR text', async () => {
  const f = fixture({
    controls: [{ id: 'a', bounds: box(1, 1, 5, 5) }, { id: 'b', bounds: box(50, 50, 5, 5) }],
    inspected: [{ id: 'a', name: 'Save as', role: 'Button' }, { id: 'b', name: 'save', role: 'Button' }, { id: 'c', name: 'Save', role: 'Edit' }],
    matches: [{ bounds: box(300, 300, 10, 10) }],
  });
  const hit = await f.service.resolve({ type: 'name', name: 'Save', role: 'Button' }, ctx);
  assert.deepEqual(hit.bounds, box(50, 50, 5, 5));
  assert.deepEqual(f.state.ocrQueries, []);
  const miss = await f.service.resolve({ type: 'name', name: 'Cancel' }, ctx);
  assert.deepEqual(miss.bounds, box(300, 300, 10, 10));
  assert.deepEqual(f.state.ocrQueries, ['Cancel']);
});

test('a target outside the foreground window bounds is reported as outside-window', async () => {
  const f = fixture({ controls: [{ id: 'far', bounds: box(2000, 2000, 10, 10) }] });
  assert.deepEqual(await f.service.resolve({ type: 'control', id: 'far' }, ctx), { ok: false, reason: 'outside-window' });
});

test('name target with duplicate exact matches is ambiguous; bad names are not-found', async () => {
  const f = fixture({
    controls: [{ id: 'a', bounds: box(1, 1, 5, 5) }, { id: 'b', bounds: box(50, 50, 5, 5) }],
    inspected: [{ id: 'a', name: 'Save', role: 'Button' }, { id: 'b', name: 'SAVE', role: 'Button' }],
  });
  assert.deepEqual(await f.service.resolve({ type: 'name', name: 'Save' }, ctx), { ok: false, reason: 'ambiguous' });
  assert.equal((await f.service.resolve({ type: 'name', name: 'Save', role: 'Edit' }, ctx)).reason, 'not-found');
  assert.equal((await f.service.resolve({ type: 'name' }, ctx)).reason, 'not-found');
});

test('control and snapshot targets go stale after 30s or a clock rewind', async () => {
  const f = fixture({ controls: [{ id: 'c1', bounds: box(10, 20, 30, 40) }] });
  const snap = { type: 'snapshot', snapshotId: 'snap', x: 250, y: 100, width: 10, height: 10 };
  f.state.now = 30999;
  assert.equal((await f.service.resolve({ type: 'control', id: 'c1' }, ctx)).ok, true);
  assert.equal((await f.service.resolve(snap, ctx)).ok, true);
  for (const now of [31000, 999]) {
    f.state.now = now;
    assert.equal((await f.service.resolve({ type: 'control', id: 'c1' }, ctx)).reason, 'stale');
    assert.equal((await f.service.resolve(snap, ctx)).reason, 'stale');
  }
});

test('snapshot target is stale when the window or display geometry changed', async () => {
  const snap = { type: 'snapshot', snapshotId: 'snap', x: 0, y: 0, width: 10, height: 10 };
  const f = fixture();
  f.state.win = { ...f.state.win, id: 6 };
  assert.equal((await f.service.resolve(snap, ctx)).reason, 'stale');
  const g = fixture();
  g.display.bounds = { x: 0, y: 0, width: 1000, height: 800 };
  g.frames.get('snap').display = { ...g.display, bounds: { x: -1000, y: 0, width: 1000, height: 800 } };
  assert.equal((await g.service.resolve(snap, ctx)).reason, 'stale');
});

test('in Gaming mode, name and text targets resolve through the guide read lift only (reads, never effects)', async () => {
  const { WindowsAccessibility } = require('../src/main/windows-accessibility');
  const win = { id: 5, pid: 9, x: 0, y: 0, width: 800, height: 600 };
  const cfg = { screenAwareness: true, gamingMode: true, systemAccess: true, desktopActions: true };
  let lift = true; // main: voice session, or a walkthrough / drawing the user started is active
  const accessibility = new WindowsAccessibility({ settings: () => cfg, foreground: () => ({ ...win }), readLift: () => lift,
    confirm: async () => true, highlight: async () => {},
    run: async call => (call.operation === 'inspect'
      ? { controls: call.query === 'Save' ? [{ identity: '1', name: 'Save', role: 'Button', enabled: true, operations: ['invoke'], bounds: box(10, 10, 50, 20) }] : [] }
      : { dispatched: true }),
    captureWindow: async () => ({ image: 'x', x: 0, y: 0, scaleX: 1, scaleY: 1 }),
    ocr: async () => ({ matches: [{ name: 'Open file', bounds: box(100, 100, 80, 20) }] }) });
  const targets = new GuideTargets({ accessibility, screen: { frames: new Map(), displays: () => [] }, foreground: () => ({ ...win }) });
  const named = await targets.resolve({ type: 'name', name: 'Save' }, ctx);
  assert.equal(named.ok, true);
  assert.deepEqual(named.bounds, box(10, 10, 50, 20));
  const text = await targets.resolve({ type: 'text', text: 'Open file' }, ctx);
  assert.equal(text.ok, true);
  assert.deepEqual(text.bounds, box(100, 100, 80, 20));
  // Codex's own inspection is not lifted, and effects never are.
  await assert.rejects(accessibility.inspect('Save', ctx), /paused/);
  const { controls: [save] } = await accessibility.inspect('Save', { ...ctx, lifted: true });
  await assert.rejects(accessibility.use('invoke', save.id, '', { ...ctx, text: 'press save' }), /paused/);
  // Without the lift (nothing the user started is active), guide reads are paused too.
  lift = false;
  await assert.rejects(targets.resolve({ type: 'name', name: 'Save' }, ctx), /paused/);
});

test('a walkthrough re-plan snapshot is lifted in Gaming mode only while a guide is active', async () => {
  const { ScreenAccess } = require('../src/main/screen-access');
  let lift = true;
  const access = new ScreenAccess({ settings: () => ({ screenAwareness: true, gamingMode: true }), readLift: () => lift,
    displays: () => [{ id: 1, bounds: box(0, 0, 100, 100), primary: true }], foreground: () => ({ id: 3 }),
    capture: async () => ({ url: 'data:image/png;base64,AA==', width: 10, height: 10 }) });
  await assert.rejects(access.snapshot(), /paused/, 'an ordinary snapshot stays paused');
  assert.equal((await access.snapshot('', () => {}, { lifted: true })).width, 10);
  lift = false;
  await assert.rejects(access.snapshot('', () => {}, { lifted: true }), /paused/);
});

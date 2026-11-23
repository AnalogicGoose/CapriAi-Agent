'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GuideTargets } = require('../src/main/guide-targets');

function fixture({ matches = [], controls = [], inspected = [] } = {}) {
  const win = { id: 5, pid: 9, x: -1000, y: 0, width: 2000, height: 800 };
  const state = { win, ocrQueries: [], inspectQueries: [] };
  const map = new Map(controls.map(c => [c.id, c]));
  const accessibility = {
    controlBounds: id => map.has(id) ? { bounds: map.get(id).bounds, window: state.observedWindow || win } : null,
    inspect: async query => { state.inspectQueries.push(query); return { controls: inspected }; },
    readPixels: async (window, query) => { state.ocrQueries.push(query); return matches; },
  };
  const display = { id: 7, bounds: { x: -1000, y: 0, width: 1000, height: 800 } };
  const frames = new Map([['snap', { display, width: 500, height: 400, foreground: 5, window: win }]]);
  const screen = { frames, displays: () => [display], toNativePoint: p => p };
  const service = new GuideTargets({ accessibility, screen, foreground: () => state.win });
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

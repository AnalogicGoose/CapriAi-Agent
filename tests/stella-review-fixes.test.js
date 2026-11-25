'use strict';
// Final whole-branch review fixes for Stella: function-move speed, angle wrap, point/draw focus,
// local "come here", drag vs glides, re-plans, the body-action gate and the hit target.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadRenderer } = require('./helpers/esm.js');

const listeners = () => ({ on: {}, addEventListener() {}, setPointerCapture() {}, releasePointerCapture() {},
  hasPointerCapture: () => false, style: {} });

async function make(o = {}) {
  const { Stella } = await loadRenderer('stella/stella.js');
  const clock = { t: 1000 };
  const frames = [];
  let reduced = !!o.reduced;
  const renderer = 'renderer' in o ? o.renderer : { setSize() {}, draw() {}, lost: false };
  const stella = new Stella({
    root: listeners(), canvas: listeners(), voice: { play() {} }, renderer,
    now: () => clock.t, schedule: fn => frames.push(fn), random: o.random || lcg(3),
    reduced: () => reduced, saveAnchor: () => {}, view: o.view || { w: 1920, h: 1040 },
    anchor: o.anchor, wander: o.wander,
  });
  const step = (ms = F, n = 1) => {
    for (let i = 0; i < n; i++) {
      clock.t += ms;
      const fn = frames.shift();
      if (fn) fn(clock.t);
    }
  };
  return { stella, clock, step, renderer, setReduced: v => { reduced = v; } };
}

const F = 1000 / 60;
const lcg = (seed = 1) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const settle = () => new Promise(r => setImmediate(r));
// Frames until `done()` (60 fps), or Infinity past `max` ms.
const msUntil = (t, done, max = 10000) => {
  for (let ms = 0; ms <= max; ms += F) { if (done()) return ms; t.step(F); }
  return Infinity;
};

// ---------- 1. function moves are quick ----------

test('come to the far corner arrives in under 3 s, and bodyAction(come) replies within a frame', async () => {
  const t = await make({ anchor: { x: 120, y: 120 } });
  let reply = null;
  t.stella.bodyAction('come', { cursor: { x: 1900, y: 1020 } }).then(r => { reply = r; });
  t.step(F);
  await settle();
  assert.equal(reply, 'done', 'replied without waiting for her to arrive');
  assert.ok(t.stella.travel?.fn, 'on her way');
  const ms = msUntil(t, () => !t.stella.travel);
  assert.ok(ms < 3000, `arrived after ${ms} ms`);
  assert.ok(dist(t.stella.pos, { x: 1900, y: 1020 }) < 400, 'by the cursor');
});

test('a walkthrough step to the far corner arrives in under 3 s', async () => {
  const t = await make({ anchor: { x: 120, y: 120 } });
  let arrived = null;
  t.stella.guideFocus({ rect: { x: 1800, y: 960, w: 100, h: 60 } }).then(a => { arrived = a; });
  const ms = msUntil(t, () => !t.stella.travel);
  await settle();
  assert.ok(ms < 3000, `arrived after ${ms} ms`);
  assert.equal(arrived, true);
});

test('function moves stay eased and within 0.6-2.5 s; a wander hop stays slow', async () => {
  const t = await make({ anchor: { x: 1700, y: 900 } });
  t.stella.glideTo({ x: 1680, y: 880 });
  assert.ok(t.stella.travel.duration >= 600 - 1e-9, `short move ${t.stella.travel.duration} ms`);
  t.stella.glideTo({ x: 150, y: 150 });
  const d = t.stella.travel.duration;
  assert.ok(d >= 600 && d <= 2500, `long move ${d} ms`);
  // eased: slow at the start, slow at the end
  const before = { ...t.stella.pos };
  t.step(F);
  const first = dist(before, t.stella.pos);
  t.step(F, Math.round(d / F / 2) - 1);
  const mid0 = { ...t.stella.pos };
  t.step(F);
  assert.ok(dist(mid0, t.stella.pos) > 5 * first, 'eases in');
  const w = await make({ anchor: { x: 1700, y: 900 } });
  w.stella.traveler.wander(w.stella.now() + 1e9, true);
  assert.equal(w.stella.travel.reason, 'wander');
  assert.ok(w.stella.travel.route.length / w.stella.travel.duration * 1000 <= 40 + 1e-6, 'wander stays at most 40 px/s');
});

test("a finished task doesn't move her: spot('stage') is where she is", async () => {
  const t = await make({ anchor: { x: 1700, y: 900 } });
  const at = { ...t.stella.pos };
  assert.deepEqual(t.stella.spot('stage'), at);
  let done = false;
  t.stella.teleport(t.stella.spot('stage')).then(() => { done = true; });
  await settle();
  assert.equal(done, true, 'resolves at once');
  assert.deepEqual(t.stella.pos, at);
  assert.equal(t.stella.travel, null);
  // still pointing at something: the summary's teleport leaves that alone
  t.stella.pointAt({ x: 200, y: 100, w: 300, h: 200 });
  msUntil(t, () => !t.stella.travel);
  await t.stella.teleport(t.stella.spot('stage'));
  assert.ok(t.stella.pointing && t.stella.focus, 'still pointing');
});


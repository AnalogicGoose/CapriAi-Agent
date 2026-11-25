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


// ---------- 3. capri_draw trail, aimed ----------

test('the trail is a stream of dots leaving her toward trailAngle, inside her canvas', async () => {
  const { SceneClock, buildScene } = await loadRenderer('stella/scene.js');
  const clock = new SceneClock(), blend = { listen: 0, think: 0, speak: 0, rest: 0, level: 0 };
  const s = 360;
  for (let i = 0; i < 20; i++) clock.step(1 / 60, blend, null, { trail: 1 });
  for (const angle of [0, Math.PI / 2, -2.5]) {
    const sc = buildScene({ s, t: 1, clock, blend, idle: null, motions: { trail: 1 }, trailAngle: angle });
    assert.ok(sc.trail.length >= 8, 'a stream of dots');
    const lit = sc.trail.filter(d => d.alpha > 0.05);
    assert.ok(lit.length >= 4, 'several lit');
    for (const d of lit) {
      const dx = d.x - sc.cx, dy = d.y - sc.cy, r = Math.hypot(dx, dy);
      assert.ok(r <= 0.48 * s, `inside the LED disc: ${r}`);
      const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - angle), Math.cos(Math.atan2(dy, dx) - angle)));
      assert.ok(off < 0.35, `toward ${angle}: off by ${off}`);
    }
  }
  const none = buildScene({ s, t: 1, clock, blend, idle: null, motions: {}, trailAngle: 0 });
  assert.equal(none.trail.length, 0, 'nothing without the trail motion');
  // the stream flows outward between frames
  const a = buildScene({ s, t: 1, clock, blend, idle: null, motions: { trail: 1 }, trailAngle: 0 });
  clock.step(1 / 60, blend, null, { trail: 1 });
  const b = buildScene({ s, t: 1 + 1 / 60, clock, blend, idle: null, motions: { trail: 1 }, trailAngle: 0 });
  assert.ok(b.trail[0].x > a.trail[0].x || b.trail[0].x < a.trail[0].x - 50, 'dot 0 moved outward (or wrapped to the start)');
});

test('a drawing aims the trail at its rect; without one, toward the middle', async () => {
  const t = await make({ anchor: { x: 1700, y: 900 } });
  const s = t.stella;
  s.agentActivity({ tool: 'capri_draw', phase: 'start' });
  t.step(F, 3);
  assert.ok(heldTrail(s) > 0, 'trail plays');
  const toward = p => Math.atan2(p.y - s.pos.y, p.x - s.pos.x);
  assert.ok(Math.abs(wrapA(s.drawn.trailAngle - toward({ x: 960, y: 520 }))) < 1e-6, 'toward the view center');
  s.drawAt({ rect: { x: 100, y: 100, w: 200, h: 100 } });
  t.step(F, 60);
  assert.ok(Math.abs(wrapA(s.drawn.trailAngle - toward({ x: 200, y: 150 }))) < 0.02, 'toward the drawing');
  assert.ok(dist(s.pos, { x: 1700, y: 900 }) < 1e-6 && !s.travel, "she doesn't move for a drawing");
  s.agentActivity({ tool: 'capri_draw', phase: 'end', ok: true });
  t.step(F, 120);
  assert.equal(heldTrail(s), 0, 'trail over');
  assert.equal(s.drawn.trailAngle, null);
  // a drawing reported after the trail ended plays it again, aimed
  s.drawAt({ direction: 'left' });
  t.step(F, 3);
  assert.ok(heldTrail(s) > 0, 'played again');
  assert.ok(Math.abs(wrapA(s.drawn.trailAngle - Math.PI)) < 1e-6, 'toward the other display');
});

const wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
const heldTrail = s => s.motions.update(s.now()).trail || 0;

// ---------- 4. local "come here" with the real companion ----------

test('a local "come here" brings Stella over instead of being refused', async () => {
  const { Companion } = await loadRenderer('companion.js');
  const t = await make({ anchor: { x: 1700, y: 900 } });
  const companion = new Companion({ capri: t.stella, host: { cursor: async () => ({ inside: true, x: 300, y: 200 }) },
    storage: null, reduced: () => false });
  t.stella.companion = companion;
  t.step(F, 2);
  assert.equal(companion.available(), true);
  const reply = await companion.request('come');
  assert.equal(reply, 'Here I am.');
  assert.ok(t.stella.travel?.reason === 'come', 'on her way');
  msUntil(t, () => !t.stella.travel);
  assert.ok(dist(t.stella.pos, { x: 300, y: 200 }) < dist({ x: 1700, y: 900 }, { x: 300, y: 200 }) - 500, 'came over');
});

// ---------- 5. a drag owns her position ----------

test('moves asked for mid-drag are dropped; she stays under the pointer, and pointing keeps its aim', async () => {
  const t = await make({ anchor: { x: 1700, y: 900 } });
  const s = t.stella;
  s.glideTo({ x: 200, y: 200 });
  t.step(F, 10);
  const at = { ...s.pos };
  s.pointerDown(at.x, at.y);
  s.pointerMove(at.x - 40, at.y - 20);
  t.step(F);
  assert.equal(s.travel, null, 'the drag took over');
  const target = { x: at.x - 40, y: at.y - 20 };
  let come = 'pending', point = 'pending';
  s.summon({ x: 300, y: 300 }).then(v => { come = v; });
  s.pointAt({ x: 100, y: 100, w: 200, h: 100 }).then(v => { point = v; });
  for (let i = 0; i < 120; i++) {
    t.step(F);
    assert.equal(s.travel, null, 'no route while dragging');
  }
  await settle();
  assert.ok(dist(s.pos, target) < 1, `under the pointer: ${JSON.stringify(s.pos)}`);
  assert.equal(come, false);
  assert.equal(point, false);
  assert.ok(s.focus && s.aimAngle != null, 'pointing keeps its aim');
  // the traveler itself never steps a route while dragging
  s.traveler.current = { route: s.traveler.plan({ x: 300, y: 300 }, 'glide'), to: { x: 300, y: 300 }, elapsed: 0, duration: 1000, reason: 'glide', fn: true };
  const held = { ...s.pos };
  s.traveler.step(0.1, false);
  assert.deepEqual(s.pos, held);
  s.pointerUp(target.x, target.y);
});

// ---------- 6. re-plans don't restart from a standstill ----------

test('the same destination again does not re-plan; a new one keeps her speed', async () => {
  const t = await make({ anchor: { x: 1700, y: 900 } });
  const s = t.stella;
  const rect = { x: 200, y: 100, w: 300, h: 200 };
  const first = s.guideFocus({ rect });
  t.step(F, 20);
  const travel = s.travel, elapsed = travel.elapsed;
  const second = s.guideFocus({ rect }); // each walkthrough step sends its focus twice
  assert.equal(s.travel, travel, 'same travel');
  assert.equal(s.travel.elapsed, elapsed, 'not restarted');
  msUntil(t, () => !s.travel);
  assert.equal(await second, true);
  await first;

  // mid-glide, a different target: the new route starts at her current speed
  const u = await make({ anchor: { x: 1700, y: 900 } });
  u.stella.pointAt({ x: 200, y: 100, w: 300, h: 200 });
  u.step(F, 40);
  const speed = () => { const a = { ...u.stella.pos }; u.step(F); return dist(a, u.stella.pos) * 60; };
  const before = speed();
  assert.ok(before > 300, `gliding at ${before} px/s`);
  u.stella.pointAt({ x: 200, y: 700, w: 300, h: 200 });
  const after = speed();
  assert.ok(after > 0.7 * before, `speed ${before} -> ${after} px/s`);
  msUntil(u, () => !u.stella.travel);
  assert.ok(Math.abs(Math.atan2(Math.sin(u.stella.aimAngle), Math.cos(u.stella.aimAngle))) < Math.PI, 'arrived');
});

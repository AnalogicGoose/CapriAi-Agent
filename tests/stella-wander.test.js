'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadRenderer } = require('./helpers/esm.js');

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const VIEWS = [
  { w: 1280, h: 680 }, { w: 3440, h: 1400 }, { w: 800, h: 600 },
  { w: 1920, h: 1080 }, { w: 1024, h: 768 },
];
const R = 68;
const rectDist = (p, r) => {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
};
const inView = (p, r, v) => p.x >= r - 1e-9 && p.y >= r - 1e-9 && p.x <= v.w - r + 1e-9 && p.y <= v.h - r + 1e-9;

test('wander targets never enter the center or leave the view', async () => {
  const w = await loadRenderer('stella/wander.js');
  for (const view of VIEWS) {
    const random = mulberry32(view.w * 7 + view.h);
    const zone = w.centerZone(view);
    let from = { x: R, y: R };
    let relaxed = 0;
    const diag = Math.hypot(view.w, view.h);
    for (let i = 0; i < 2000; i++) {
      const t = w.pickWanderTarget({ from, radius: R, view, random });
      assert.ok(inView(t, R, view), `in view ${JSON.stringify(t)}`);
      assert.ok(rectDist(t, zone) >= R - 1e-9, 'outside center zone');
      assert.ok(w.inBand(t, R, view));
      const d = Math.hypot(t.x - from.x, t.y - from.y);
      assert.ok(d >= 160 - 1e-9, `min distance ${d}`);
      if (d > 0.45 * diag + 1e-9) relaxed++;
      from = t;
    }
    // the maximum hop is only relaxed when no candidate fits (rare)
    assert.ok(relaxed <= 20, `relaxed ${relaxed} of 2000`);
  }
});

test('centerZone is the middle 50% by 50%', async () => {
  const w = await loadRenderer('stella/wander.js');
  assert.deepEqual(w.centerZone({ w: 1000, h: 400 }), { x: 250, y: 100, w: 500, h: 200 });
});

test('clampToView brings off-screen points fully inside', async () => {
  const w = await loadRenderer('stella/wander.js');
  const view = { w: 1000, h: 600 };
  assert.deepEqual(w.clampToView({ x: -50, y: 9999 }, 40, view), { x: 40, y: 560 });
  assert.deepEqual(w.clampToView({ x: 2000, y: -5 }, 40, view), { x: 960, y: 40 });
  assert.deepEqual(w.clampToView({ x: 500, y: 300 }, 40, view), { x: 500, y: 300 });
});

test('inBand rejects the center and off-view points', async () => {
  const w = await loadRenderer('stella/wander.js');
  const view = { w: 1000, h: 600 };
  assert.equal(w.inBand({ x: 500, y: 300 }, R, view), false);
  assert.equal(w.inBand({ x: 250, y: 300 }, R, view), false); // circle overlaps zone edge
  assert.equal(w.inBand({ x: 100, y: 300 }, R, view), true);
  assert.equal(w.inBand({ x: 10, y: 300 }, R, view), false);
});

test('paths start and end exactly and bend smoothly', async () => {
  const w = await loadRenderer('stella/wander.js');
  const random = mulberry32(42);
  for (let i = 0; i < 200; i++) {
    const from = { x: random() * 1000, y: random() * 600 };
    const to = { x: random() * 1000, y: random() * 600 };
    const path = w.makePath(from, to, random);
    assert.deepEqual(w.pointOnPath(path, 0), from);
    assert.deepEqual(w.pointOnPath(path, 1), to);
    const chord = Math.hypot(to.x - from.x, to.y - from.y);
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const off = Math.hypot(path.control.x - mid.x, path.control.y - mid.y);
    assert.ok(off >= 0.15 * chord - 1e-6 && off <= 0.30 * chord + 1e-6, 'bend 15-30%');
    assert.ok(path.length >= chord - 1e-6);
    let prev = w.pointOnPath(path, 0), maxStep = 0;
    for (let k = 1; k <= 100; k++) {
      const p = w.pointOnPath(path, k / 100);
      maxStep = Math.max(maxStep, Math.hypot(p.x - prev.x, p.y - prev.y));
      prev = p;
    }
    assert.ok(maxStep <= path.length * 0.03 + 1e-6, `smooth step ${maxStep} vs ${path.length}`);
  }
  // both sides get used
  const sides = new Set();
  for (let i = 0; i < 40; i++) {
    const p = w.makePath({ x: 0, y: 0 }, { x: 100, y: 0 }, random);
    sides.add(Math.sign(p.control.y));
  }
  assert.equal(sides.size, 2);
});

test('travel and rest durations in range', async () => {
  const w = await loadRenderer('stella/wander.js');
  assert.equal(w.travelDuration({ length: 10 }), 2500);
  assert.equal(w.travelDuration({ length: 60000 }), 20000);
  assert.equal(w.travelDuration({ length: 300 }), 10000);
  const random = mulberry32(7);
  for (let i = 0; i < 500; i++) {
    const r = w.restDuration(random);
    assert.ok(r >= 30000 && r <= 180000);
  }
  assert.equal(w.restDuration(() => 0), 30000);
});

test('beside-target never overlaps the target and stays in view', async () => {
  const w = await loadRenderer('stella/wander.js');
  const view = { w: 1280, h: 680 };
  const targets = [
    { x: 0, y: 0, w: 120, h: 80 }, { x: 1160, y: 0, w: 120, h: 80 },
    { x: 0, y: 600, w: 120, h: 80 }, { x: 1160, y: 600, w: 120, h: 80 },
    { x: 0, y: 300, w: 100, h: 100 }, { x: 1180, y: 300, w: 100, h: 100 },
    { x: 600, y: 0, w: 100, h: 60 }, { x: 600, y: 620, w: 100, h: 60 },
    { x: 540, y: 290, w: 200, h: 100 },
  ];
  for (const target of targets) {
    for (const from of [{ x: 70, y: 70 }, { x: 1200, y: 600 }, { x: 640, y: 340 }]) {
      const p = w.besideTarget({ target, radius: R, view, from });
      assert.ok(inView(p, R, view), `in view for ${JSON.stringify(target)}`);
      assert.ok(rectDist(p, target) >= R, `no overlap for ${JSON.stringify(target)}`);
    }
  }
  // prefers the closest side
  const p = w.besideTarget({ target: { x: 540, y: 290, w: 200, h: 100 }, radius: R, view, from: { x: 100, y: 340 } });
  assert.ok(p.x < 540);
});

test('beside-target falls back to the farthest in-view point for huge targets', async () => {
  const w = await loadRenderer('stella/wander.js');
  const view = { w: 1000, h: 600 };
  const target = { x: 100, y: 50, w: 800, h: 500 };
  const p = w.besideTarget({ target, radius: R, view, from: { x: 500, y: 300 } });
  assert.ok(inView(p, R, view));
  const cx = 500, cy = 300;
  const d = Math.hypot(p.x - cx, p.y - cy);
  const corners = [[R, R], [view.w - R, R], [R, view.h - R], [view.w - R, view.h - R]];
  const best = Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy)));
  assert.ok(d >= best - 1e-6);
});

test('edge placement faces the other display', async () => {
  const w = await loadRenderer('stella/wander.js');
  const view = { w: 1000, h: 600 };
  const from = { x: 400, y: 200 };
  assert.deepEqual(w.edgeToward({ direction: 'left', radius: R, view, from }), { x: R, y: 200 });
  assert.deepEqual(w.edgeToward({ direction: 'right', radius: R, view, from }), { x: 1000 - R, y: 200 });
  assert.deepEqual(w.edgeToward({ direction: 'up', radius: R, view, from }), { x: 400, y: R });
  assert.deepEqual(w.edgeToward({ direction: 'down', radius: R, view, from }), { x: 400, y: 600 - R });
  assert.deepEqual(w.edgeToward({ direction: 'left', radius: R, view, from: { x: 5, y: 9999 } }), { x: R, y: 600 - R });
});

test('planWander paths never cross the center or leave the view', async () => {
  const w = await loadRenderer('stella/wander.js');
  for (const view of VIEWS) {
    const random = mulberry32(view.w * 13 + view.h);
    let from = { x: R, y: R };
    for (let i = 0; i < 2000; i++) {
      const path = w.planWander({ from, radius: R, view, random });
      assert.ok(w.pathClear(path, R, view), `clear path in ${view.w}x${view.h}`);
      assert.deepEqual(w.pointOnPath(path, 0), from);
      from = w.pointOnPath(path, 1);
    }
  }
});

test('pathClear rejects a left-to-right hop through the center', async () => {
  const w = await loadRenderer('stella/wander.js');
  const view = { w: 1280, h: 680 };
  const path = w.makePath({ x: 100, y: 340 }, { x: 1180, y: 340 }, () => 0.5);
  assert.equal(w.pathClear(path, R, view), false);
  const ok = w.makePath({ x: 100, y: 100 }, { x: 100, y: 500 }, () => 0.5);
  assert.equal(w.pathClear({ ...ok, control: { x: 100, y: 300 } }, R, view), true);
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadRenderer } = require('./helpers/esm.js');

const TAU = Math.PI * 2;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const blendOf = (o = {}) => ({ listen: 0, think: 0, speak: 0, rest: 0, level: 0, ...o });
const IDLE = { name: null, envelope: 0, energy: 0.5 };

async function load() { return loadRenderer('stella/scene.js'); }

function scene(m, o = {}) {
  const clock = o.clock || new m.SceneClock();
  return m.buildScene({ s: 360, t: 0, clock, blend: blendOf(o.blend), idle: o.idle || IDLE,
    motions: o.motions || {}, aim: o.aim ?? null, reduced: !!o.reduced, fold: o.fold });
}

test('geometry matches the reference', async () => {
  const m = await load();
  const sc = scene(m);
  near(sc.R, 169.2, 1e-9, 'R');
  assert.equal(sc.s, 360);
  assert.equal(sc.blades.length, 4);
  sc.blades.forEach((b, k) => {
    near(b.angle, Math.PI / 4 + k * Math.PI / 2, 1e-9, `blade ${k} angle`);
    near(b.rIn, 0.53 * sc.R, 1e-6, 'rIn');
    near(b.rOut, 0.97 * sc.R, 1e-6, 'rOut');
    near(b.wIn, 40, 1e-9, 'wIn');
    near(b.wOut, 1.5, 1e-9, 'wOut');
    assert.equal(b.seed, k);
  });
  assert.equal(sc.sticks.length, 4);
  sc.sticks.forEach((b, k) => {
    near(wrap(b.angle - (k * Math.PI / 2 - 0.05)), 0, 1e-9, `stick ${k} angle`);
    near(b.rIn, 0.54 * sc.R, 1e-6, 'stick rIn');
    near(b.rOut, 0.78 * sc.R, 1e-6, 'stick rOut');
    near(b.wIn, 20, 1e-9, 'stick wIn');
    assert.equal(b.seed, k + 4);
  });
  assert.equal(sc.dots.length, 104);
  for (const d of sc.dots) {
    const dist = Math.hypot(d.x - 180, d.y - 180);
    assert.ok(dist > 0.3 * sc.R && dist < 0.95 * sc.R, `dot dist ${dist}`);
    assert.ok(d.alpha > 0 && d.alpha <= 1);
  }
  near(sc.ring.r, 0.4 * sc.R, 1e-6, 'ring r');
  near(sc.globe.r, 0.8 * sc.ring.r, 1e-6, 'globe r');
  near(sc.globe.pitch, -0.35, 1e-9, 'pitch');
  assert.equal(sc.globe.scan, null);
  assert.equal(sc.fold, 0);
  // deterministic dots
  assert.deepEqual(scene(m).dots, sc.dots);
});

test('angles accumulate, never jump when speed changes', async () => {
  const m = await load();
  const clock = new m.SceneClock();
  const dt = 1 / 60, keys = ['spin', 'blades', 'sticks', 'ringTurn'];
  let prev = { ...clock }, prevChase = clock.chase, maxD = 0, maxChase = 0;
  for (let i = 0; i < 600; i++) {
    const think = i < 120 ? 0 : 1; // abrupt switch
    clock.step(dt, blendOf({ think }), IDLE, {});
    for (const k of keys) maxD = Math.max(maxD, Math.abs(clock[k] - prev[k]));
    maxChase = Math.max(maxChase, Math.abs(clock.chase - prevChase));
    const sc = m.buildScene({ s: 360, t: i * dt, clock, blend: blendOf({ think }), idle: IDLE, motions: {} });
    if (i > 0) for (let k = 0; k < 4; k++) assert.ok(Math.abs(wrap(sc.blades[k].angle - prev.sc.blades[k].angle)) < 0.05);
    prev = { ...clock, sc }; prevChase = clock.chase;
  }
  assert.ok(maxD < 0.05, `max delta ${maxD}`);
  assert.ok(maxChase < 0.08, `chase delta ${maxChase}`);
  assert.ok(clock.blades > 5, 'blades accumulated');
});

test('speaking widens and extends', async () => {
  const m = await load();
  const quiet = scene(m, { blend: { speak: 1, level: 0 } });
  const loud = scene(m, { blend: { speak: 1, level: 1 } });
  assert.ok(loud.blades[0].wIn > quiet.blades[0].wIn);
  assert.ok(loud.blades[0].rOut > quiet.blades[0].rOut);
  assert.ok(loud.globe.heart.r > quiet.globe.heart.r);
  assert.ok(loud.globe.wavy > quiet.globe.wavy);
});

test('aim turns the nearest blade the short way', async () => {
  const m = await load();
  const base = scene(m);
  const aim = -2.0; // nearest blade is 5π/4 (≡ -2.356), the short way is +0.356
  const sc = scene(m, { aim, motions: { aim: 1 } });
  const moved = sc.blades.map((b, k) => Math.abs(b.angle - base.blades[k].angle));
  const k = moved.indexOf(Math.max(...moved));
  assert.equal(k, 2);
  near(wrap(sc.blades[2].angle - aim), 0, 1e-9, 'points at aim');
  assert.ok(sc.blades[2].angle - base.blades[2].angle > 0 && moved[2] < Math.PI / 4, 'short way');
  near(sc.blades[2].rOut, base.blades[2].rOut * 1.15, 1e-6, 'extended');
  for (const j of [0, 1, 3]) near(moved[j], 0, 1e-12, `blade ${j} still`);
  const half = scene(m, { aim, motions: { aim: 0.5 } });
  assert.ok(half.blades[2].angle > base.blades[2].angle && half.blades[2].angle < sc.blades[2].angle, 'eased');
});

test('reduced motion removes flicker and jitter', async () => {
  const m = await load();
  const motions = { glitch: 1, ticks: 1 };
  const full = m.buildScene({ s: 360, t: 0.37, clock: new m.SceneClock(), blend: blendOf(), idle: IDLE, motions });
  assert.equal(full.sheen.flicker, true);
  assert.ok(Math.hypot(full.cx - 180, full.cy - 180) > 0, 'glitch jitters');
  const red = m.buildScene({ s: 360, t: 0.37, clock: new m.SceneClock(), blend: blendOf(), idle: IDLE, motions, reduced: true });
  assert.equal(red.sheen.flicker, false);
  assert.equal(red.cx, 180);
  assert.equal(red.cy, 180);
  // angular speeds x0.1 and idle variations ignored
  const a = new m.SceneClock(), b = new m.SceneClock();
  const sway = { name: 'speedShift', envelope: 1, energy: 0.5 };
  for (let i = 0; i < 300; i++) { a.step(1 / 60, blendOf(), sway, {}); b.step(1 / 60, blendOf(), sway, {}, { reduced: true }); }
  const plain = new m.SceneClock();
  for (let i = 0; i < 300; i++) plain.step(1 / 60, blendOf(), IDLE, {});
  near(b.blades, plain.blades * 0.1, 1e-9, 'reduced blades');
  assert.ok(Math.abs(a.blades - plain.blades) > 0.1, 'idle applies when not reduced');
});

test('rest dims', async () => {
  const m = await load();
  const awake = scene(m), rest = scene(m, { blend: { rest: 1 } });
  near(rest.brightness, 0.45, 1e-9, 'brightness');
  assert.ok(rest.ring.alpha < awake.ring.alpha);
  assert.ok(rest.ambient < awake.ambient);
  assert.ok(rest.dots[0].alpha < awake.dots[0].alpha);
  const a = new m.SceneClock(), b = new m.SceneClock();
  for (let i = 0; i < 600; i++) { a.step(1 / 60, blendOf(), IDLE, {}); b.step(1 / 60, blendOf({ rest: 1 }), IDLE, {}); }
  near(b.blades / a.blades, 0.3, 0.01, 'rest speed');
});

test('fold collapses to a point and scan reports a band', async () => {
  const m = await load();
  const half = scene(m, { fold: 0.5 }), full = scene(m, { fold: 1 });
  assert.equal(full.fold, 1);
  near(full.ring.r, 0, 1e-9, 'ring');
  for (const b of full.blades) near(b.rOut, b.rIn, 1e-9, 'blade folded');
  assert.ok(half.point.alpha > 0.5, 'bright point mid-fold');
  near(full.point.alpha, 0, 1e-9, 'point fades out');
  const clock = new m.SceneClock();
  for (let i = 0; i < 30; i++) clock.step(1 / 60, blendOf(), IDLE, { scan: 1 });
  const sc = m.buildScene({ s: 360, t: 0.5, clock, blend: blendOf(), idle: IDLE, motions: { scan: 1 } });
  assert.ok(sc.globe.scan > 0 && sc.globe.scan < 1);
});

test('celebrate adds a full turn smoothly', async () => {
  const m = await load();
  const a = new m.SceneClock(), b = new m.SceneClock();
  let maxStep = 0, prev = 0;
  for (let i = 0; i < 180; i++) {
    const env = i > 0 && i < 84 ? 1 : 0;
    a.step(1 / 60, blendOf(), IDLE, {});
    b.step(1 / 60, blendOf(), IDLE, { celebrate: env });
    maxStep = Math.max(maxStep, Math.abs(b.burst - prev)); prev = b.burst;
  }
  near(b.burst, TAU, 1e-9, 'burst');
  assert.ok(maxStep < 0.15, `burst step ${maxStep}`);
});

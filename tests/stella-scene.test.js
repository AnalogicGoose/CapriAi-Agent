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
    for (const k of keys) maxD = Math.max(maxD, Math.abs(wrap(clock[k] - prev[k]))); // blades/sticks wrap at 2pi
    maxChase = Math.max(maxChase, Math.abs(clock.chase - prevChase));
    const sc = m.buildScene({ s: 360, t: i * dt, clock, blend: blendOf({ think }), idle: IDLE, motions: {} });
    if (i > 0) for (let k = 0; k < 4; k++) assert.ok(Math.abs(wrap(sc.blades[k].angle - prev.sc.blades[k].angle)) < 0.05);
    prev = { ...clock, sc }; prevChase = clock.chase;
  }
  assert.ok(maxD < 0.05, `max delta ${maxD}`);
  assert.ok(maxChase < 0.08, `chase delta ${maxChase}`);
  assert.ok(clock.blades > 0 && clock.blades < TAU, 'blades kept in [0, 2pi)');
});

test('long sessions: angles stay in [0, 2pi) and frames stay continuous across the wrap', async () => {
  const m = await load();
  const clock = new m.SceneClock(), dt = 1 / 60;
  clock.step(dt, blendOf({ think: 1 }), IDLE, {});
  // a day and more of turning (and a counter-turning ring)
  Object.assign(clock, { spin: 1e6 + 0.3, ringTurn: -1e6 - 0.7, chase: 1e6 + 1.1, blades: 1e6 + 0.2, sticks: 1e6 + 0.25,
    orbit: 1e6 + 0.1 });
  const inTurn = (v, what) => assert.ok(v >= 0 && v < TAU, `${what} = ${v}`);
  let prev = null;
  for (let i = 0; i < 2000; i++) {
    clock.step(dt, blendOf({ think: 1 }), { name: 'dotDrift', envelope: 1, energy: 0.5 }, {});
    for (const k of ['blades', 'sticks', 'orbit']) inTurn(clock[k], k);
    const sc = m.buildScene({ s: 360, t: i * dt, clock, blend: blendOf({ think: 1 }), idle: IDLE, motions: {} });
    inTurn(sc.globe.yaw, 'yaw'); inTurn(sc.ring.turn, 'ring.turn'); inTurn(sc.ring.chase.angle, 'chase.angle');
    if (prev) {
      for (const [a, b] of [[sc.globe.yaw, prev.globe.yaw], [sc.ring.turn, prev.ring.turn], [sc.ring.chase.angle, prev.ring.chase.angle],
        ...sc.blades.map((x, k) => [x.angle, prev.blades[k].angle]), ...sc.sticks.map((x, k) => [x.angle, prev.sticks[k].angle])]) {
        assert.ok(Math.abs(wrap(a - b)) < 0.1, `jump ${a} -> ${b}`);
      }
      for (let k = 0; k < sc.dots.length; k++) assert.ok(Math.hypot(sc.dots[k].x - prev.dots[k].x, sc.dots[k].y - prev.dots[k].y) < 12, `dot jump ${i} ${Math.hypot(sc.dots[k].x - prev.dots[k].x, sc.dots[k].y - prev.dots[k].y)}`);
    }
    prev = sc;
  }
});

test('speaking widens and extends', async () => {
  const m = await load();
  const quiet = scene(m, { blend: { speak: 1, level: 0 } });
  const loud = scene(m, { blend: { speak: 1, level: 1 } });
  assert.ok(loud.blades[0].wIn > quiet.blades[0].wIn);
  assert.ok(loud.blades[0].rOut > quiet.blades[0].rOut);
  assert.ok(loud.globe.heart.r > quiet.globe.heart.r);
  assert.ok(loud.globe.wavy > quiet.globe.wavy);
  near(quiet.ring.glow, 0.14, 1e-9, 'quiet ring glow');
  near(loud.ring.glow, 0.29, 1e-9, 'loud ring glow');
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

// ---- review round 1 ----
const ramp = (x, a, b) => Math.min(1, Math.max(0, (x - a) / (b - a)));
const maxima = xs => xs.filter((v, i) => i > 0 && i < xs.length - 1 && v > xs[i - 1] && v >= xs[i + 1] && v - Math.min(...xs) > 1e-6).length;

test('angular rates stay continuous when think switches abruptly', async () => {
  const m = await load();
  const clock = new m.SceneClock(), dt = 1 / 60, keys = ['spin', 'blades', 'sticks', 'chase', 'ringTurn'];
  const hist = [];
  for (let i = 0; i < 300; i++) {
    clock.step(dt, blendOf({ think: i < 60 ? 0 : 1 }), IDLE, {});
    hist.push(Object.fromEntries(keys.map(k => [k, clock[k]])));
  }
  for (let i = 2; i < hist.length; i++) for (const k of keys) {
    const d2 = wrap(hist[i][k] - hist[i - 1][k]) - wrap(hist[i - 1][k] - hist[i - 2][k]); // blades/sticks wrap at 2pi
    assert.ok(Math.abs(d2) < 0.004, `${k} second difference ${d2} at ${i}`);
  }
});

test('a held aim never makes a blade jump', async () => {
  const m = await load();
  const clock = new m.SceneClock(), dt = 1 / 60;
  let prev = null;
  for (let i = 0; i < 600; i++) {
    const t = i * dt, motions = { aim: ramp(t, 0, 0.3) };
    clock.step(dt, blendOf(), IDLE, motions, { aim: 1.0 });
    const sc = m.buildScene({ s: 360, t, clock, blend: blendOf(), idle: IDLE, motions, aim: 1.0 });
    if (prev) sc.blades.forEach((b, k) => assert.ok(Math.abs(wrap(b.angle - prev[k])) < 0.05, `blade ${k} at ${t}`));
    if (t > 0.5) assert.ok(sc.blades.some(b => Math.abs(wrap(b.angle - 1.0)) < 1e-6), 'one blade on target');
    prev = sc.blades.map(b => b.angle);
  }
  // a jump in the input aim glides instead of passing straight through
  const before = m.buildScene({ s: 360, t: 10, clock, blend: blendOf(), idle: IDLE, motions: { aim: 1 }, aim: 1.0 });
  clock.step(dt, blendOf(), IDLE, { aim: 1 }, { aim: 2.5 });
  const after = m.buildScene({ s: 360, t: 10 + dt, clock, blend: blendOf(), idle: IDLE, motions: { aim: 1 }, aim: 2.5 });
  const moved = Math.max(...after.blades.map((b, k) => Math.abs(wrap(b.angle - before.blades[k].angle))));
  assert.ok(moved > 0.01 && moved < 0.3, `aim jump glides: ${moved}`);
});

test('drifted phases settle back to the reference layout', async () => {
  const m = await load();
  const clock = new m.SceneClock(), dt = 1 / 60;
  for (let i = 0; i < 6 * 60; i++) {
    const t = i * dt; // dotDrift for 1.2 s, then counterTurn for 1.3 s, then 3.5 s of nothing
    const name = t < 1.2 ? 'dotDrift' : t < 2.5 ? 'counterTurn' : null;
    const e = name === 'dotDrift' ? Math.sin(Math.PI * t / 1.2) : name ? Math.sin(Math.PI * (t - 1.2) / 1.3) : 0;
    clock.step(dt, blendOf(), { name, envelope: e, energy: 0.5 }, {});
  }
  const q = Math.PI / 2;
  const off = x => Math.abs(x - Math.round(x / q) * q);
  assert.ok(off(clock.orbit) < 0.01, `orbit residual ${off(clock.orbit)}`);
  assert.ok(off(clock.sticks - clock.blades) < 0.01, `stick residual ${off(clock.sticks - clock.blades)}`);
});

async function timedSeries(m, name, pick) {
  const clock = new m.SceneClock(), dt = 1 / 60, out = [];
  for (let t = 0; t < 2; t += dt) {
    const motions = t < 1.95 ? { [name]: 1 } : {};
    clock.step(dt, blendOf(), IDLE, motions);
    out.push(pick(m.buildScene({ s: 360, t: t + 0.123, clock, blend: blendOf(), idle: IDLE, motions })));
  }
  return out;
}

test('doublePulse swells twice and chime pulses three times', async () => {
  const m = await load();
  assert.equal(maxima(await timedSeries(m, 'doublePulse', sc => sc.scale)), 2);
  assert.equal(maxima(await timedSeries(m, 'chime', sc => sc.ring.alpha)), 3);
});

test('toggling reduced motion at runtime does not snap', async () => {
  const m = await load();
  const clock = new m.SceneClock(), dt = 1 / 60;
  const idle = { name: 'sway', envelope: 1, energy: 0.5 };
  let prev = null;
  for (let i = 0; i < 300; i++) {
    const reduced = i >= 120;
    clock.step(dt, blendOf(), idle, {}, { reduced });
    const sc = m.buildScene({ s: 360, t: i * dt, clock, blend: blendOf(), idle, motions: {}, reduced });
    if (prev) {
      sc.blades.forEach((b, k) => assert.ok(Math.abs(b.angle - prev.blades[k].angle) < 0.05, `blade jump at ${i}`));
      assert.ok(Math.abs(sc.scale - prev.scale) < 0.01, 'scale eases');
      assert.ok(Math.abs(sc.globe.rippleSpeed - prev.globe.rippleSpeed) < 0.2, 'ripple speed eases');
    }
    prev = sc;
  }
  assert.ok(clock.rippleSpeed < 0.5, 'ripple slowed x0.1');
});

test('releasing a long-held aim never whirls the blade', async () => {
  const m = await load();
  for (const think of [0, 1]) {
    const clock = new m.SceneClock(), dt = 1 / 60, blend = blendOf({ think });
    let prev = null, maxJump = 0;
    for (let i = 0; i < 16 * 60; i++) {
      const t = i * dt, ae = t < 10 ? ramp(t, 0, 0.3) : 1 - ramp(t, 10, 10.3); // hold 10 s, ease out over 0.3 s
      const motions = { aim: ae };
      clock.step(dt, blend, IDLE, motions, { aim: 1.0 });
      const sc = m.buildScene({ s: 360, t, clock, blend, idle: IDLE, motions, aim: 1.0 });
      if (prev) sc.blades.forEach((b, k) => { maxJump = Math.max(maxJump, Math.abs(wrap(b.angle - prev[k]))); });
      prev = sc.blades.map(b => b.angle);
    }
    assert.ok(maxJump < 0.05, `think=${think}: max per-frame blade jump ${maxJump}`);
    assert.equal(clock.aimIndex, null, 'aim lock released');
    assert.ok(Math.abs(clock.aimDelta) <= Math.PI, 'delta bounded');
  }
});

test('glitch jitter and flicker fade with the eased reduced factor', async () => {
  const m = await load();
  const clock = new m.SceneClock(), dt = 1 / 60, motions = { glitch: 1, ticks: 1 };
  let prev = null;
  for (let i = 0; i < 240; i++) {
    const reduced = i >= 60;
    clock.step(dt, blendOf(), IDLE, motions, { reduced });
    const sc = m.buildScene({ s: 360, t: i * dt, clock, blend: blendOf(), idle: IDLE, motions, reduced });
    if (prev && i > 60) assert.ok(sc.sheen.flickerBoost <= prev.sheen.flickerBoost + 1e-12, 'boost eases down');
    if (i === 61) assert.ok(sc.sheen.flickerBoost > 0.5 && sc.sheen.flicker, 'no instant cut');
    prev = sc;
  }
  assert.ok(prev.sheen.flickerBoost < 0.01 && !prev.sheen.flicker, 'off once reduced settles');
  assert.ok(Math.hypot(prev.cx - 180, prev.cy - 180) < 0.02, 'jitter gone');
});

test('sheen band phase stays continuous when shineWave changes its speed', async () => {
  const m = await load();
  const clock = new m.SceneClock(), dt = 1 / 60, wave = { name: 'shineWave', envelope: 1, energy: 0.5 };
  // Distance on the 1.4 loop the band position travels.
  const loop = d => Math.min(Math.abs(d), 1.4 - Math.abs(d));
  let prev = null, prevSeeds = null, sawWrap = false, fast = 0, slow = 0;
  for (let i = 0; i < 1200; i++) {
    // Abrupt speed toggles every 0.5 s, then a smooth ramp in and out.
    const ramp = i < 600 ? (Math.floor(i / 30) % 2) : 0.5 - 0.5 * Math.cos(TAU * (i - 600) / 300);
    const idle = { ...wave, envelope: ramp };
    clock.step(dt, blendOf(), idle, {});
    const sc = m.buildScene({ s: 360, t: i * dt, clock, blend: blendOf(), idle, motions: {} });
    const ph = sc.sheen.phase;
    assert.ok(ph >= 0 && ph < 1.4, `phase in range: ${ph}`);
    near(sc.sheen.speed, 0.45 * (1 + ramp), 1e-9, 'speed field kept');
    if (prev != null) {
      const step = loop(ph - prev);
      if (ph < prev) sawWrap = true;
      assert.ok(step <= 0.9 * dt + 1e-9, `phase jumped ${step} at frame ${i}`);
      if (step > 0.6 * dt) fast++; else slow++;
    }
    // Per-seed band positions (phase + seed * seedStep) stay continuous on the smooth ramp.
    const seeds = Array.from({ length: 8 }, (_, k) => (ph + k * sc.sheen.seedStep) % 1.4);
    if (i > 600 && prevSeeds) seeds.forEach((v, k) => assert.ok(loop(v - prevSeeds[k]) < 0.02, `seed ${k} jumped`));
    prev = ph; prevSeeds = seeds;
  }
  assert.ok(sawWrap, 'phase wraps at 1.4');
  assert.ok(fast > 100 && slow > 100, `both speeds used (fast ${fast}, slow ${slow})`);
});

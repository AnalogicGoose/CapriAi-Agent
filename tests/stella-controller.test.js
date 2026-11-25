'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadRenderer } = require('./helpers/esm.js');

const listeners = () => {
  const on = {};
  return { on, addEventListener: (type, fn) => { on[type] = fn; }, setPointerCapture() {}, releasePointerCapture() {},
    hasPointerCapture: () => false, style: {} };
};

// A Stella with a fake renderer, a manual clock and a manual frame queue.
async function make(o = {}) {
  const { Stella } = await loadRenderer('stella/stella.js');
  const clock = { t: 1000 };
  const frames = [];
  const draws = [];
  const saved = [];
  let reduced = !!o.reduced;
  const renderer = { setSize(css, dpr) { this.size = css; }, draw(scene, t) { draws.push(scene); } };
  const stella = new Stella({
    root: listeners(), canvas: listeners(), voice: { play() {} }, renderer,
    now: () => clock.t, schedule: fn => frames.push(fn), random: o.random || (() => 0.5),
    reduced: () => reduced, saveAnchor: p => saved.push({ ...p }), view: o.view || { w: 1920, h: 1080 },
    anchor: o.anchor, wander: o.wander,
  });
  const step = (ms = 1000 / 60, n = 1) => {
    for (let i = 0; i < n; i++) {
      clock.t += ms;
      const fn = frames.shift();
      if (fn) fn(clock.t);
    }
  };
  return { stella, clock, step, draws, saved, renderer, setReduced: v => { reduced = v; } };
}

const R = s => s.size / 2;
const fullyVisible = (s, p = s.pos) =>
  p.x >= R(s) - 1e-6 && p.y >= R(s) - 1e-6 && p.x <= s.view.w - R(s) + 1e-6 && p.y <= s.view.h - R(s) + 1e-6;

test('exposes every member the renderer calls', async () => {
  const { stella } = await make();
  const members = ['act', 'attend', 'busy', 'cancelDrag', 'canSit', 'celebrate', 'chatThinking', 'chipAt', 'companion',
    'dormant', 'doze', 'dragging', 'earnUplink', 'endAct', 'gaze', 'goToWork', 'head', 'hit', 'hurt', 'intro', 'mode',
    'onClick', 'onDoze', 'onGaze', 'onIdleWave', 'onMenu', 'onMode', 'onMove', 'onPointerHold', 'onStow', 'onTeleport',
    'onUnstow', 'perform', 'pickSeat', 'pointerHeld', 'pos', 'possess', 'possessWindows', 'pulse', 'reactToAction',
    'reactToTool', 'requestPosture', 'scale', 'setChatThinking', 'setMode', 'setScale', 'setView', 'setWindows', 'sitOn',
    'spark', 'speechLevel', 'spot', 'towardCenter', 'unpeek', 'view', 'wake', 'windows', 'zap',
    'agentActivity', 'wakeHeard', 'stance'];
  for (const k of members) assert.ok(k in stella, `missing ${k}`);
  for (const k of ['setMode', 'wake', 'endAct', 'setChatThinking', 'setScale', 'setView', 'head', 'towardCenter', 'hit',
    'spot', 'cancelDrag', 'perform', 'reactToTool', 'reactToAction', 'agentActivity', 'wakeHeard', 'pulse', 'hurt',
    'celebrate', 'spark', 'zap', 'gaze', 'earnUplink', 'attend', 'goToWork', 'sitOn', 'possess', 'doze', 'unpeek',
    'intro', 'canSit', 'pickSeat', 'requestPosture', 'setWindows']) assert.equal(typeof stella[k], 'function', k);
  assert.equal(stella.stance, 'float');
  assert.equal(stella.mode, 'idle');
  assert.equal(stella.dormant, false);
  assert.equal(stella.size, 150);
  stella.setScale(0.1);
  assert.equal(stella.size, 96);
  assert.equal(stella.canSit(), false);
  assert.equal(stella.pickSeat(), null);
  for (const k of ['debug', 'facing', 'sky', 'uplinkDay', 'mission', 'js', 'setStance']) assert.ok(!(k in stella), `has ${k}`);
});

test('setMode reports the change', async () => {
  const { stella } = await make();
  const seen = [];
  stella.onMode = (m, prev) => seen.push([m, prev]);
  stella.setMode('work');
  stella.setMode('work');
  stella.goToWork();
  stella.setMode('sleep');
  stella.wake();
  assert.deepEqual(seen, [['work', 'idle'], ['sleep', 'work'], ['idle', 'sleep']]);
});

test('drag follows smoothly and settles clamped', async () => {
  for (const drop of [{ x: -50, y: -50 }, { x: 960, y: 540 }]) {
    const { stella, step, saved } = await make();
    const moves = [];
    stella.onMove = h => moves.push(h);
    stella.pos = { x: 1500, y: 800 };
    step();
    assert.ok(stella.pointerDown(1500, 800));
    assert.equal(stella.pointerHeld, true);
    stella.pointerMove(1502, 801);
    assert.equal(stella.dragging, false, 'under the 5 px threshold');
    let last = { ...stella.pos }, maxJump = 0;
    const path = 30;
    for (let i = 1; i <= path; i++) {
      stella.pointerMove(1500 + (drop.x - 1500) * i / path, 800 + (drop.y - 800) * i / path);
      step();
      maxJump = Math.max(maxJump, Math.hypot(stella.pos.x - last.x, stella.pos.y - last.y));
      last = { ...stella.pos };
    }
    assert.equal(stella.dragging, true);
    assert.ok(maxJump < 120, `smooth follow (jump ${maxJump})`);
    stella.pointerUp(drop.x, drop.y);
    assert.equal(stella.dragging, false);
    assert.equal(stella.pointerHeld, false);
    step(1000 / 60, 120);
    assert.ok(fullyVisible(stella), `visible at ${JSON.stringify(stella.pos)}`);
    assert.equal(saved.length, 1);
    const expect = { x: Math.max(R(stella), drop.x), y: Math.max(R(stella), drop.y) };
    assert.deepEqual(saved[0], expect);
    assert.ok(Math.hypot(stella.pos.x - expect.x, stella.pos.y - expect.y) < 1, 'settled on the drop point');
    assert.ok(moves.length > 10);
  }
});

test('click without drag calls onClick', async () => {
  const { stella, step, saved } = await make();
  let clicks = 0;
  stella.onClick = () => clicks++;
  stella.pos = { x: 400, y: 400 };
  assert.equal(stella.pointerDown(900, 900), false, 'misses her');
  assert.ok(stella.pointerDown(402, 401));
  stella.pointerMove(404, 403);
  stella.pointerUp(404, 403);
  step();
  assert.equal(clicks, 1);
  assert.equal(saved.length, 0);
  assert.deepEqual(stella.pos, { x: 400, y: 400 });
});

test('setView shrink re-clamps her inside', async () => {
  const { stella, step } = await make();
  stella.pos = { x: 1800, y: 1000 };
  step();
  stella.setView(800, 600);
  assert.ok(fullyVisible(stella));
  step(1000 / 60, 10);
  assert.ok(fullyVisible(stella));
  stella.setScale(2);
  assert.ok(fullyVisible(stella));
});

test('reduced motion stops travel in place', async () => {
  const { stella, step, setReduced, saved } = await make();
  stella.pos = { x: 1600, y: 900 };
  step();
  stella.pointerDown(1600, 900);
  for (let i = 1; i <= 10; i++) stella.pointerMove(1600 - i * 80, 900 - i * 50);
  stella.pointerMove(400, 200);
  step();
  stella.pointerUp(400, 200);
  step();
  assert.ok(stella.travel, 'settling');
  setReduced(true);
  step();
  const at = { ...stella.pos };
  assert.equal(stella.travel, null);
  step(1000 / 60, 30);
  assert.deepEqual(stella.pos, at, 'no further movement');
  assert.deepEqual(stella.anchor, at);
  assert.equal(saved.length, 1);
  assert.ok(fullyVisible(stella));
});

test('routine tool bursts don\'t flicker', async () => {
  const { stella, step } = await make();
  const starts = [];
  const play = stella.motions.play.bind(stella.motions);
  stella.motions.play = (name, now) => { const ok = play(name, now); if (ok) starts.push(name); return ok; };
  for (let i = 0; i < 10; i++) { stella.reactToTool('Read'); step(100); }
  assert.deepEqual(starts, ['scan']);
});

test('requestPosture replies in character', async () => {
  const { stella } = await make();
  const reply = await stella.requestPosture(true);
  assert.match(reply, /float/);
});

test('act reports the active motion', async () => {
  const { stella, step } = await make();
  assert.equal(stella.act, null);
  let done = false;
  stella.perform('curious').then(() => { done = true; });
  assert.equal(stella.act.player.name, 'pulse');
  step(100);
  assert.equal(stella.busy, false, 'routine motions do not make her busy');
  step(1000 / 60, 40);
  await new Promise(r => setImmediate(r));
  assert.equal(stella.act, null);
  assert.equal(done, true);
  stella.hurt();
  assert.equal(stella.act.player.name, 'glitch');
  assert.equal(stella.busy, true);
  stella.endAct(false);
  assert.equal(stella.act, null);
  assert.equal(await stella.perform('talk'), undefined, 'unknown acts resolve');
});

test('loop survives bad dt and speech levels, and pauses drawing when hidden', async () => {
  const { stella, step, clock, draws } = await make();
  stella.speechLevel = NaN;
  step();
  clock.t -= 5000; step(); step(10000);
  assert.ok(draws.length >= 3);
  for (const sc of draws) assert.ok(Number.isFinite(sc.R));
  stella.hidden = true;
  const n = draws.length;
  step(1000 / 60, 5);
  assert.equal(draws.length, n);
});

test('agent activity holds and music pulse', async () => {
  const { stella, step } = await make();
  stella.agentActivity({ tool: 'capri_approval', phase: 'start' });
  step();
  assert.ok(stella.motions.busy(stella.now()));
  stella.agentActivity({ tool: 'capri_approval', phase: 'end', ok: true });
  step(500);
  assert.ok(!stella.motions.busy(stella.now()));
  stella.agentActivity({ tool: 'capri_apps', op: 'play_music', phase: 'end', ok: true });
  step(100, 10);
  assert.ok((stella.motions.update(stella.now()).musicPulse || 0) > 0);
  step(1000, 46);
  assert.ok(!(stella.motions.update(stella.now()).musicPulse > 0), 'released after 45 s');
});

// ---------- Task 10: wandering, pointing, walkthrough focus, body actions ----------

const lcg = (seed = 1) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const distToRect = (p, r) => Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)));
const settle = () => new Promise(r => setImmediate(r));
const band = async () => (await loadRenderer('stella/wander.js')).inBand;
const DT = 50;

test('wandering stays in the band for an hour', async () => {
  const inBand = await band();
  const { stella, step } = await make({ random: lcg(7) });
  let starts = 0, maxJump = 0, out = 0;
  stella.onTeleport = p => { if (p === 'start') starts++; };
  assert.ok(inBand(stella.pos, R(stella), stella.view), 'first-run anchor is in the band');
  let last = { ...stella.pos };
  for (let i = 0; i < 3600 * 1000 / DT; i++) {
    step(DT);
    if (!inBand(stella.pos, R(stella), stella.view)) out++;
    maxJump = Math.max(maxJump, dist(stella.pos, last));
    last = { ...stella.pos };
  }
  assert.equal(out, 0, 'never left the band');
  assert.ok(starts >= 10, `she wandered (${starts} hops)`);
  assert.ok(maxJump < 6, `calm and continuous (${maxJump} px per frame)`);
});

test('first run anchor sits in the lower-right band', async () => {
  const inBand = await band();
  const { stella } = await make();
  assert.ok(Math.abs(stella.anchor.x - 1920 * 0.85) < 1 && Math.abs(stella.anchor.y - 1080 * 0.82) < 1, JSON.stringify(stella.anchor));
  assert.deepEqual(stella.pos, stella.anchor);
  assert.ok(inBand(stella.anchor, R(stella), stella.view));
  const small = await make({ view: { w: 800, h: 500 } });
  assert.ok(inBand(small.stella.anchor, R(small.stella), small.stella.view), 'nudged into the band');
});

test('wander off keeps her at the anchor', async () => {
  const { stella, step } = await make({ anchor: { x: 300, y: 900 }, wander: false, random: lcg(2) });
  assert.deepEqual(stella.pos, { x: 300, y: 900 });
  step(DT, 600 * 1000 / DT);
  assert.deepEqual(stella.pos, { x: 300, y: 900 });
  // and a function returns her to it exactly
  const p = stella.pointAt({ x: 1500, y: 100, w: 200, h: 100 });
  step(DT, 500);
  assert.ok(await p);
  stella.stopPointing();
  step(DT, 500);
  assert.deepEqual(stella.pos, { x: 300, y: 900 });
});

test('nextMove postpones travel', async () => {
  const { stella, step, clock } = await make({ random: lcg(4) });
  const at = { ...stella.pos };
  stella.nextMove = clock.t + 400000;
  step(DT, 399000 / DT);
  assert.deepEqual(stella.pos, at);
  assert.equal(stella.travel, null);
  step(DT, 2000 / DT);
  assert.ok(stella.travel, 'travels once nextMove has passed');
});

test('pointAt places her beside, never over, the target', async () => {
  const targets = [
    { x: 0, y: 0, w: 40, h: 40 }, { x: 1880, y: 0, w: 40, h: 40 }, { x: 0, y: 1040, w: 40, h: 40 },
    { x: 1880, y: 1040, w: 40, h: 40 }, { x: 940, y: 520, w: 40, h: 40 }, { x: 100, y: 300, w: 1500, h: 200 },
    { x: 960, y: 540 },
  ];
  for (const target of targets) {
    const { stella, step } = await make({ random: lcg(5) });
    const rect = target.w ? target : { ...target, w: 1, h: 1 };
    const p = stella.pointAt(target, { label: 'x' });
    step(DT, 500);
    assert.ok(await p, 'resolves truthy');
    assert.ok(distToRect(stella.pos, rect) >= R(stella), `over ${JSON.stringify(target)} at ${JSON.stringify(stella.pos)}`);
    assert.ok(fullyVisible(stella));
    const c = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    assert.ok(Math.abs(wrap(stella.aimAngle - Math.atan2(c.y - stella.pos.y, c.x - stella.pos.x))) < 0.02, 'aims at it');
    assert.ok(stella.motions.update(stella.now()).aim > 0.99, 'blade held');
    assert.equal(stella.pointing.dir, c.x < stella.pos.x ? -1 : 1);
    assert.equal(stella.canPoint(rect), true);
  }
  const { stella } = await make();
  assert.equal(stella.canPoint({ x: 2000, y: 10, w: 300, h: 300 }), false);
  assert.equal(stella.canPoint(null), false);
});

test('guide focus to another display goes to that edge and aims', async () => {
  const { stella, step } = await make({ random: lcg(6) });
  const p = stella.guideFocus({ direction: 'left' });
  step(DT, 500);
  assert.ok(await p);
  assert.ok(stella.pos.x <= R(stella) + 4, `at the left edge: ${stella.pos.x}`);
  assert.ok(Math.abs(wrap(stella.aimAngle - Math.PI)) < 1e-6);
  assert.ok(stella.motions.update(stella.now()).aim > 0.99);
  // a new focus: the aim swings at no more than 2 rad/s, the short way
  stella.guideFocus({ direction: 'right' });
  let prev = stella.aimAngle, maxRate = 0;
  for (let i = 0; i < 100; i++) {
    step(1000 / 60);
    maxRate = Math.max(maxRate, Math.abs(wrap(stella.aimAngle - prev)) * 60);
    prev = stella.aimAngle;
  }
  assert.ok(maxRate <= 2 + 1e-6, `swing ${maxRate} rad/s`);
  assert.ok(Math.abs(wrap(stella.aimAngle)) < 1e-6, 'reached the new side');
  const q = stella.guideFocus({ rect: { x: 1300, y: 100, w: 300, h: 200 } });
  step(DT, 500);
  assert.ok(await q);
  assert.ok(distToRect(stella.pos, { x: 1300, y: 100, w: 300, h: 200 }) >= R(stella));
});

test('guide end returns to the anchor area', async () => {
  const inBand = await band();
  const { stella, step } = await make({ anchor: { x: 1700, y: 900 }, random: lcg(8) });
  const p = stella.guideFocus({ rect: { x: 200, y: 100, w: 300, h: 200 } });
  step(DT, 500);
  await p;
  assert.ok(dist(stella.pos, { x: 1700, y: 900 }) > 500, 'went to the target');
  stella.guideFocus(null);
  step(DT, 500);
  assert.ok(dist(stella.pos, { x: 1700, y: 900 }) <= 200, `home: ${JSON.stringify(stella.pos)}`);
  assert.ok(inBand(stella.pos, R(stella), stella.view));
  assert.ok(!(stella.motions.update(stella.now()).aim > 0), 'blade released');
  assert.equal(stella.aimAngle, null);
  assert.equal(stella.pointing, null);
});

test('stopPointing returns after 1.5 s unless she points again', async () => {
  const { stella, step } = await make({ anchor: { x: 1700, y: 900 }, wander: false, random: lcg(8) });
  stella.pointAt({ x: 200, y: 100, w: 300, h: 200 });
  step(DT, 500);
  stella.stopPointing();
  step(DT, 20);
  assert.equal(stella.travel, null, 'waits 1.5 s');
  stella.pointAt({ x: 200, y: 600, w: 300, h: 200 });
  step(DT, 20);
  assert.equal(stella.travel?.reason, 'point', 'no stale return');
});

test('nap rests until wake', async () => {
  const { stella, step, clock } = await make({ random: lcg(10) });
  assert.equal(await stella.bodyAction('nap'), 'done');
  step(DT, 40);
  assert.equal(stella.blend.mode, 'rest');
  const at = { ...stella.pos };
  stella.nextMove = clock.t;
  step(DT, 300 * 1000 / DT);
  assert.deepEqual(stella.pos, at, 'no wandering while resting');
  assert.equal(await stella.bodyAction('wake'), 'done');
  step(DT);
  assert.equal(stella.blend.mode, 'idle');
  stella.nextMove = clock.t;
  step(DT, 2);
  assert.ok(stella.travel, 'wanders again');
  // a click wakes her too
  await stella.bodyAction('nap');
  stella.travel && step(DT, 500);
  stella.pointerDown(stella.pos.x, stella.pos.y);
  stella.pointerUp(stella.pos.x, stella.pos.y);
  step(DT);
  assert.equal(stella.blend.mode, 'idle');
  assert.match(await stella.bodyAction('sit'), /float/);
});

test('come stops outside the center zone', async () => {
  const inBand = await band();
  const start = { x: 1700, y: 900 };
  const { stella, step } = await make({ anchor: start, random: lcg(11) });
  const p = stella.bodyAction('come');
  let out = 0;
  for (let i = 0; i < 500; i++) { step(DT); if (!inBand(stella.pos, R(stella), stella.view)) out++; }
  assert.equal(await p, 'done');
  assert.equal(out, 0);
  const c = { x: 960, y: 540 };
  assert.ok(dist(stella.pos, c) < dist(start, c) - 200, 'came toward the middle');
  // summoned by the cursor, from the far side: around the zone, never through it
  for (const cursor of [{ x: 960, y: 540 }, { x: 150, y: 540 }]) {
    const s2 = (await make({ anchor: { x: 1840, y: 540 }, random: lcg(12) }));
    const phases = [];
    s2.stella.onTeleport = ph => phases.push(ph);
    const q = s2.stella.summon(cursor);
    let bad = 0;
    for (let i = 0; i < 500; i++) { s2.step(DT); if (!inBand(s2.stella.pos, R(s2.stella), s2.stella.view)) bad++; }
    assert.ok(await q);
    assert.equal(bad, 0, `through the zone toward ${JSON.stringify(cursor)}`);
    assert.ok(dist(s2.stella.pos, cursor) < dist({ x: 1840, y: 540 }, cursor), 'closer to the cursor');
    assert.deepEqual(phases, ['start', 'end']);
  }
});

test('reminders and approvals stay outside the center zone', async () => {
  const inBand = await band();
  const start = { x: 1700, y: 900 };
  const { stella, step } = await make({ anchor: start, random: lcg(13) });
  const played = [];
  const play = stella.motions.play.bind(stella.motions);
  stella.motions.play = (n, t) => { const ok = play(n, t); if (ok) played.push(n); return ok; };
  stella.remind();
  let out = 0, closest = Infinity;
  const c = { x: 960, y: 540 };
  for (let i = 0; i < 600; i++) {
    step(DT);
    if (!inBand(stella.pos, R(stella), stella.view)) out++;
    closest = Math.min(closest, dist(stella.pos, c));
  }
  assert.ok(played.includes('chime'));
  assert.equal(out, 0);
  assert.ok(closest < dist(start, c) - 50, 'drifted toward the middle');
  assert.ok(dist(stella.pos, start) <= 200, 'and back to her anchor area');

  stella.approval(true);
  for (let i = 0; i < 500; i++) { step(DT); if (!inBand(stella.pos, R(stella), stella.view)) out++; }
  assert.equal(out, 0);
  assert.ok(stella.motions.update(stella.now()).approval > 0.99, 'ring holds');
  const held = { ...stella.pos };
  stella.nextMove = stella.now();
  step(DT, 200);
  assert.deepEqual(stella.pos, held, 'stays until answered');
  stella.approval(false);
  step(DT, 500);
  assert.ok(!(stella.motions.update(stella.now()).approval > 0));
  assert.ok(dist(stella.pos, start) <= 200);
});

test('teleport glides there', async () => {
  const { stella, step } = await make({ random: lcg(14) });
  const to = stella.spot('random');
  const p = stella.teleport(to);
  step(DT, 500);
  assert.ok(await p);
  assert.ok(dist(stella.pos, to) < 1e-6);
});

// ---------- Task 9 review follow-ups ----------

test('reduced motion drag follows the pointer 1:1 and drops exactly', async () => {
  const { stella, step, saved, setReduced } = await make();
  setReduced(true);
  stella.pos = { x: 1500, y: 800 };
  step();
  stella.pointerDown(1500, 800);
  stella.pointerMove(1400, 700);
  step();
  assert.deepEqual(stella.pos, { x: 1400, y: 700 });
  stella.pointerMove(1300, 650);
  step();
  assert.deepEqual(stella.pos, { x: 1300, y: 650 });
  stella.pointerUp(1250, 640);
  step();
  assert.deepEqual(stella.pos, { x: 1250, y: 640 });
  assert.deepEqual(stella.anchor, { x: 1250, y: 640 });
  assert.deepEqual(saved, [{ x: 1250, y: 640 }]);
  assert.equal(stella.travel, null);
});

test('perform only releases a hold it started', async () => {
  const { stella, step } = await make();
  stella.agentActivity({ tool: 'capri_point', phase: 'start' });
  step();
  stella.perform('point'); // refused: the agent's blade is already held
  step(100, 20);
  assert.ok(stella.motions.update(stella.now()).aim > 0.99, 'agent aim still held');
  stella.agentActivity({ tool: 'capri_point', phase: 'end', ok: true });
  step(100, 10);
  assert.ok(!(stella.motions.update(stella.now()).aim > 0));
  stella.perform('point');
  step(100, 20);
  assert.ok(!(stella.motions.update(stella.now()).aim > 0), 'its own hold ends after 1.5 s');
});

test('music pulse does not make her busy', async () => {
  const { stella, step } = await make();
  stella.agentActivity({ tool: 'capri_apps', op: 'play_music', phase: 'end', ok: true });
  step(100, 10);
  assert.ok(stella.motions.update(stella.now()).musicPulse > 0);
  assert.equal(stella.busy, false);
});

test('act never reports a motion the mixer killed', async () => {
  const { stella } = await make();
  stella.perform('curious');
  assert.equal(stella.act.player.name, 'pulse');
  stella.motions.play('glitch', stella.now());
  assert.equal(stella.act, null);
});

test('a lost agent end does not leave her thinking', async () => {
  const { stella, step } = await make();
  stella.agentActivity({ tool: 'capri_unknown', phase: 'start' });
  step();
  assert.equal(stella.blend.mode, 'think');
  step(1000, 61);
  assert.equal(stella.blend.mode, 'idle', 'stale after 60 s');
  stella.agentActivity({ tool: 'capri_unknown', phase: 'start' });
  step();
  assert.equal(stella.blend.mode, 'think');
  stella.setMode('idle');
  step();
  assert.equal(stella.blend.mode, 'idle', 'cleared by setMode(idle)');
});

test('reduced motion: no wandering, and functions place her at once', async () => {
  const { stella, step, clock } = await make({ reduced: true, random: lcg(15) });
  const at = { ...stella.pos };
  stella.nextMove = clock.t;
  step(DT, 200 * 1000 / DT);
  assert.deepEqual(stella.pos, at, 'stays put');
  const phases = [];
  stella.onTeleport = p => phases.push(p);
  const rect = { x: 200, y: 100, w: 300, h: 200 };
  const p = stella.pointAt(rect);
  step(DT);
  assert.ok(await p);
  assert.ok(distToRect(stella.pos, rect) >= R(stella), 'beside it right away');
  assert.deepEqual(phases, []);
});

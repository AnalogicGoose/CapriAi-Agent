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

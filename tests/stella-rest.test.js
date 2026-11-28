'use strict';
// Away mode: put away, Stella glides to the bottom-left corner and rests there as a small closed bud.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadRenderer } = require('./helpers/esm.js');

const listeners = () => {
  const on = {};
  return { on, addEventListener: (type, fn) => { on[type] = fn; }, setPointerCapture() {}, releasePointerCapture() {},
    hasPointerCapture: () => false, style: {} };
};

async function make(o = {}) {
  const { Stella } = await loadRenderer('stella/stella.js');
  const clock = { t: 1000 };
  const frames = [], draws = [], cues = [];
  let reduced = !!o.reduced;
  const renderer = { setSize(css) { this.size = css; }, draw(scene) { draws.push({ at: clock.t, scene }); } };
  const stella = new Stella({
    root: listeners(), canvas: listeners(), voice: { play: cue => cues.push(cue) }, renderer,
    now: () => clock.t, schedule: fn => frames.push(fn), random: () => 0.5,
    reduced: () => reduced, saveAnchor() {}, view: o.view || { w: 1920, h: 1080 }, anchor: o.anchor, wander: false,
  });
  const step = (ms = 1000 / 60, n = 1) => {
    for (let i = 0; i < n; i++) { clock.t += ms; const fn = frames.shift(); if (fn) fn(clock.t); }
  };
  const run = ms => step(1000 / 60, Math.ceil(ms / (1000 / 60)));
  // setTimeout(…, 0) deferrals (motion sounds) run on the next macrotask
  const flush = () => new Promise(r => setTimeout(r, 0));
  return { stella, clock, step, run, draws, cues, flush };
}

const near = (a, b, eps = 1) => Math.abs(a - b) <= eps;
const budR = s => 0.45 * s.size * 0.4;

test('stow glides to the corner and curls', async () => {
  const { stella, run, draws, cues } = await make();
  let stowed = 0;
  stella.onStow = () => stowed++;
  stella.stow();
  run(1600);
  await Promise.resolve();
  assert.equal(stella.stowed, true);
  assert.equal(stella.curl, 1);
  assert.equal(stella.compact, 0.4);
  const c = stella.cornerSpot();
  assert.ok(near(stella.pos.x, c.x, 1e-6) && near(stella.pos.y, c.y, 1e-6));
  assert.ok(c.x - budR(stella) >= 26 && c.y + budR(stella) <= 1080 - 22, 'bud inside the corner margins');
  assert.equal(draws.at(-1).scene.curl, 1);
  assert.equal(stowed, 1);
  assert.deepEqual(cues.filter(c => c === 'curl-up'), ['curl-up']);
});

test('unstow unfurls back to where she was', async () => {
  const { stella, run, cues } = await make({ anchor: { x: 900, y: 500 } });
  stella.stow(); run(1600);
  stella.unstow(); run(1600);
  assert.ok(near(stella.pos.x, 900) && near(stella.pos.y, 500), JSON.stringify(stella.pos));
  assert.equal(stella.curl, 0);
  assert.equal(stella.compact, 1);
  assert.equal(stella.stowed, false);
  assert.ok(cues.includes('unfurl'));
});

test('turning around mid-stow ends awake where she left from', async () => {
  const { stella, run } = await make({ anchor: { x: 900, y: 500 } });
  stella.stow(); run(700);
  assert.ok(stella.curl < 1);
  stella.unstow(); run(1600);
  assert.ok(near(stella.pos.x, 900) && near(stella.pos.y, 500), JSON.stringify(stella.pos));
  assert.equal(stella.curl, 0);
  assert.equal(stella.stowed, false);
});

test('a new view moves her to its corner', async () => {
  const { stella, run } = await make();
  stella.stow(); run(1600);
  stella.setView(1280, 720);
  run(50);
  const c = stella.cornerSpot();
  assert.ok(near(stella.pos.x, c.x, 1e-6) && near(stella.pos.y, c.y, 1e-6), JSON.stringify([stella.pos, c]));
  assert.ok(c.y + budR(stella) <= 720 - 22);
});

test('stowNow then unstow returns to the saved anchor', async () => {
  const { stella, run, cues } = await make({ anchor: { x: 600, y: 400 } });
  stella.stowNow();
  assert.equal(stella.curl, 1);
  assert.equal(stella.stowed, true);
  const c = stella.cornerSpot();
  assert.ok(near(stella.pos.x, c.x, 1e-6) && near(stella.pos.y, c.y, 1e-6));
  assert.equal(cues.includes('curl-up'), false);
  stella.unstow(); run(1600);
  assert.ok(near(stella.pos.x, 600) && near(stella.pos.y, 400), JSON.stringify(stella.pos));
});

test('the bud cannot be dragged, and a click on it wakes her', async () => {
  const { stella, run } = await make();
  let woke = 0, clicked = 0;
  stella.onBudClick = () => woke++;
  stella.onClick = () => clicked++;
  stella.stow(); run(1600);
  const p = { ...stella.pos };
  assert.equal(stella.restHit(p.x, p.y), true);
  assert.equal(stella.restHit(p.x + budR(stella) + 40, p.y), false);
  assert.equal(stella.pointerDown(p.x, p.y, 1), true);
  stella.pointerMove(p.x + 80, p.y - 80, 1);
  run(200);
  assert.equal(stella.dragging, false);
  assert.ok(near(stella.pos.x, p.x, 1e-6) && near(stella.pos.y, p.y, 1e-6));
  stella.pointerUp(p.x + 80, p.y - 80, 1);
  assert.equal(woke, 0, 'a drag attempt does not wake her');
  stella.pointerDown(p.x, p.y, 2); stella.pointerUp(p.x, p.y, 2);
  assert.equal(woke, 1);
  assert.equal(clicked, 0, 'the awake click (chat menu) does not fire');
});

test('reduced motion fades instead of gliding', async () => {
  const { stella, step } = await make({ reduced: true, anchor: { x: 900, y: 500 } });
  stella.stow();
  const c = stella.cornerSpot();
  let dipped = false;
  for (let i = 0; i < 60; i++) {
    step();
    const atStart = near(stella.pos.x, 900, 1e-6) && near(stella.pos.y, 500, 1e-6);
    const atCorner = near(stella.pos.x, c.x, 1e-6) && near(stella.pos.y, c.y, 1e-6);
    assert.ok(atStart || atCorner, `in between at frame ${i}: ${JSON.stringify(stella.pos)}`);
    if (stella.restOpacity < 1) dipped = true;
  }
  assert.ok(dipped, 'faded');
  assert.equal(stella.curl, 1);
  stella.root.style = {};
  for (let i = 0; i < 1200; i++) { step(); assert.equal(stella.stretch, 0); }
});

test('resting life: a stretch now and then, drawn at a gentle rate', async () => {
  const { stella, run, draws, step } = await make();
  stella.stow(); run(1600);
  let stretched = false;
  for (let i = 0; i < 1200; i++) { step(); if (stella.stretch > 0.5) stretched = true; }
  assert.ok(stretched, 'stretched within 20 s');
  const from = draws.length;
  run(3000);
  const at = draws.slice(from).map(d => d.at);
  for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= 1000 / 18 - 1e-6, `draw gap ${at[i] - at[i - 1]}`);
});

test('quiet while resting', async () => {
  const { stella, run, cues, draws, flush } = await make();
  stella.stow(); run(1600);
  const p = { ...stella.pos };
  stella.perform('victory');
  stella.reactToTool('Edit');
  stella.agentActivity({ tool: 'stella_apps', op: 'open_url', phase: 'start' });
  run(500);
  assert.equal(stella.act, null);
  assert.ok(near(stella.pos.x, p.x, 1e-6) && near(stella.pos.y, p.y, 1e-6));
  cues.length = 0;
  stella.wakeHeard();
  await flush();
  assert.equal(stella.act, null);
  assert.ok(cues.includes('listen'));
  stella.remind();
  await flush();
  run(500);
  assert.ok(cues.includes('chime'));
  assert.ok(near(stella.pos.x, p.x, 1e-6) && near(stella.pos.y, p.y, 1e-6));
  stella.setMode('alert'); run(2000);
  assert.ok(draws.at(-1).scene.ringWarm > 0.9);
  stella.setMode('idle'); run(3000);
  assert.ok(draws.at(-1).scene.ringWarm < 0.05);
});

test('her head follows the bud', async () => {
  const { stella, run } = await make();
  let head = null;
  stella.onMove = h => { head = h; };
  stella.stow(); run(1600);
  assert.ok(near(stella.head().y, stella.pos.y - stella.size * 0.25 * 0.4, 1e-6));
  assert.ok(near(head.y, stella.head().y, 1e-6));
});

test('a game while she rests: folded for the game, back in her corner after', async () => {
  const { stella, run } = await make();
  stella.stow(); run(1600);
  const c = stella.cornerSpot();
  const gone = stella.gamingDeparture(); run(800); await gone;
  assert.equal(stella.fold, 1);
  stella.gaming = false;
  stella.prepareGamingReturn();
  const back = stella.gamingArrival(); run(800); await back;
  assert.equal(stella.fold, 0);
  assert.equal(stella.stowed, true);
  assert.ok(near(stella.pos.x, c.x, 1e-6) && near(stella.pos.y, c.y, 1e-6));
});

test('a finished big job while she rests: no glide, no victory pose, the summary still comes', async () => {
  const { stella, run } = await make();
  stella.stow(); run(1600);
  const p = { ...stella.pos };
  let spoke = 0;
  const glide = stella.teleport({ x: 900, y: 500 });
  stella.celebrate({ onSpeak: () => spoke++ });
  run(1000);
  await glide;
  assert.equal(stella.travel, null);
  assert.equal(stella.act, null);
  assert.ok(near(stella.pos.x, p.x, 1e-6) && near(stella.pos.y, p.y, 1e-6));
  assert.equal(spoke, 1);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { loadRenderer } = require('./helpers/esm.js');

const toolIds = () => [...fs.readFileSync(path.join(__dirname, '../src/main/codex-tools.js'), 'utf8')
  .matchAll(/^\s*\['(capri_\w+)'/gm)].map(m => m[1]);

test('every capri tool id has a motion', async () => {
  const { MOTIONS, motionForAgentTool } = await loadRenderer('stella/motions.js');
  const ids = toolIds();
  assert.ok(ids.length >= 25, `parsed ${ids.length} ids`);
  const allowThink = [];
  for (const id of ids) {
    const m = motionForAgentTool(id);
    if (m === 'think') assert.ok(allowThink.includes(id), `${id} falls through to think`);
    else assert.ok(MOTIONS[m], `${id} -> ${m}`);
  }
  assert.equal(motionForAgentTool('something_else'), 'think');
});

test('apps operations split between flare and radar', async () => {
  const { motionForAgentTool: f } = await loadRenderer('stella/motions.js');
  for (const op of ['open_url', 'open_app', 'open_workspace', 'open_media', 'play_music', 'play_video', 'youtube_latest', 'open_result'])
    assert.equal(f('capri_apps', op), 'flare', op);
  for (const op of ['search_web', 'search_news', 'steam_deals']) assert.equal(f('capri_apps', op), 'radar', op);
  assert.equal(f('capri_apps'), 'flare');
  assert.equal(f('capri_apps', 'nope'), 'flare');
});

test('codex tool names follow the old action rules', async () => {
  const { motionForCodexTool: f } = await loadRenderer('stella/motions.js');
  assert.equal(f('WebSearch'), 'radar');
  assert.equal(f('Grep'), 'radar');
  assert.equal(f('Edit'), 'ticks');
  assert.equal(f('NotebookEdit'), 'ticks');
  assert.equal(f('Read'), 'scan');
  assert.equal(f('list_dir'), 'scan');
  assert.equal(f('Bash'), 'think');
  assert.equal(f(), 'think');
});

test('old act names map or are deliberately ignored', async () => {
  const { motionForAct: f, MOTIONS } = await loadRenderer('stella/motions.js');
  const names = ['alarm', 'flinch', 'curious', 'hop', 'victory', 'split', 'zap', 'point', 'unpoint', 'talk', 'listen',
    'idleListen', 'dive', 'dropLand', 'dropPlop', 'plop', 'fold', 'turn', 'idleStretch', 'idleYawn', 'idleBreathe',
    'idleSway', 'idlePreen', 'idleBounce', 'spin', 'dance', 'idleWave', 'split', 'bogus'];
  for (const n of names) {
    const v = f(n);
    assert.ok(v === null || typeof v === 'string', n);
    if (v) assert.ok(MOTIONS[v], `${n} -> ${v}`);
  }
  assert.equal(f('alarm'), 'glitch');
  assert.equal(f('idleWave'), 'doublePulse');
  assert.equal(f('split'), 'spinBurst');
  assert.equal(f('unpoint'), null);
  assert.equal(f('bogus'), null);
});

test('body actions keep the ability', async () => {
  const { bodyResponse: b } = await loadRenderer('stella/motions.js');
  assert.equal(b('sit').reply, 'I don’t sit anymore — I just float around now.');
  assert.equal(b('sit').motion, null);
  assert.equal(b('stand').motion, null);
  assert.deepEqual(b('come'), { come: true, motion: 'pulse', reply: null });
  assert.equal(b('nap').rest, true);
  assert.equal(b('wake').wake, true);
  assert.equal(b('wake').motion, 'wake');
  assert.equal(b('dance').motion, 'spinBurst');
  assert.equal(b('wave').motion, 'doublePulse');
  assert.equal(b('stretch').motion, 'breath');
  assert.equal(b('mood').motion, 'pulse');
});

test('mixer respects priority, crossfades and rate-limits', async () => {
  const { MotionMixer } = await loadRenderer('stella/motions.js');
  const m = new MotionMixer();
  m.play('radar', 0);
  m.play('radar', 1000);
  assert.deepEqual(Object.keys(m.update(1000)), ['radar']);
  m.play('scan', 1200); // rate-limited routine
  assert.equal(m.update(1200).scan, undefined);
  assert.equal(m.update(0).radar, undefined); // envelope 0 at start
  const mid = m.update(900).radar;
  assert.equal(mid, 1);
  // priority: glitch beats radar, crossfade is continuous
  const before = m.update(1000).radar;
  m.play('glitch', 1000);
  assert.ok(Math.abs(m.update(1000).radar - before) < 1e-9);
  assert.ok(m.update(1125).radar < before);
  assert.equal(m.update(1300).radar, undefined);
  assert.ok(m.update(1300).glitch > 0);
  // lower priority ignored while higher active
  m.play('pulse', 1250);
  assert.equal(m.update(1300).pulse, undefined);
  // routine is allowed again after the window
  const n = new MotionMixer();
  n.play('radar', 0); n.play('scan', 1800);
  assert.ok('scan' in n.update(1900));
});

test('mixer busy and hold release', async () => {
  const { MotionMixer } = await loadRenderer('stella/motions.js');
  const m = new MotionMixer();
  m.play('flare', 0);
  assert.equal(m.busy(0), false);
  assert.equal(m.busy(450), true);
  assert.equal(m.busy(950), false);
  m.play('aim', 2000);
  assert.equal(m.update(5000).aim, 1);
  assert.equal(m.busy(5000), true);
  m.release('aim', 5000);
  const half = m.update(5200).aim;
  assert.ok(half > 0 && half < 1);
  assert.equal(m.update(5400).aim, undefined);
  assert.equal(m.busy(5400), false);
  m.play('musicPulse', 6000);
  assert.equal(m.busy(7000), true); // hold counts as busy
});

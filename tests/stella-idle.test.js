'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadRenderer } = require('./helpers/esm.js');

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Runs the scheduler for `ms` in `step` steps; returns per-sample results.
function simulate(m, { seed = 7, ms = 2 * 3600 * 1000, step = 100, allowed = () => true, energy } = {}) {
  const s = new m.IdleScheduler({ random: seeded(seed), energy });
  const samples = [];
  for (let t = 0; t <= ms; t += step) {
    const r = s.update(t, { allowed: allowed(t) });
    samples.push({ t, ...r });
  }
  return samples;
}

function runsOf(samples) {
  const runs = [];
  let cur = null;
  for (const s of samples) {
    if (s.name && !cur) { cur = { name: s.name, start: s.t }; }
    else if (cur && (!s.name || s.name !== cur.name)) { cur.end = s.t; runs.push(cur); cur = s.name ? { name: s.name, start: s.t } : null; }
  }
  return runs;
}

test('never repeats a variation back to back', async () => {
  const m = await loadRenderer('stella/idle.js');
  const runs = runsOf(simulate(m));
  assert.ok(runs.length > 50);
  for (let i = 1; i < runs.length; i++) assert.notEqual(runs[i].name, runs[i - 1].name);
  assert.ok(new Set(runs.map(r => r.name)).size >= 5);
  for (const r of runs) assert.ok(m.IDLE_VARIATIONS.includes(r.name));
});

test('durations and gaps stay in range', async () => {
  const m = await loadRenderer('stella/idle.js');
  const runs = runsOf(simulate(m));
  const tol = 250;
  assert.ok(runs[0].start >= 8000 - tol && runs[0].start <= 25000 + tol, 'initial gap');
  for (let i = 0; i < runs.length; i++) {
    const d = runs[i].end - runs[i].start;
    assert.ok(d >= 10000 - tol && d <= 30000 + tol, `duration ${d}`);
    if (i > 0) {
      const g = runs[i].start - runs[i - 1].end;
      assert.ok(g >= 8000 - tol && g <= 25000 + tol, `gap ${g}`);
    }
  }
});

test('envelope is continuous and within 0..1', async () => {
  const m = await loadRenderer('stella/idle.js');
  const samples = simulate(m, { ms: 20 * 60 * 1000 });
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    assert.ok(samples[i].envelope >= 0 && samples[i].envelope <= 1);
    if (i) max = Math.max(max, Math.abs(samples[i].envelope - samples[i - 1].envelope));
  }
  // A 2 s smoothstep ramp peaks at ~0.075 per 100 ms.
  assert.ok(max < 0.08, `max step ${max}`);
  assert.ok(samples.some(s => s.envelope === 1), 'reaches full strength');
});

test('disallowed fades out and blocks new starts', async () => {
  const m = await loadRenderer('stella/idle.js');
  // Allowed until a variation is mid-run, then disallowed forever.
  const probe = simulate(m, { ms: 120000 });
  const mid = probe.find(s => s.name && s.envelope === 1).t;
  const cut = mid + 500;
  const samples = simulate(m, { ms: 10 * 60 * 1000, allowed: t => t < cut });
  const after = samples.filter(s => s.t >= cut);
  assert.ok(after[0].envelope > 0.9);
  let prev = after[0].envelope;
  for (const s of after) { assert.ok(s.envelope <= prev + 1e-9); prev = s.envelope; }
  const done = after.find(s => s.name === null);
  assert.ok(done, 'fades out completely');
  assert.ok(done.t - cut <= 2100, `fade took ${done.t - cut}`);
  assert.ok(after.filter(s => s.t > done.t).every(s => s.name === null && s.envelope === 0));
  // Early disallowed also blocks the very first start.
  const none = simulate(m, { ms: 5 * 60 * 1000, allowed: () => false });
  assert.ok(none.every(s => s.name === null));
});

test('energy scales only the energy field', async () => {
  const m = await loadRenderer('stella/idle.js');
  const a = simulate(m, { ms: 60000, energy: () => 0.2 });
  const b = simulate(m, { ms: 60000, energy: () => 0.9 });
  assert.ok(a.every(s => s.energy === 0.2) && b.every(s => s.energy === 0.9));
  assert.deepEqual(a.map(s => [s.name, s.envelope]), b.map(s => [s.name, s.envelope]));
});

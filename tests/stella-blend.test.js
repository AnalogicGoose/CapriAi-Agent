'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {loadRenderer} = require('./helpers/esm.js');

test('stella math helpers', async () => {
  const m = await loadRenderer('stella/math.js');
  assert.equal(m.clamp(5, 0, 1), 1);
  assert.equal(m.lerp(0, 10, 0.25), 2.5);
  assert.equal(m.smoothstep(0), 0);
  assert.equal(m.smoothstep(1), 1);
  assert.equal(m.smoothstep(0.5), 0.5);
  assert.equal(m.damp(0, 1, 3, 0), 0);
  assert.ok(m.damp(0, 1, 3, 10) > 0.999);
  for (let i = 0; i < 1000; i++) {
    const n = m.noise1(i * 0.37);
    assert.ok(n >= -1 && n <= 1);
  }
});

test('stella params are frozen', async () => {
  const {P} = await loadRenderer('stella/params.js');
  assert.ok(Object.isFrozen(P));
  assert.equal(P.blades.count, 4);
});

test('blend weights ease without snapping', async () => {
  const {StateBlend} = await loadRenderer('stella/blend.js');
  const b = new StateBlend();
  b.setMode('think');
  b.step(0.016);
  assert.ok(b.think > 0 && b.think < 0.1);
  for (let i = 0; i < 188; i++) b.step(0.016);
  assert.ok(b.think > 0.99);
  assert.ok(b.listen < 0.01 && b.speak < 0.01 && b.rest < 0.01);
});

test('voice rises fast and falls slower', async () => {
  const {StateBlend} = await loadRenderer('stella/blend.js');
  const up = new StateBlend();
  up.setVoice(1);
  for (let i = 0; i < 100; i++) up.step(0.001);
  assert.ok(up.level > 0.8);
  const down = new StateBlend();
  down.level = 1;
  down.setVoice(0);
  for (let i = 0; i < 100; i++) down.step(0.001);
  assert.ok(down.level > 0.4);
  assert.ok(down.level < up.level);
});

test('blend rejects unknown mode', async () => {
  const {StateBlend} = await loadRenderer('stella/blend.js');
  assert.throws(() => new StateBlend().setMode('dance'));
});

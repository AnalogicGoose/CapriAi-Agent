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

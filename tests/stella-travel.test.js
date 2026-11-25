'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadRenderer } = require('./helpers/esm.js');

const lcg = (seed = 1) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const VIEW = { w: 1920, h: 1080 };
const R = 78;

test('routes between band points never cross the center zone', async () => {
  const { planRoute, pointOnRoute } = await loadRenderer('stella/travel.js');
  const { inBand } = await loadRenderer('stella/wander.js');
  const random = lcg(3);
  const pairs = [
    [{ x: 1840, y: 540 }, { x: 80, y: 540 }],   // right middle → left middle: must go around
    [{ x: 960, y: 80 }, { x: 960, y: 1000 }],   // top middle → bottom middle
    [{ x: 1700, y: 900 }, { x: 1500, y: 950 }], // a short hop
  ];
  for (const [from, to] of pairs) {
    const route = planRoute({ from, to, radius: R - 3, band: R, view: VIEW, random });
    for (let i = 0; i <= 400; i++) {
      const p = pointOnRoute(route, i / 400);
      assert.ok(inBand(p, R - 3 - 0.01, VIEW), `${JSON.stringify(from)}→${JSON.stringify(to)} at ${JSON.stringify(p)}`);
    }
    assert.deepEqual(pointOnRoute(route, 0), from);
    const end = pointOnRoute(route, 1);
    assert.ok(Math.hypot(end.x - to.x, end.y - to.y) < 1e-6);
  }
});

test('crossing routes stay inside the view', async () => {
  const { planRoute, pointOnRoute } = await loadRenderer('stella/travel.js');
  const random = lcg(9);
  const route = planRoute({ from: { x: 80, y: 80 }, to: { x: 1840, y: 1000 }, cross: true, radius: R, view: VIEW, random });
  for (let i = 0; i <= 200; i++) {
    const p = pointOnRoute(route, i / 200);
    assert.ok(p.x >= R - 1e-6 && p.y >= R - 1e-6 && p.x <= VIEW.w - R + 1e-6 && p.y <= VIEW.h - R + 1e-6);
  }
});

test('nearest band point and center approach stop at the zone edge', async () => {
  const { nearestBandPoint, approachCenter } = await loadRenderer('stella/travel.js');
  const { inBand } = await loadRenderer('stella/wander.js');
  const p = nearestBandPoint({ x: 500, y: 540 }, R, VIEW);
  assert.ok(inBand(p, R, VIEW));
  assert.ok(Math.abs(p.x - (480 - R)) < 1 && p.y === 540, JSON.stringify(p));
  const far = approachCenter({ x: 1800, y: 900 }, Infinity, R, VIEW);
  assert.ok(inBand(far, R, VIEW));
  assert.ok(Math.hypot(far.x - 960, far.y - 540) < Math.hypot(1800 - 960, 900 - 540) - 200, 'came a long way');
  const near = approachCenter({ x: 1800, y: 900 }, 100, R, VIEW);
  assert.ok(Math.abs(Math.hypot(near.x - 1800, near.y - 900) - 100) < 1e-6);
  assert.deepEqual(approachCenter({ x: 960, y: 540 }, 100, R, VIEW), { x: 960, y: 540 }, 'inside the zone: stays');
});

test('corner routes are smooth curves', async () => {
  const { planRoute, pointOnRoute } = await loadRenderer('stella/travel.js');
  const route = planRoute({ from: { x: 1840, y: 540 }, to: { x: 80, y: 540 }, radius: R - 3, band: R, view: VIEW, random: lcg(3) });
  assert.ok(route.legs.length > 1, 'went around');
  const N = 4000;
  let prev = pointOnRoute(route, 0), heading = null, maxTurnPerPx = 0;
  for (let i = 1; i <= N; i++) {
    const p = pointOnRoute(route, i / N), d = Math.hypot(p.x - prev.x, p.y - prev.y);
    if (d > 1e-6) {
      const h = Math.atan2(p.y - prev.y, p.x - prev.x);
      if (heading != null) maxTurnPerPx = Math.max(maxTurnPerPx, Math.abs(Math.atan2(Math.sin(h - heading), Math.cos(h - heading))) / d);
      heading = h;
    }
    prev = p;
  }
  assert.ok(maxTurnPerPx < 0.05, `sharpest turn ${maxTurnPerPx} rad/px`);
  // and arc-length even: equal steps of u cover nearly equal distances
  const a = pointOnRoute(route, 0.5), b = pointOnRoute(route, 0.51);
  const c = pointOnRoute(route, 0.1), d2 = pointOnRoute(route, 0.11);
  const ratio = Math.hypot(a.x - b.x, a.y - b.y) / Math.hypot(c.x - d2.x, c.y - d2.y);
  assert.ok(ratio > 0.9 && ratio < 1.1, `speed ratio ${ratio}`);
});

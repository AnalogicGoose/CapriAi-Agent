// Stella: where she goes and how. Route planning (curved, eased paths that keep
// her inside the view and, unless a function needs it, out of the center zone),
// path following, the settle after a drop, the calm wander rhythm with its
// resting bob, and the way back to her anchor area. No DOM.
import { clamp, damp, easeInOut, TAU } from './math.js';
import { centerZone, clampToView, inBand, makePath, pathClear, planWander, pointOnPath, restDuration,
  travelDuration } from './wander.js';

export const BOB = 3;          // px: resting float amplitude (also her margin from the band's edges)
const BOB_PERIOD = 4;          // s
const BOB_RATE = 1.5;          // 1/s: the bob fades in after a stop and out when she sets off
const HOME_REACH = 200;        // px: the anchor area
const TELEPORT_MIN = 600;      // ms: shorter travels aren't reported through onTeleport
const SETTLE_RATE = 14;        // 1/s: the settle after a drop
const ARRIVE = 0.5;            // px: the settle is done
const ARC_TRIES = 8;
const CROSSING = new Set(['point', 'guide']); // the only travels that may cross the center zone

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const inside = (p, r, view) => p.x >= r && p.y >= r && p.x <= view.w - r && p.y <= view.h - r;

export const straight = (from, to) => ({ from, to, control: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
  length: dist(from, to) });
const route = legs => ({ legs, length: legs.reduce((n, l) => n + l.length, 0) });

export function pointOnRoute({ legs, length }, u) {
  let s = clamp(u, 0, 1) * length;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (s <= leg.length || i === legs.length - 1) return pointOnPath(leg, leg.length ? s / leg.length : 1);
    s -= leg.length;
  }
  return null;
}

const samples = (path, n = 32) => Array.from({ length: n + 1 }, (_, i) => pointOnPath(path, i / n));

// The nearest point of the band (outside the center zone, inside the view) to `p`.
export function nearestBandPoint(p, radius, view) {
  const q = clampToView(p, radius, view);
  if (inBand(q, radius, view)) return q;
  const z = centerZone(view), r = radius + 0.5;
  const options = [{ x: z.x - r, y: q.y }, { x: z.x + z.w + r, y: q.y }, { x: q.x, y: z.y - r }, { x: q.x, y: z.y + z.h + r }]
    .map(c => clampToView(c, radius, view)).filter(c => inBand(c, radius, view));
  return options.length ? options.reduce((a, b) => (dist(b, q) < dist(a, q) ? b : a)) : q;
}

// Up to `maxDist` from `from` toward the view's center, stopping where the center zone starts.
export function approachCenter(from, maxDist, radius, view) {
  if (!inBand(from, radius, view)) return { ...from };
  const c = { x: view.w / 2, y: view.h / 2 }, len = dist(from, c);
  const at = k => ({ x: from.x + (c.x - from.x) * k, y: from.y + (c.y - from.y) * k });
  let lo = 0, hi = len ? Math.min(1, maxDist / len) : 0;
  if (inBand(at(hi), radius, view)) return at(hi);
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (inBand(at(mid), radius, view)) lo = mid; else hi = mid; }
  return at(lo);
}

// Shortest chain of straight legs through the band's corners that never enters the center zone.
function aroundZone(from, to, radius, view) {
  const r = radius, w = view.w, h = view.h;
  const nodes = [from, { x: r, y: r }, { x: w - r, y: r }, { x: w - r, y: h - r }, { x: r, y: h - r }, to];
  const n = nodes.length, d = Array(n).fill(Infinity), prev = Array(n).fill(-1), done = Array(n).fill(false);
  d[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && d[i] < Infinity && (u < 0 || d[i] < d[u])) u = i;
    if (u < 0 || u === n - 1) break;
    done[u] = true;
    for (let v = 0; v < n; v++) {
      if (done[v] || d[u] + dist(nodes[u], nodes[v]) >= d[v]) continue;
      if (pathClear(straight(nodes[u], nodes[v]), radius, view)) { d[v] = d[u] + dist(nodes[u], nodes[v]); prev[v] = u; }
    }
  }
  if (d[n - 1] === Infinity) return null;
  const legs = [];
  for (let v = n - 1; prev[v] >= 0; v = prev[v]) legs.unshift(straight(nodes[prev[v]], nodes[v]));
  return route(legs);
}

// A gentle arc from `from` to `to`. `cross` lets it pass through the center zone; otherwise it
// stays in the band (`band` = her radius plus margin) whenever both ends are in it.
export function planRoute({ from, to, cross = false, radius, band = radius, view, random }) {
  const avoid = !cross && inBand(from, band, view) && inBand(to, band, view);
  const ok = avoid ? p => pathClear(p, band, view) : p => samples(p).every(q => inside(q, radius, view));
  for (let i = 0; i < ARC_TRIES; i++) {
    const p = makePath(from, to, random);
    if (ok(p)) return route([p]);
  }
  const line = straight(from, to);
  if (ok(line)) return route([line]);
  return (avoid && aroundZone(from, to, band, view)) || route([line]);
}

// Owns her travel. `s` is the Stella controller (pos, radius, bandRadius, view, anchor, wander,
// nextMove, random, now, reduced, onTeleport).
export class Traveler {
  constructor(s) {
    this.s = s;
    this.current = null; // { route?, to, elapsed, duration, reason, fn, settle?, done }
    this.open = false;   // an onTeleport('start') is waiting for its 'end'
    this.bob = 0; this.bobAmp = 0; this.bobPhase = 0;
  }

  report(on) {
    if (on === this.open) return;
    this.open = on;
    this.s.onTeleport?.(on ? 'start' : 'end');
  }

  // Glides to `to` along a planned route. Resolves true on arrival, false when replaced or stopped.
  go(to, { reason = 'glide', fn = true } = {}) {
    const s = this.s;
    const r = planRoute({ from: { ...s.pos }, to: clampToView(to, s.radius, s.view), cross: CROSSING.has(reason),
      radius: s.radius, band: s.bandRadius, view: s.view, random: s.random });
    return this.follow(r, { reason, fn });
  }

  follow(r, { reason, fn }) {
    this.stop(false, true);
    if (r.length < 1) {
      this.report(false);
      this.arrived(reason);
      return Promise.resolve(true);
    }
    const duration = travelDuration(r);
    return new Promise(done => {
      this.current = { route: r, to: r.legs[r.legs.length - 1].to, elapsed: 0, duration, reason, fn, done };
      this.report(duration >= TELEPORT_MIN && !this.s.reduced());
    });
  }

  // After a drop: she eases onto the drop point.
  settle(to) {
    this.stop(false, true);
    this.current = { to: { ...to }, settle: true, reason: 'settle', fn: false, done: null };
    this.report(true);
  }

  // Ends the current travel where she is. `keepOpen` keeps onTeleport open for what follows.
  stop(arrived = false, keepOpen = false) {
    const t = this.current;
    this.current = null;
    if (!keepOpen) this.report(false);
    t?.done?.(arrived);
    return t;
  }

  arrived(reason) {
    const s = this.s, now = s.now();
    if (reason === 'wander') s.anchor = { ...s.pos };
    s.nextMove = Math.max(s.nextMove, now + restDuration(s.random));
  }

  reclamp(fit) {
    const t = this.current;
    if (!t) return;
    t.to = fit(t.to);
    if (t.route) t.route.legs[t.route.legs.length - 1].to = t.to;
  }

  step(dt, reduced) {
    const s = this.s, t = this.current;
    if (t?.settle) {
      if (reduced) { this.stop(false); s.anchor = { ...s.pos }; } // she stops where she is, no snap
      else {
        s.pos = { x: damp(s.pos.x, t.to.x, SETTLE_RATE, dt), y: damp(s.pos.y, t.to.y, SETTLE_RATE, dt) };
        if (dist(s.pos, t.to) < ARRIVE) { s.pos = { ...t.to }; this.stop(true); }
      }
    } else if (t && reduced && t.reason === 'wander') {
      this.stop(false);
      s.anchor = { ...s.pos };
    } else if (t) {
      // Reduced motion: function moves are placed at once (no fade, nothing in between).
      t.elapsed = reduced ? t.duration : t.elapsed + dt * 1000;
      const u = clamp(t.elapsed / t.duration, 0, 1);
      s.pos = clampToView(pointOnRoute(t.route, easeInOut(u)), s.radius, s.view);
      if (u >= 1) { this.stop(true); this.arrived(t.reason); }
    }
    const still = !this.current && !s.dragging && !reduced;
    this.bobAmp = damp(this.bobAmp, still ? 1 : 0, BOB_RATE, dt);
    this.bobPhase = (this.bobPhase + dt / BOB_PERIOD) % 1;
    this.bob = BOB * this.bobAmp * Math.sin(TAU * this.bobPhase);
  }

  // Starts the next calm hop when it's time. Out of the band (dropped there), the hop takes her back into it.
  wander(now, allowed) {
    const s = this.s;
    if (!allowed || this.current || now < s.nextMove) return;
    const r = s.bandRadius;
    if (inBand(s.pos, r, s.view)) {
      const path = planWander({ from: { ...s.pos }, radius: r, view: s.view, random: s.random });
      this.follow(route([path]), { reason: 'wander', fn: false });
    } else {
      this.go(nearestBandPoint(s.pos, r, s.view), { reason: 'wander', fn: false });
    }
  }

  // Where she goes back to after a function: the anchor itself with wandering off, else a band
  // point within HOME_REACH of it.
  homeSpot() {
    const s = this.s, a = s.anchor, r = s.bandRadius;
    if (!s.wander) return clampToView(a, s.radius, s.view);
    for (let i = 0; i < 40; i++) {
      const ang = TAU * s.random(), d = HOME_REACH * Math.sqrt(s.random());
      const p = clampToView({ x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d }, r, s.view);
      if (inBand(p, r, s.view) && dist(p, a) <= HOME_REACH) return p;
    }
    return nearestBandPoint(a, r, s.view);
  }

  goHome() { return this.go(this.homeSpot(), { reason: 'return', fn: false }); }
}

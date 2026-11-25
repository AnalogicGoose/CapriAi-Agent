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
const WANDER_SPEED = 40;       // px/s: a wander hop never averages faster than this
const FADE = 150;              // ms: reduced motion fades out, is placed, fades in
const CORNER = 200;            // px: how far before a waypoint a detour starts to curve
const TABLE = 48;              // samples per leg for arc-length lookup
const SETTLE_RATE = 14;        // 1/s: the settle after a drop
const ARRIVE = 0.5;            // px: the settle is done
const ARC_TRIES = 8;
const CROSSING = new Set(['point', 'guide']); // the only travels that may cross the center zone

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const inside = (p, r, view) => p.x >= r && p.y >= r && p.x <= view.w - r && p.y <= view.h - r;

export const straight = (from, to) => ({ from, to, control: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
  length: dist(from, to) });
// A route: legs (quadratic paths) plus an arc-length table, so equal steps of u cover equal distances.
export function makeRoute(legs) {
  const table = [{ s: 0, leg: 0, t: 0 }];
  let s = 0;
  legs.forEach((leg, i) => {
    let prev = pointOnPath(leg, 0);
    for (let k = 1; k <= TABLE; k++) {
      const p = pointOnPath(leg, k / TABLE);
      s += dist(p, prev);
      prev = p;
      table.push({ s, leg: i, t: k / TABLE });
    }
  });
  return { legs, table, length: s };
}

export function pointOnRoute({ legs, table, length }, u) {
  const s = clamp(u, 0, 1) * length;
  let lo = 0, hi = table.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (table[mid].s <= s) lo = mid; else hi = mid; }
  const a = table[lo], b = table[hi];
  if (b.s === a.s) return pointOnPath(legs[b.leg], b.t);
  const k = (s - a.s) / (b.s - a.s);
  if (b.leg !== a.leg) return pointOnPath(legs[b.leg], b.t * k); // a is the end of the leg before, i.e. b's start
  return pointOnPath(legs[a.leg], a.t + (b.t - a.t) * k);
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
function aroundZone(from, to, radius, band, view) {
  const r = band, w = view.w, h = view.h;
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
  const pts = [nodes[n - 1]];
  for (let v = n - 1; prev[v] >= 0; v = prev[v]) pts.unshift(nodes[prev[v]]);
  return makeRoute(rounded(pts, radius, view));
}

// Straight legs through `pts` with every waypoint rounded off by a quadratic arc that stays in the band.
function rounded(pts, radius, view) {
  const toward = (a, b, d) => { const l = dist(a, b) || 1; return { x: a.x + (b.x - a.x) * d / l, y: a.y + (b.y - a.y) * d / l }; };
  const legs = [];
  let start = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const w = pts[i];
    let arc = null;
    for (let d = Math.min(CORNER, 0.45 * dist(pts[i - 1], w), 0.45 * dist(w, pts[i + 1])); d >= 4 && !arc; d /= 2) {
      const a = toward(w, pts[i - 1], d), b = toward(w, pts[i + 1], d);
      const curve = { from: a, to: b, control: w, length: 0 };
      if (pathClear(curve, radius, view)) arc = curve;
    }
    if (!arc) { legs.push(straight(start, w)); start = w; continue; }
    legs.push(straight(start, arc.from), arc);
    start = arc.to;
  }
  legs.push(straight(start, pts[pts.length - 1]));
  return legs.filter(l => dist(l.from, l.to) > 1e-9);
}

// A gentle arc from `from` to `to`, inside the view. `cross` lets it pass through the center zone;
// otherwise her body stays out of it whenever both ends are. Detour corners sit `band` (her radius
// plus margin) in from the view's corners.
export function planRoute({ from, to, cross = false, radius, band = radius, view, random }) {
  const avoid = !cross && inBand(from, radius, view) && inBand(to, radius, view);
  const ok = avoid ? p => pathClear(p, radius, view) : p => samples(p).every(q => inside(q, radius, view));
  for (let i = 0; i < ARC_TRIES; i++) {
    const p = makePath(from, to, random);
    if (ok(p)) return makeRoute([p]);
  }
  const line = straight(from, to);
  if (ok(line)) return makeRoute([line]);
  return (avoid && aroundZone(from, to, radius, band, view)) || makeRoute([line]);
}

// Owns her travel. `s` is the Stella controller (pos, radius, bandRadius, view, anchor, wander,
// nextMove, random, now). Glides never report onTeleport: she stays visible and the panel follows.
export class Traveler {
  constructor(s) {
    this.s = s;
    this.current = null; // { route?, to, elapsed, duration, reason, fn, settle?, fade?, done }
    this.bob = 0; this.bobAmp = 0; this.bobPhase = 0;
    this.opacity = 1;    // reduced motion fades function moves out and in
  }

  // Glides to `to` along a planned route. Resolves true on arrival, false when replaced or stopped.
  go(to, { reason = 'glide', fn = true } = {}) {
    return this.follow(this.plan(to, reason), { reason, fn });
  }

  plan(to, reason) {
    const s = this.s;
    return planRoute({ from: { ...s.pos }, to: clampToView(to, s.radius, s.view), cross: CROSSING.has(reason),
      radius: s.radius, band: s.bandRadius, view: s.view, random: s.random });
  }

  follow(r, { reason, fn }) {
    this.stop(false);
    if (r.length < 1) {
      this.arrived(reason);
      return Promise.resolve(true);
    }
    return new Promise(done => {
      this.current = { route: r, to: r.legs[r.legs.length - 1].to, elapsed: 0, duration: this.duration(r, reason),
        reason, fn, done };
    });
  }

  duration(r, reason) {
    const d = travelDuration(r);
    return reason === 'wander' ? Math.max(d, r.length / WANDER_SPEED * 1000) : d;
  }

  // After a drop: she eases onto the drop point.
  settle(to) {
    this.stop(false);
    this.current = { to: { ...to }, settle: true, reason: 'settle', fn: false, done: null };
  }

  // Ends the current travel where she is.
  stop(arrived = false) {
    const t = this.current;
    this.current = null;
    t?.done?.(arrived);
    return t;
  }

  arrived(reason) {
    const s = this.s, now = s.now();
    if (reason === 'wander') s.anchor = { ...s.pos };
    s.nextMove = Math.max(s.nextMove, now + restDuration(s.random));
  }

  // The view or her size changed: the whole remaining route is planned again from where she is.
  reclamp(fit) {
    const t = this.current, s = this.s;
    if (!t) return;
    t.to = fit(t.to);
    if (!t.route || t.fade != null) return;
    if (!CROSSING.has(t.reason) && !inBand(t.to, s.bandRadius, s.view)) t.to = nearestBandPoint(t.to, s.bandRadius, s.view);
    t.route = this.plan(t.to, t.reason);
    t.to = t.route.legs[t.route.legs.length - 1].to;
    t.elapsed = 0;
    t.duration = this.duration(t.route, t.reason);
  }

  step(dt, reduced) {
    const s = this.s, t = this.current;
    let fading = false;
    if (t?.settle) {
      if (reduced) { this.stop(false); s.anchor = { ...s.pos }; } // she stops where she is, no snap
      else {
        s.pos = { x: damp(s.pos.x, t.to.x, SETTLE_RATE, dt), y: damp(s.pos.y, t.to.y, SETTLE_RATE, dt) };
        if (dist(s.pos, t.to) < ARRIVE) { s.pos = { ...t.to }; this.stop(true); }
      }
    } else if (t && reduced && t.reason === 'wander') {
      this.stop(false);
      s.anchor = { ...s.pos };
    } else if (t && (reduced || t.fade != null)) {
      // Reduced motion: a function move fades out, is placed while unseen, and fades back in.
      fading = true;
      t.fade = (t.fade ?? 0) + dt * 1000;
      if (!t.placed) {
        this.opacity = Math.min(this.opacity, clamp(1 - t.fade / FADE, 0, 1));
        if (t.fade >= FADE) { s.pos = clampToView(t.to, s.radius, s.view); t.placed = t.fade; this.opacity = 0; }
      } else {
        this.opacity = clamp((t.fade - t.placed) / FADE, 0, 1);
        if (this.opacity >= 1) { this.stop(true); this.arrived(t.reason); }
      }
    } else if (t) {
      t.elapsed += dt * 1000;
      const u = clamp(t.elapsed / t.duration, 0, 1);
      s.pos = clampToView(pointOnRoute(t.route, easeInOut(u)), s.radius, s.view);
      if (u >= 1) { this.stop(true); this.arrived(t.reason); }
    }
    if (!fading && this.opacity < 1) this.opacity = Math.min(1, this.opacity + dt * 1000 / FADE);
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
      this.follow(makeRoute([path]), { reason: 'wander', fn: false });
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

// Stella: calm wandering and placement math. Pure functions, no DOM.
// Points are her center in overlay-view coordinates (origin top-left);
// `radius` is her half-size plus margin, as supplied by the caller.
import { clamp, lerp } from './math.js';

const MIN_HOP = 160;
const MAX_HOP_FRACTION = 0.45;
const SPEED = 30; // px per second
const BESIDE_GAP = 24;

export function centerZone(view) {
  return { x: view.w / 4, y: view.h / 4, w: view.w / 2, h: view.h / 2 };
}

function clampAxis(v, radius, size) {
  const lo = radius, hi = size - radius;
  return hi < lo ? size / 2 : clamp(v, lo, hi);
}

export function clampToView(p, radius, view) {
  return { x: clampAxis(p.x, radius, view.w), y: clampAxis(p.y, radius, view.h) };
}

function distToRect(p, rect) {
  const dx = Math.max(rect.x - p.x, 0, p.x - (rect.x + rect.w));
  const dy = Math.max(rect.y - p.y, 0, p.y - (rect.y + rect.h));
  return Math.hypot(dx, dy);
}

function fullyInView(p, radius, view) {
  return p.x >= radius && p.y >= radius && p.x <= view.w - radius && p.y <= view.h - radius;
}

export function inBand(p, radius, view) {
  return fullyInView(p, radius, view) && distToRect(p, centerZone(view)) >= radius;
}

export function pickWanderTarget({ from, radius, view, random }) {
  const diag = Math.hypot(view.w, view.h);
  const maxHop = diag * MAX_HOP_FRACTION;
  // Sample inside the band (four strips weighted by area) so tries rarely miss.
  const z = centerZone(view);
  const lo = radius, hiX = view.w - radius, hiY = view.h - radius;
  const strips = [
    [lo, lo, z.x - radius, hiY],
    [z.x + z.w + radius, lo, hiX, hiY],
    [lo, lo, hiX, z.y - radius],
    [lo, z.y + z.h + radius, hiX, hiY],
  ].filter(s => s[2] > s[0] && s[3] > s[1])
   .map(s => ({ s, area: (s[2] - s[0]) * (s[3] - s[1]) }));
  const totalArea = strips.reduce((a, b) => a + b.area, 0);
  const sample = () => {
    if (!strips.length) return clampToView({ x: lo, y: lo }, radius, view);
    let pick = random() * totalArea, chosen = strips[strips.length - 1].s;
    for (const st of strips) { if (pick < st.area) { chosen = st.s; break; } pick -= st.area; }
    return clampToView({
      x: lerp(chosen[0], chosen[2], random()),
      y: lerp(chosen[1], chosen[3], random()),
    }, radius, view);
  };
  const hop = p => Math.hypot(p.x - from.x, p.y - from.y);

  for (let i = 0; i < 40; i++) {
    const p = sample();
    const d = hop(p);
    if (inBand(p, radius, view) && d >= MIN_HOP && d <= maxHop) return p;
  }
  // Relax the maximum hop.
  for (let i = 0; i < 200; i++) {
    const p = sample();
    if (inBand(p, radius, view) && hop(p) >= MIN_HOP) return p;
  }
  // Deterministic fallback: farthest in-band anchor (corners / edge midpoints).
  const anchors = [];
  for (const x of [radius, view.w / 2, view.w - radius]) {
    for (const y of [radius, view.h / 2, view.h - radius]) {
      const p = clampToView({ x, y }, radius, view);
      if (inBand(p, radius, view)) anchors.push(p);
    }
  }
  if (!anchors.length) return clampToView({ x: radius, y: radius }, radius, view);
  return anchors.reduce((a, b) => (hop(b) > hop(a) ? b : a));
}

export function makePath(from, to, random) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const chord = Math.hypot(dx, dy);
  const side = random() < 0.5 ? -1 : 1;
  const offset = chord * lerp(0.15, 0.30, random()) * side;
  const nx = chord ? -dy / chord : 0, ny = chord ? dx / chord : 0;
  const control = {
    x: (from.x + to.x) / 2 + nx * offset,
    y: (from.y + to.y) / 2 + ny * offset,
  };
  const path = { from, to, control, length: 0 };
  let prev = from, length = 0;
  for (let i = 1; i <= 24; i++) {
    const p = pointOnPath(path, i / 24);
    length += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  path.length = length;
  return path;
}

export function pointOnPath(path, u) {
  if (u <= 0) return { x: path.from.x, y: path.from.y };
  if (u >= 1) return { x: path.to.x, y: path.to.y };
  const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
  return {
    x: a * path.from.x + b * path.control.x + c * path.to.x,
    y: a * path.from.y + b * path.control.y + c * path.to.y,
  };
}

export function travelDuration(path) {
  return clamp((path.length / SPEED) * 1000, 2500, 20000);
}

export function restDuration(random) {
  return lerp(30000, 180000, random());
}

export function besideTarget({ target, radius, view, from }) {
  const gap = radius + BESIDE_GAP;
  const cx = target.x + target.w / 2, cy = target.y + target.h / 2;
  const raw = [
    { x: target.x - gap, y: cy },
    { x: target.x + target.w + gap, y: cy },
    { x: cx, y: target.y - gap },
    { x: cx, y: target.y + target.h + gap },
  ];
  const hop = p => Math.hypot(p.x - from.x, p.y - from.y);
  let best = null;
  for (const c of raw) {
    const p = clampToView(c, radius, view);
    if (!fullyInView(p, radius, view) || distToRect(p, target) < radius) continue;
    if (!best || hop(p) < hop(best)) best = p;
  }
  if (best) return best;

  // Nothing fits: the in-view point farthest from the target's center.
  const N = 24;
  let far = null, farD = -1;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const p = clampToView({
        x: lerp(radius, view.w - radius, i / N),
        y: lerp(radius, view.h - radius, j / N),
      }, radius, view);
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d > farD) { far = p; farD = d; }
    }
  }
  return far;
}

export function edgeToward({ direction, radius, view, from }) {
  const p = clampToView(from, radius, view);
  switch (direction) {
    case 'left': return { x: clampAxis(0, radius, view.w), y: p.y };
    case 'right': return { x: clampAxis(view.w, radius, view.w), y: p.y };
    case 'up': return { x: p.x, y: clampAxis(0, radius, view.h) };
    case 'down': return { x: p.x, y: clampAxis(view.h, radius, view.h) };
    default: return p;
  }
}

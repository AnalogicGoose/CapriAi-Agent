// Stella's body painter: draws one frame of her body (ambient glow, blades,
// sticks, dots, ring) with Canvas 2D from Scene data, plus a mask the WebGL
// finish reads. Mask encoding per blade/stick: R = 255*coverage, G = 255*u
// (0 at the inner end, 1 at the tip), B = 255*seed/8, A = coverage.
// The mask is pure shape coverage: it does NOT follow per-item fade. Task 8
// must multiply sheen/edges by scene.brightness and each blade/stick's alpha.
// Edge pixels are premultiplied (R/G/B scaled by coverage), so decode u and
// seed only where A is about 1, and sample with NEAREST.
import {TAU, clamp} from './math.js';
import {P} from './params.js';

function makeCanvas(size) {
  const n = Math.max(1, Math.round(size));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(n, n);
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return c;
}

// Straight tapered quad from (x0,y0) to (x1,y1), width w0 at the start, w1 at the end.
function taper(ctx, x0, y0, x1, y1, w0, w1) {
  let dx = x1 - x0, dy = y1 - y0;
  const d = Math.hypot(dx, dy) || 1;
  dx /= d; dy /= d;
  const a = w0 / 2, b = w1 / 2;
  ctx.beginPath();
  ctx.moveTo(x0 - dy * a, y0 + dx * a);
  ctx.lineTo(x1 - dy * b, y1 + dx * b);
  ctx.lineTo(x1 + dy * b, y1 - dx * b);
  ctx.lineTo(x0 + dy * a, y0 - dx * a);
  ctx.closePath();
  ctx.fill();
}

// A blade or stick around (cx, cy) at `angle`, from rIn to rOut. Straight unless `sweep` (rad): curled
// (away mode's closed bud), the tip turns by `sweep` and the sides bow along the curve. Returns the
// inner end and the tip for gradients.
function blade(ctx, cx, cy, angle, rIn, rOut, w0, w1, sweep = 0) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const x0 = cx + ca * rIn, y0 = cy + sa * rIn;
  if (Math.abs(sweep) < 1e-3) {
    const x1 = cx + ca * rOut, y1 = cy + sa * rOut;
    taper(ctx, x0, y0, x1, y1, w0, w1);
    return [x0, y0, x1, y1];
  }
  const ta = angle + sweep, x1 = cx + Math.cos(ta) * rOut, y1 = cy + Math.sin(ta) * rOut;
  const ma = angle + sweep * 0.35, rm = (rIn + rOut) / 2, mx = cx + Math.cos(ma) * rm, my = cy + Math.sin(ma) * rm;
  const nx = -Math.sin(ma), ny = Math.cos(ma), a = w0 / 2, b = w1 / 2, m = (a + b) / 2;
  ctx.beginPath();
  ctx.moveTo(x0 - sa * a, y0 + ca * a);
  ctx.quadraticCurveTo(mx + nx * m, my + ny * m, x1 - Math.sin(ta) * b, y1 + Math.cos(ta) * b);
  ctx.lineTo(x1 + Math.sin(ta) * b, y1 - Math.cos(ta) * b);
  ctx.quadraticCurveTo(mx - nx * m, my - ny * m, x0 + sa * a, y0 - ca * a);
  ctx.closePath();
  ctx.fill();
  return [x0, y0, x1, y1];
}

// The ring's colours, warmed toward moonlight gold by `w` (0..1: waiting on a permission while resting).
const GOLD = [246, 220, 156];
const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const warmed = (c, w) => w > 0 ? `rgb(${hex(c).map((v, i) => Math.round(v + (GOLD[i] - v) * w)).join(',')})` : c;

export class BodyPainter {
  constructor(size) {
    this.resize(size);
  }

  resize(size) {
    const n = Math.max(1, Math.round(size));
    if (this.body && n === this.size) return;
    this.size = n;
    this.body = makeCanvas(this.size);
    this.mask = makeCanvas(this.size);
    this.bctx = this.body.getContext('2d');
    this.mctx = this.mask.getContext('2d');
  }

  paint(scene) {
    this.#paintBody(scene);
    this.#paintMask(scene);
    return {body: this.body, mask: this.mask};
  }

  #paintBody(sc) {
    const ctx = this.bctx, s = this.size, k = s / sc.s, cx = sc.cx * k, cy = sc.cy * k, scale = s / 360;
    const C = P.colors;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, s, s);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
    const R = sc.R * k;

    // Ambient glow.
    if (sc.ambient > 0.001) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, C.ambient.replace('A', sc.ambient.toFixed(4)));
      g.addColorStop(1, 'rgba(20,20,80,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
    }

    // Blades, then sticks: radial gradient from the inner to the outer end.
    const draw = (list, stops, mid) => {
      for (const b of list) {
        if (b.alpha <= 0 || b.rOut <= b.rIn) continue;
        const rIn = b.rIn * k, rOut = b.rOut * k;
        const g = ctx.createRadialGradient(cx, cy, rIn, cx, cy, rOut);
        g.addColorStop(0, stops[0]); g.addColorStop(mid, stops[1]); g.addColorStop(1, stops[2]);
        ctx.fillStyle = g;
        ctx.globalAlpha = clamp(b.alpha, 0, 1);
        blade(ctx, cx, cy, b.angle, rIn, rOut, b.wIn * k, b.wOut * k, b.sweep || 0);
      }
      ctx.globalAlpha = 1;
    };
    draw(sc.blades, C.blade, 0.45);
    draw(sc.sticks, C.stick, 0.5);

    // Dot swarms; keep them readable at small sizes.
    const dotMin = s < 200 ? 0.9 : 0;
    for (const d of [...sc.dots, ...(sc.trail || [])]) {
      if (d.alpha <= 0) continue;
      ctx.globalAlpha = clamp(d.alpha, 0, 1);
      ctx.fillStyle = d.color;
      ctx.beginPath(); ctx.arc(d.x * k, d.y * k, Math.max(dotMin, d.r * k), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Ring: conic gradient, soft glow, thinking chase arc.
    const ring = sc.ring, rr = ring.r * k;
    if (rr > 0.5 && ring.alpha > 0) {
      const cg = ctx.createConicGradient(ring.turn, cx, cy);
      for (const [pos, col] of C.ring) cg.addColorStop(pos, warmed(col, sc.ringWarm || 0));
      ctx.globalAlpha = clamp(ring.alpha, 0, 1);
      ctx.strokeStyle = cg;
      ctx.lineWidth = Math.max(1.2, 4 * scale);
      ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.stroke();
      const g = ctx.createRadialGradient(cx, cy, rr * 0.85, cx, cy, rr * 1.25);
      g.addColorStop(0, 'rgba(240,200,190,0)');
      const glow = typeof ring.glow === 'number' ? ring.glow : 0.14 * ring.alpha;
      g.addColorStop(0.5, `rgba(240,200,190,${clamp(glow, 0, 1).toFixed(4)})`);
      g.addColorStop(1, 'rgba(240,200,190,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, rr * 1.25, 0, TAU); ctx.fill();
      const think = ring.chase.strength;
      if (think > 0.02) {
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#fff1d6';
        for (let i = 0; i < 14; i++) {
          ctx.globalAlpha = clamp(think * (1 - i / 14) * ring.alpha, 0, 1);
          ctx.lineWidth = Math.max(1.4, 6 * scale) * (1 - i / 20);
          const a = ring.chase.angle - i * 0.06;
          ctx.beginPath(); ctx.arc(cx, cy, rr, a, a + 0.07); ctx.stroke();
        }
        ctx.lineCap = 'butt';
      }
      ctx.globalAlpha = 1;
    }

    // Bright center point while folding.
    if (sc.point && sc.point.alpha > 0.001) {
      const pr = Math.max(1.5, sc.point.r * k);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, pr);
      g.addColorStop(0, C.inner[0]); g.addColorStop(0.5, C.inner[1]); g.addColorStop(1, C.inner[2]);
      ctx.globalAlpha = clamp(sc.point.alpha, 0, 1);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, pr, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  #paintMask(sc) {
    const ctx = this.mctx, s = this.size, k = s / sc.s, cx = sc.cx * k, cy = sc.cy * k;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, s, s);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const shape = b => {
      if (b.alpha <= 0 || b.rOut <= b.rIn) return;
      const ca = Math.cos(b.angle), sa = Math.sin(b.angle), ta = b.angle + (b.sweep || 0);
      const x0 = cx + ca * b.rIn * k, y0 = cy + sa * b.rIn * k;
      const x1 = cx + Math.cos(ta) * b.rOut * k, y1 = cy + Math.sin(ta) * b.rOut * k;
      const bl = Math.round(255 * b.seed / 8);
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, `rgb(255,0,${bl})`); g.addColorStop(1, `rgb(255,255,${bl})`);
      ctx.fillStyle = g;
      blade(ctx, cx, cy, b.angle, b.rIn * k, b.rOut * k, b.wIn * k, b.wOut * k, b.sweep || 0);
    };
    sc.blades.forEach(shape);
    sc.sticks.forEach(shape);
  }
}

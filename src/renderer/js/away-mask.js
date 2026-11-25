// Her mask, drawn by her away forms (chip.js). Placeholder until away mode is redesigned.

export const COLORS = {
  red: '#ff2152',
  green: '#36ff7a',
  ink: '#14101c',
  violet: '#7b3dff',
  paper: '#fff4f6',
  blue: '#3d6bff',
};

// Her mask, what she is at heart in the show once the mane and the body are gone: a green
// slab of a face with a hooked spike rising from it, two eyes (ink almonds, green ring, blue
// iris, white pupil turned toward `look`), and a white fang under it, all over a violet copy.
// Drawn around (x, y) = the middle of the face, k = scale (1: about 95 px wide).
//   eyes   how open each eye is, [left, right]; under 0.15 it's shut (a thick sleepy curve)
//   spike  draw the hooked spike above it
//   flat   one colour for the whole thing (an impact frame)
const MASK = {
  face: [[-48, -20], [-12, -22], [48, -26], [46, 20], [-45, 23]],
  spike: [[-32, -20], [-37, -50], [-22, -63], [6, -67], [24, -75], [34, -99], [49, -90], [44, -66], [30, -48], [2, -42], [-10, -40], [-12, -21]],
  fang: [[-6, 22], [1, 27], [8, 22], [13, 26], [22, 21], [8, 52]],
  eyes: [[-23, 0], [22, -3]],
};

export function drawMask(ctx, x, y, k, { eyes = [1, 1], look = null, spike = true, flat = null } = {}) {
  const poly = (pts, dx = 0, dy = 0) => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px + dx, py + dy) : ctx.moveTo(px + dx, py + dy)));
    ctx.closePath();
  };
  const shapes = spike ? [MASK.spike, MASK.face, MASK.fang] : [MASK.face, MASK.fang];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.lineJoin = 'miter';
  for (const s of shapes) {
    poly(s, 3, 3);
    ctx.fillStyle = flat || COLORS.violet;
    ctx.fill();
  }
  if (flat) {
    for (const s of shapes) {
      poly(s);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  if (spike) {
    poly(MASK.spike);
    ctx.fillStyle = COLORS.green;
    ctx.fill();
  }
  poly(MASK.face);
  ctx.fillStyle = COLORS.green;
  ctx.fill();
  poly(MASK.fang);
  ctx.fillStyle = COLORS.paper;
  ctx.fill();
  ctx.strokeStyle = COLORS.green;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  MASK.eyes.forEach(([ex, ey], i) => {
    const o = eyes[i];
    if (o < 0.15) {
      // shut
      ctx.beginPath();
      ctx.moveTo(ex - 15, ey - 4);
      ctx.lineTo(ex, ey + 5);
      ctx.lineTo(ex + 15, ey - 4);
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = 4.5;
      ctx.stroke();
      return;
    }
    let px = 0, py = 0;
    if (look) {
      const d = Math.hypot(look.x - (x + ex * k), look.y - (y + ey * k)) || 1;
      px = ((look.x - (x + ex * k)) / d) * 2.6;
      py = ((look.y - (y + ey * k)) / d) * 2.2;
    }
    ctx.save();
    ctx.translate(ex, ey);
    ctx.scale(1, o);
    ctx.beginPath(); // an almond of ink
    ctx.moveTo(-19, 0);
    ctx.quadraticCurveTo(0, -24, 19, 0);
    ctx.quadraticCurveTo(0, 24, -19, 0);
    ctx.fillStyle = COLORS.ink;
    ctx.fill();
    const disk = (dx, dy, r, color) => {
      ctx.beginPath();
      ctx.arc(dx, dy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    };
    disk(px * 0.4, py * 0.4, 10.5, COLORS.green);
    disk(px * 0.4, py * 0.4, 8.8, COLORS.ink);
    disk(px * 0.7, py * 0.7, 7.6, COLORS.blue);
    ctx.beginPath();
    ctx.ellipse(px, py, 3, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.paper;
    ctx.fill();
    ctx.restore();
  });
  ctx.restore();
}

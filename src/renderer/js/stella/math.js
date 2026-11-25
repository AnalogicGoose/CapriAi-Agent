export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, k) => a + (b - a) * k;
export const smoothstep = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
export const easeInOut = smoothstep;
export const damp = (current, target, rate, dt) => lerp(current, target, 1 - Math.exp(-rate * dt));
export const noise1 = x =>
  (Math.sin(1.7 * x) + 0.6 * Math.sin(2.9 * x + 1.3) + 0.35 * Math.sin(4.3 * x + 2.1)) / 1.95;

// Pass 1 of Stella's WebGL finish: the painted body redrawn as fine round LEDs
// sitting in a soft blurred glow, then the holo sheen, flicker and crisp edges
// on the blades and sticks, read from the painter's shape mask.
import {compile, makeTexture, upload, parseColor, wrapPhase} from './gl.js';
import {P} from './params.js';

const VS = `#version 300 es
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uBody, uMask;
uniform vec2 uSize, uCenter;
uniform float uCell, uLim, uGlowA, uBlur, uLod, uLevels;
uniform vec4 uUnlit, uEdge;
uniform float uItem[8];
uniform float uPh23, uPh31, uPos, uSheen, uSeedStep, uFlick, uWidth, uSheenA;
uniform vec3 uCyan, uPink;
out vec4 o;

vec4 maskAt(ivec2 q) { return texelFetch(uMask, clamp(q, ivec2(0), ivec2(uSize) - 1), 0); }

void main() {
  vec2 p = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);   // top-left origin, like the canvases
  // Soft glow: 9 taps on a blurred mip level of the body.
  vec4 glow = vec4(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    float w = (i == 0 ? 2.0 : 1.0) * (j == 0 ? 2.0 : 1.0);
    glow += w * textureLod(uBody, (p + vec2(i, j) * uBlur) / uSize, uLod);
  }
  glow *= uGlowA / 16.0;

  // LEDs: one round light per cell, size and brightness quantized to uLevels.
  vec2 cell = (floor(p / uCell) + 0.5) * uCell;
  vec2 dc = cell - uCenter;
  vec4 led = vec4(0.0);
  if (dot(dc, dc) <= uLim * uLim) {
    vec4 b = textureLod(uBody, cell / uSize, 0.0);   // premultiplied
    float l = max(b.r, max(b.g, b.b)), d = length(p - cell);
    if (l < 0.06) {
      led = vec4(uUnlit.rgb, 1.0) * uUnlit.a * clamp(uCell * 0.28 - d + 0.5, 0.0, 1.0);
    } else {
      float q = ceil(l * uLevels) / uLevels;
      vec3 c = min(vec3(1.0), b.rgb / max(b.a, 1e-3) * q / max(l, 0.01));
      float a = (0.35 + 0.65 * q) * clamp(uCell * (0.26 + 0.2 * q) - d + 0.5, 0.0, 1.0);
      led = vec4(c * a, a);
    }
  }
  vec4 col = led + glow * (1.0 - led.a);

  // Holo sheen and crisp edge from the mask (u and seed decoded only on solid pixels).
  if (uSheen > 0.5) {
    ivec2 q = ivec2(p);
    vec4 m = maskAt(q), r = maskAt(q + ivec2(1, 0)), lf = maskAt(q - ivec2(1, 0));
    vec4 dn = maskAt(q + ivec2(0, 1)), up = maskAt(q - ivec2(0, 1));
    vec4 src = m; bool ok = m.a > 0.99;
    if (!ok) {
      if (r.a > 0.99) { src = r; ok = true; } else if (lf.a > 0.99) { src = lf; ok = true; }
      else if (dn.a > 0.99) { src = dn; ok = true; } else if (up.a > 0.99) { src = up; ok = true; }
      else if (m.a > 0.25) { ok = true; }   // thin tips: browser-unpremultiplied, good enough
    }
    if (ok && m.a > 0.0) {
      int seed = clamp(int(floor(src.b * 8.0 + 0.5)), 0, 7);
      float fs = float(seed), k = uItem[seed];   // item alpha already includes brightness
      float fl = 1.0 + uFlick * sin(uPh23 + 7.0 * fs) * sin(uPh31 + fs);
      float x = src.g - (mod(uPos + fs * uSeedStep, 1.4) - 0.2);
      // cyan -> pink band: ramps in over [-(w+0.02), -0.06], holds to 0.04, fades out by w.
      float a = uSheenA * smoothstep(-uWidth - 0.02, -0.06, x) * (1.0 - smoothstep(0.04, uWidth, x));
      vec3 c = mix(uCyan, uPink, smoothstep(-0.06, 0.04, x));
      float lift = 0.05;                           // faint lift of light over the whole blade
      vec4 add = (vec4(c * a, a) + vec4(0.78, 0.75, 1.0, 1.0) * lift) * fl;
      float edge = max(max(abs(m.a - r.a), abs(m.a - lf.a)), max(abs(m.a - dn.a), abs(m.a - up.a)));
      add += vec4(uEdge.rgb, 1.0) * uEdge.a * edge / m.a;
      col = min(col + add * m.a * k, vec4(1.0));
    }
  }
  o = col;
}`;

const UNLIT = parseColor(P.led.unlit), EDGE = parseColor(P.sheen.edge);
const TAU = Math.PI * 2;

// Time-driven sheen phases, wrapped: [23t mod 2pi, 3.1t mod 2pi, (t'*speed) mod 1.4],
// with t' stepped to 1/6 s while the sheen ticks. Writes into `out`.
export function sheenPhases(t, sheen, out) {
  const tt = sheen.stepped ? Math.floor(t * 6) / 6 : t;
  out[0] = wrapPhase(23 * t, TAU);
  out[1] = wrapPhase(3.1 * t, TAU);
  out[2] = wrapPhase(tt * sheen.speed, 1.4);
  return out;
}

const CYAN = P.sheen.cyan.map(v => v / 255), PINK = P.sheen.pink.map(v => v / 255);

export class FinishPass {
  constructor(gl) {
    this.gl = gl;
    this.p = compile(gl, VS, FS);
    this.body = makeTexture(gl, gl.LINEAR, true);
    this.mask = makeTexture(gl, gl.NEAREST);
    this.items = new Float32Array(8);
    this.ph = new Float64Array(3);
  }

  draw(scene, t, body, mask) {
    const gl = this.gl, u = this.p.u, W = body.width, H = body.height, k = W / scene.s;
    upload(gl, this.body, 0, body, true);
    upload(gl, this.mask, 1, mask, false);
    gl.useProgram(this.p.prog);
    gl.uniform1i(u.uBody, 0); gl.uniform1i(u.uMask, 1);
    gl.uniform2f(u.uSize, W, H);
    gl.uniform2f(u.uCenter, scene.cx * k, scene.cy * k);
    gl.uniform1f(u.uCell, Math.max(P.led.cellMin, P.led.cell * scene.s / 360) * k);
    gl.uniform1f(u.uLim, 0.48 * scene.s * k);
    const blur = Math.max(1, P.led.glowBlur * scene.s / 360) * k;
    gl.uniform1f(u.uGlowA, P.led.glowAlpha);
    gl.uniform1f(u.uBlur, blur);
    gl.uniform1f(u.uLod, Math.max(0, Math.log2(blur) - 0.5));
    gl.uniform1f(u.uLevels, P.led.levels);
    gl.uniform4fv(u.uUnlit, UNLIT); gl.uniform4fv(u.uEdge, EDGE);
    for (const b of scene.blades) this.items[b.seed] = b.alpha;
    for (const b of scene.sticks) this.items[b.seed] = b.alpha;
    gl.uniform1fv(u.uItem, this.items);
    const sh = scene.sheen;
    const amount = typeof sh.flickerAmount === 'number' ? sh.flickerAmount : (sh.flicker ? 1 : 0);
    sheenPhases(t, sh, this.ph);
    gl.uniform1f(u.uPh23, this.ph[0]); gl.uniform1f(u.uPh31, this.ph[1]); gl.uniform1f(u.uPos, this.ph[2]);
    gl.uniform1f(u.uSheen, sh.enabled ? 1 : 0);
    gl.uniform1f(u.uSeedStep, sh.seedStep);
    gl.uniform1f(u.uFlick, (0.27 + 0.4 * (sh.flickerBoost || 0)) * amount);
    gl.uniform1f(u.uWidth, P.sheen.width);
    gl.uniform1f(u.uSheenA, P.sheen.alpha);
    gl.uniform3fv(u.uCyan, CYAN); gl.uniform3fv(u.uPink, PINK);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteProgram(this.p.prog);
    gl.deleteTexture(this.body.tex); gl.deleteTexture(this.mask.tex);
  }
}

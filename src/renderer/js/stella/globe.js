// Pass 2 of Stella's WebGL finish: the see-through globe of dots (golden-spiral
// points, rotated and rippled in the vertex shader) and the soft inner light.
import {compile, parseColor} from './gl.js';
import {P} from './params.js';

const DOT_VS = `#version 300 es
in vec3 aP;
uniform vec2 uSize, uCenter;
uniform float uR, uYaw, uPitch, uWavy, uRipple, uT, uScan, uSizeK, uMinR, uFade;
uniform vec3 uFront, uBack;
out vec4 vCol;
out float vRad, vBox;
void main() {
  vec3 p = aP;
  float band = 0.5 * sin(7.0 * p.y - uRipple) + 0.5 * sin(4.0 * atan(p.z, p.x) + 3.0 * uT);
  float r = uR * (1.0 + uWavy * 0.13 * band);
  float cy = cos(uYaw), sy = sin(uYaw), cp = cos(uPitch), sp = sin(uPitch);
  float x = p.x * cy + p.z * sy, z = -p.x * sy + p.z * cy;
  float y = p.y * cp - z * sp;
  z = p.y * sp + z * cp;
  float front = (z + 1.0) * 0.5;
  float a = clamp(0.18 + front * 0.7 + max(0.0, band) * uWavy * 0.3, 0.0, 1.0);
  vec3 c = mix(uBack, uFront, smoothstep(0.5, 0.7, front));
  if (uScan >= 0.0) {   // a bright band sweeping down the globe
    float g = exp(-pow((y - mix(-1.2, 1.2, uScan)) / 0.15, 2.0));
    a = min(1.0, a + 0.6 * g);
    c = mix(c, vec3(1.0), 0.6 * g);
  }
  a *= uFade;
  vec2 s = uCenter + vec2(x, y) * r;
  vRad = max(uMinR, (0.7 + front) * uSizeK);
  vBox = 2.0 * vRad + 2.0;
  gl_PointSize = vBox;
  gl_Position = vec4(s.x / uSize.x * 2.0 - 1.0, 1.0 - s.y / uSize.y * 2.0, 0.0, 1.0);
  vCol = vec4(c * a, a);
}`;

const DOT_FS = `#version 300 es
precision highp float;
in vec4 vCol;
in float vRad, vBox;
out vec4 o;
void main() {
  float d = length(gl_PointCoord - 0.5) * vBox;
  o = vCol * clamp(vRad - d + 0.5, 0.0, 1.0);
}`;

// The heart: a quad from gl_VertexID, radial gradient in the fragment shader.
const HEART_VS = `#version 300 es
uniform vec2 uSize, uCenter;
uniform float uR;
out vec2 vP;
void main() {
  vP = vec2(gl_VertexID & 1, gl_VertexID >> 1) * 2.0 - 1.0;
  vec2 s = uCenter + vP * uR;
  gl_Position = vec4(s.x / uSize.x * 2.0 - 1.0, 1.0 - s.y / uSize.y * 2.0, 0.0, 1.0);
}`;

const HEART_FS = `#version 300 es
precision highp float;
in vec2 vP;
uniform float uAlpha;
uniform vec4 uC0, uC1, uC2;
out vec4 o;
void main() {
  float d = length(vP);
  vec4 c = d < 0.3 ? mix(uC0, uC1, d / 0.3) : mix(uC1, uC2, clamp((d - 0.3) / 0.7, 0.0, 1.0));
  float a = c.a * uAlpha * step(d, 1.0);
  o = vec4(c.rgb * a, a);
}`;

// Golden-spiral points on the unit sphere.
function spiral(n) {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), th = i * 2.39996;
    out[i * 3] = Math.cos(th) * r; out[i * 3 + 1] = y; out[i * 3 + 2] = Math.sin(th) * r;
  }
  return out;
}

const POINTS = spiral(P.globePoints);
const FRONT = parseColor(P.colors.globeFront).slice(0, 3), BACK = parseColor(P.colors.globeBack).slice(0, 3);
const INNER = P.colors.inner.map(parseColor);

export class GlobePass {
  constructor(gl) {
    this.gl = gl;
    this.dots = compile(gl, DOT_VS, DOT_FS);
    this.heart = compile(gl, HEART_VS, HEART_FS);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, POINTS, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.dots.prog, 'aP');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  draw(scene, t, W, H) {
    const gl = this.gl, g = scene.globe, k = W / scene.s, cx = scene.cx * k, cy = scene.cy * k;
    const fade = g.heart ? g.heart.alpha : scene.brightness;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);   // additive, premultiplied
    if (g.r > 0.01 && fade > 0.001) {
      const u = this.dots.u, sc = scene.s / 360, dotMin = scene.s < 200 ? 0.9 : 0;
      gl.useProgram(this.dots.prog);
      gl.uniform2f(u.uSize, W, H); gl.uniform2f(u.uCenter, cx, cy);
      gl.uniform1f(u.uR, g.r * k);
      gl.uniform1f(u.uYaw, g.yaw); gl.uniform1f(u.uPitch, g.pitch);
      gl.uniform1f(u.uWavy, g.wavy); gl.uniform1f(u.uRipple, g.ripple); gl.uniform1f(u.uT, t);
      gl.uniform1f(u.uScan, g.scan == null ? -1 : g.scan);
      gl.uniform1f(u.uSizeK, sc * 1.6 * k); gl.uniform1f(u.uMinR, dotMin * 0.8 * k);
      gl.uniform1f(u.uFade, Math.min(1, fade));
      gl.uniform3fv(u.uFront, FRONT); gl.uniform3fv(u.uBack, BACK);
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.POINTS, 0, P.globePoints);
      gl.bindVertexArray(null);
    }
    const h = g.heart;
    if (h && h.r > 0.01 && h.alpha > 0.001) {
      const u = this.heart.u;
      gl.useProgram(this.heart.prog);
      gl.uniform2f(u.uSize, W, H); gl.uniform2f(u.uCenter, cx, cy);
      gl.uniform1f(u.uR, h.r * k); gl.uniform1f(u.uAlpha, Math.min(1, h.alpha));
      gl.uniform4fv(u.uC0, INNER[0]); gl.uniform4fv(u.uC1, INNER[1]); gl.uniform4fv(u.uC2, INNER[2]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.disable(gl.BLEND);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteProgram(this.dots.prog); gl.deleteProgram(this.heart.prog);
    gl.deleteBuffer(this.buf); gl.deleteVertexArray(this.vao);
  }
}

// Stella's renderer: paints the scene's body with the BodyPainter, then draws it
// on a transparent WebGL2 canvas as LEDs with the holo sheen (FinishPass) and
// the spinning globe with its inner light on top (GlobePass).
import {BodyPainter} from './body-painter.js';
import {FinishPass} from './finish.js';
import {GlobePass} from './globe.js';

const ATTRS = {premultipliedAlpha: true, alpha: true, antialias: false, depth: false, stencil: false};

export class StellaRenderer {
  #lost = false;

  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', ATTRS);
    if (!this.gl) throw new Error('Stella: WebGL2 is not available');
    this.painter = new BodyPainter(Math.max(1, canvas.width || 1));
    this.onLost = e => { e.preventDefault(); this.#lost = true; this.finish = this.globe = null; };
    this.onRestored = () => { this.#lost = false; this.#init(); };
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.#init();
  }

  #init() {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    this.finish = new FinishPass(gl);
    this.globe = new GlobePass(gl);
  }

  get lost() {
    return this.#lost || !this.gl || this.gl.isContextLost();
  }

  setSize(cssSize, dpr = 1) {
    const n = Math.max(1, Math.round(cssSize * dpr));
    this.canvas.style.width = this.canvas.style.height = cssSize + 'px';
    if (this.canvas.width !== n) this.canvas.width = n;
    if (this.canvas.height !== n) this.canvas.height = n;
    this.painter.resize(n);
  }

  draw(scene, t) {
    if (this.lost || !this.finish) return;
    const gl = this.gl, W = this.canvas.width, H = this.canvas.height;
    if (this.painter.size !== W) this.painter.resize(W);
    const {body, mask} = this.painter.paint(scene);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.finish.draw(scene, t, body, mask);
    this.globe.draw(scene, t, W, H);
  }

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    if (!this.lost) {
      if (this.finish) this.finish.dispose();
      if (this.globe) this.globe.dispose();
    }
    this.finish = this.globe = null;
    this.gl = null;
  }
}

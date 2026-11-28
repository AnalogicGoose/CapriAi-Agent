// Stella: away mode. Put away (Ctrl+Alt+C, the tray, the control room), she glides in a soft arc
// to the bottom-left corner, shrinking, and over the second half her blades and sticks curl round
// into a closed bud. There she rests: slow breath, a lazy globe, a sleepy stretch now and then.
// A click on the bud brings her back the same way in reverse. Reduced motion fades her out where
// she is and in at the corner instead. She can still talk from there (her head() follows the bud).
// Installed on Stella's prototype (getters included); `this` is the controller.
import { clamp, damp, easeInOut, lerp, smoothstep } from './math.js';
import { isPoint } from './focus.js';
import { MOTION_CUES } from './motions.js';

export const REST_MS = 1500;   // going away, and coming back
export const COMPACT = 0.4;    // her size on screen while resting
const ARC = 30;                // px: how high the glide lifts on the way
const FADE_MS = 120;           // reduced motion: each half of the fade
const MARGIN = { left: 26, bottom: 22 }; // bottom-left: the clock and tray are bottom-right, the pointer lives there
const STRETCH_EVERY = 9000, STRETCH_JITTER = 3000, STRETCH_MS = 1600;
const REST_FPS = 18;           // drawing rate once she's curled up and still
const WARM_RATE = 3;           // 1/s: how fast her ring warms while she waits on a permission
const REST_CUES = new Set(['wake', 'chime', 'approval']); // motions whose sound still plays while she rests

const settle = (waiters, value) => { for (const done of waiters.splice(0)) done(value); };

// q: 0 awake … 1 resting (linear; eased when read); dir: +1 going away, -1 coming back, 0 still.
export const restState = () => ({ q: 0, dir: 0, from: null, reduced: false, opacity: 1, warm: 0,
  stretch: 0, stretchStart: null, stretchAt: Infinity, away: [], back: [] });

export const Rest = {
  get restActive() { return this.rest.q > 0 || this.rest.dir !== 0; },
  // Fully curled and settled: drawn at a gentle rate.
  get restQuiet() { return this.stowed && this.rest.q === 1 && this.rest.dir === 0; },
  get curl() {
    const { q, reduced } = this.rest;
    if (q >= 1) return 1;
    return reduced ? (q >= 0.5 ? 1 : 0) : smoothstep((q - 0.5) / 0.5);
  },
  get compact() {
    const { q, reduced } = this.rest;
    if (q >= 1) return COMPACT;
    if (q <= 0) return 1;
    return reduced ? (q >= 0.5 ? COMPACT : 1) : lerp(1, COMPACT, easeInOut(q));
  },
  get stretch() { return this.rest.stretch; },
  get restOpacity() { return this.rest.opacity; },

  // Bottom-left of her view, the whole bud inside the margins.
  cornerSpot() {
    const half = this.size / 2 * COMPACT;
    return { x: MARGIN.left + half, y: this.view.h - MARGIN.bottom - half };
  },

  // Where she is at progress q between where she left from and her corner.
  restPath(q) {
    const a = this.rest.from || this.pos, c = this.cornerSpot();
    if (q >= 1) return c;
    if (q <= 0) return { ...a };
    if (this.rest.reduced) return q >= 0.5 ? c : { ...a };
    const e = easeInOut(q);
    return { x: lerp(a.x, c.x, e), y: lerp(a.y, c.y, e) - Math.sin(Math.PI * e) * ARC };
  },

  restHit(x, y) { return Math.hypot(x - this.pos.x, y - this.pos.y) <= 0.45 * this.size * this.compact; },

  // Put away: off to the corner. Resolves once curled (onStow); a second call joins the first.
  stow() {
    if (this.stowed) return Promise.resolve();
    if (this.stowing) return this.stowing;
    const r = this.rest;
    if (!this.restActive) {
      r.from = { ...this.pos };
      this.letGoAll();
      this.traveler.stop(false);
      this.voice?.play?.('curl-up');
    }
    settle(r.back, false); // turned around on the way back
    r.dir = 1;
    this.stowing = new Promise(done => r.away.push(done));
    return this.stowing;
  },

  // Already away, no show (put away last time, she starts that way).
  stowNow() {
    const r = this.rest;
    this.stowing = null;
    settle(r.back, false); // a return that was under way is over
    settle(r.away, true);
    this.letGoAll();
    this.traveler.stop(false);
    r.from = isPoint(this.anchor) ? { ...this.anchor } : { ...this.pos };
    r.q = 1; r.dir = 0;
    this.stowed = true;
    this.pos = this.cornerSpot();
    this.scheduleStretch(this.now());
    this.onStow?.();
    this.place();
  },

  // Back where she was: unfurls on the way. Resolves once there.
  unstow() {
    const r = this.rest;
    if (!this.stowed && !this.stowing) return r.dir === -1 ? new Promise(done => r.back.push(done)) : Promise.resolve();
    this.stowed = false;
    this.stowing = null;
    settle(r.away, false);
    if (!r.from) r.from = isPoint(this.anchor) ? { ...this.anchor } : { ...this.pos };
    r.dir = -1;
    r.stretch = 0; r.stretchStart = null;
    this.onUnstow?.();
    this.voice?.play?.('unfurl');
    if (this.mode === 'sleep') this.setMode('idle');
    return new Promise(done => r.back.push(done));
  },

  scheduleStretch(now) {
    this.rest.stretchAt = now + STRETCH_EVERY + (this.random() - 0.5) * STRETCH_JITTER;
  },

  // Once per frame, after her position step.
  stepRest(dt, now, reduced) {
    const r = this.rest;
    r.reduced = reduced;
    if (r.dir) r.q = clamp(r.q + r.dir * dt * 1000 / (reduced ? 2 * FADE_MS : REST_MS), 0, 1);
    r.opacity = reduced && r.dir ? Math.abs(2 * r.q - 1) : 1;
    if (this.restActive) this.pos = this.restPath(r.q);
    if (r.dir === 1 && r.q === 1) {
      r.dir = 0;
      this.stowed = true;
      this.stowing = null;
      this.scheduleStretch(now);
      settle(r.away, true);
      this.onStow?.();
    } else if (r.dir === -1 && r.q === 0) {
      r.dir = 0;
      r.from = null;
      settle(r.back, true);
    }
    // waiting on a permission while she rests: her ring warms to gold, her breath quickens
    r.warm = damp(r.warm, this.stowed && this.mode === 'alert' ? 1 : 0, WARM_RATE, dt);
    if (r.warm < 1e-3) r.warm = 0;
    // the sleepy stretch
    if (this.restQuiet && !reduced) {
      if (r.stretchStart == null && now >= r.stretchAt) r.stretchStart = now;
      if (r.stretchStart != null) {
        const p = (now - r.stretchStart) / STRETCH_MS;
        if (p >= 1) { r.stretch = 0; r.stretchStart = null; this.scheduleStretch(now); }
        else r.stretch = Math.sin(Math.PI * p);
      }
    } else { r.stretch = 0; r.stretchStart = null; }
  },

  // Resting, a motion doesn't play; a few still make their sound (heard you, a reminder, a permission).
  restingMotion(name) {
    const cue = REST_CUES.has(name) && MOTION_CUES[name];
    if (cue) globalThis.setTimeout(() => this.voice?.play?.(cue, { ambient: true }), 0);
    return null;
  },

  // Skip a draw while she rests curled and still, keeping to REST_FPS.
  restSkipsDraw(now) { return this.restQuiet && this.drawnAt != null && now - this.drawnAt < 1000 / REST_FPS - 1e-6; },
};

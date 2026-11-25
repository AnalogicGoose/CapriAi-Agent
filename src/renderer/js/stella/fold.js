// Stella: folding away. Put away, a game starting or a fullscreen app on her display: her points
// retract into the ring, the ring collapses into one bright point and the point fades. Coming back
// unfolds her the same way in reverse. Reduced motion fades her out and in instead. Installed on
// Stella's prototype (getters included); `this` is the controller.
import { clamp, smoothstep } from './math.js';
import { clampToView, restDuration } from './wander.js';
import { isPoint } from './focus.js';

const FOLD_MS = 600;        // her own fold (put away, games)
const FADE_MS = 120;        // reduced motion: an opacity fade instead
const DEPART_MAX = 1100;    // ms: a game never waits longer than this for her to fold
const approach = (v, to, step) => (v < to ? Math.min(to, v + step) : Math.max(to, v - step));

// Her own fold timeline. q: linear progress (eased when read); fade: 0 shape … 1 opacity fade.
export const foldState = reduced => ({ q: 0, target: 0, fade: reduced ? 1 : 0, waiters: [] });

function settle(f, reached) {
  const waiters = f.waiters;
  f.waiters = [];
  for (const done of waiters) done(reached);
}

export const Fold = {
  // 0 shown … 1 folded away: her own fold or the fullscreen one, whichever is further along.
  get fold() { return Math.max(smoothstep(this.folding.q), clamp(this.fullscreenProgress || 0, 0, 1)); },
  // What the scene draws (flat under reduced motion), and the opacity that fades her instead.
  get sceneFold() { return this.fold * (1 - this.folding.fade); },
  get foldOpacity() { return 1 - this.fold * this.folding.fade; },

  // Eases her own fold toward `target` (1 folded, 0 shown). Resolves true once there, false when
  // turned around first. Unseen (fullscreen, frozen), it just goes there; a hidden window only skips
  // folding away (right after the overlay shows again it may still report hidden: unfolds always animate).
  foldTo(target, { instant = false } = {}) {
    const f = this.folding;
    if (f.target !== target) { settle(f, false); f.target = target; }
    const unseen = this.hidden || (this.fullscreenProgress || 0) >= 1 || (target === 1 && globalThis.document?.hidden);
    if (instant || unseen) f.q = target;
    if (f.q === target) { settle(f, true); return Promise.resolve(true); }
    return new Promise(done => f.waiters.push(done));
  },

  // Once per frame, before anything moves.
  stepFold(dt, reduced) {
    const f = this.folding;
    f.fade = approach(f.fade, reduced ? 1 : 0, dt * 1000 / FADE_MS);
    if (f.q !== f.target) {
      f.q = approach(f.q, f.target, dt * 1000 / (reduced ? FADE_MS : FOLD_MS));
      if (f.q === f.target) settle(f, true);
    }
    if (this.fold >= 1) this.traveler.stop(false); // folded: whatever travel was pending stops in place
  },

  // The panel follows her away and back (onTeleport start / end), once each.
  announce(away) {
    if (Boolean(this.announced) === away) return;
    this.announced = away;
    this.onTeleport?.(away ? 'start' : 'end');
  },

  // Leaving: what she was doing, held or showing is let go.
  letGoAll() {
    this.endAct(false);
    this.cancelDrag();
    if (this.focus || this.pointing) { this.focus = this.pointing = null; this.homeToken++; }
  },

  // Ctrl+Alt+C: folds away; stowed (onStow) once folded. A second call joins the first.
  stow() {
    if (this.stowed) return Promise.resolve();
    if (this.stowing) return this.stowing;
    this.letGoAll();
    this.announce(true);
    const p = this.foldTo(1).then(reached => {
      if (this.stowing !== p) return;
      this.stowing = null;
      if (!reached) return;
      this.stowed = true;
      this.onStow?.();
    });
    this.stowing = p;
    return p;
  },

  // Already away, no show (put away last time, she starts that way).
  stowNow() {
    this.stowing = null;
    this.letGoAll();
    this.traveler.stop(false);
    this.foldTo(1, { instant: true });
    this.stowed = true;
    this.announce(true);
    this.onStow?.();
    this.place();
  },

  // Back out where she was: unfolds (from wherever a fold in progress had got to).
  unstow() {
    if (!this.stowed && !this.stowing) return Promise.resolve();
    this.stowed = false;
    this.stowing = null;
    this.onUnstow?.();
    if (this.mode === 'sleep') this.setMode('idle');
    return this.unfold();
  },

  unfold() {
    return this.foldTo(0).then(reached => {
      if (!reached) return;
      this.nextMove = Math.max(this.nextMove, this.now() + restDuration(this.random));
      this.announce(false);
    });
  },

  // Starts folded at `spot` and unfolds there.
  materialize(spot) {
    if (this.stowed) return Promise.resolve();
    if (isPoint(spot)) { this.traveler.stop(false); this.pos = clampToView(spot, this.radius, this.view); }
    this.foldTo(1, { instant: true });
    this.place();
    return this.unfold();
  },

  // A game starts: folds away; resolves once folded, and never later than DEPART_MAX.
  gamingDeparture() {
    this.gaming = true;
    this.letGoAll();
    return new Promise(resolve => {
      const timer = globalThis.setTimeout?.(() => this.foldTo(1, { instant: true }), DEPART_MAX);
      this.foldTo(1).then(() => { globalThis.clearTimeout?.(timer); resolve(); });
    });
  },

  // Before the overlay shows again: folded, unseen, back at her anchor.
  prepareGamingReturn() {
    if (this.stowed) return;
    this.traveler.stop(false);
    this.foldTo(1, { instant: true });
    if (this.anchor) this.pos = clampToView(this.anchor, this.radius, this.view);
    this.gamingReturn = true;
    this.drawFrame();
  },

  gamingArrival() {
    if (!this.gamingReturn) return Promise.resolve();
    this.gamingReturn = false;
    return this.stowed ? Promise.resolve() : this.unfold();
  },

  // A fullscreen app came or went (FullscreenPresence keeps the timing): only a soft sound, no particles.
  presenceEffect(active) {
    if (this.stowed || this.folding.target === 1) return; // already away
    this.voice?.play?.(active ? 'teleport-out' : 'teleport-in', { soft: true });
  },
};

// Stella: the overlay controller. Owns her state and drives the renderer once per
// frame. It exposes the same surface the rest of the renderer used on the old sprite
// character, so callers keep calling `stella.*` unchanged. Split by concern: acts.js
// (motions), drag.js (press/drag/drop), focus.js (functions: pointing, walkthrough
// focus, body actions), fold.js (folding away), travel.js (where she goes). No DOM access at import time.
import { clamp } from './math.js';
import { P } from './params.js';
import { StateBlend } from './blend.js';
import { IdleScheduler } from './idle.js';
import { clampToView, inBand, pickWanderTarget, restDuration } from './wander.js';
import { MotionMixer, bodyResponse } from './motions.js';
import { SceneClock, buildScene } from './scene.js';
import { StellaRenderer } from './renderer.js';
import { BOB, Traveler, nearestBandPoint } from './travel.js';
import { Drag } from './drag.js';
import { Acts } from './acts.js';
import { Focus, isPoint, live } from './focus.js';
import { Fold, foldState } from './fold.js';

const MAX_DT = 0.05;        // s
const SPEAK_LEVEL = 0.015, SPEAK_HOLD = 400;
const LISTEN_MS = 3000, AGENT_THINK_MS = 60000;
const GRACE_MS = 2000;      // after speaking, listening or thinking, before she wanders again
const PAUSES = new Set(['speak', 'listen', 'think']);
const LOST_MS = 1000;       // a drawing context lost this long (or no renderer at all): she can't be hit
const resolved = () => Promise.resolve();

function defaultRenderer(canvas) {
  try { return new StellaRenderer(canvas); } catch (error) {
    console.warn?.('Stella: drawing disabled', error?.message);
    return null;
  }
}

export class Stella {
  constructor({ root, canvas, voice, renderer, now = () => performance.now(),
    schedule = fn => requestAnimationFrame(fn), random = Math.random, reduced, saveAnchor = () => {},
    view, dpr = () => globalThis.devicePixelRatio || 1, anchor = null, wander = true } = {}) {
    this.root = root;
    this.canvas = canvas;
    this.voice = voice;
    this.now = now;
    this.schedule = schedule;
    this.random = random;
    if (!reduced) {
      const mq = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
      reduced = () => Boolean(mq?.matches);
    }
    this.reduced = reduced;
    this.saveAnchor = saveAnchor;
    this.dpr = dpr;
    this.renderer = renderer === undefined ? defaultRenderer(canvas) : renderer;

    // state
    this.mode = 'idle'; // idle | work | alert | sleep
    this.stance = 'float';
    this.dormant = false;
    this.hidden = false;
    this.stowed = false; this.stowing = null; this.gaming = false; this.fx = null;
    this.fullscreen = false; this.fullscreenProgress = 0; // FullscreenPresence drives these
    this.folding = foldState(reduced());
    this.chatThinking = false;
    this.companion = null;
    this.windows = { fg: 0, wins: [] };
    this.possessWindows = true; // ignored: she doesn't possess windows anymore
    this.wander = wander !== false;
    this.resting = false;     // napping (body action): no wandering until woken
    this.approvalOn = false;
    this._speech = 0;

    // geometry
    this.scale = 0.6;
    this.view = view ? { w: view.w, h: view.h } : { w: globalThis.innerWidth || 1280, h: globalThis.innerHeight || 720 };
    this.traveler = new Traveler(this);
    this.anchor = isPoint(anchor) ? clampToView(anchor, this.radius, this.view) : this.firstAnchor();
    this.pos = { ...this.anchor };
    this.focus = null;    // what her blade aims at: { at: {x,y} } | { angle }
    this.pointing = null; // { dir, rect?, label? } while she points (dir feeds the panel's lean)
    this.aimAngle = null;
    this.drawTarget = null; // where stella_draw's trail runs: { at } | { angle } | null (toward the middle)
    this.trailAngle = null;
    this.homeToken = 0;   // bumped by anything that should cancel a pending return
    this.lean = 0;
    this.nextMove = now() + restDuration(random);
    this.nextGaze = this.nextMove;

    // pointer
    this.pointerHeld = false;
    this.dragging = false;
    this.down = null;
    this.dragTo = null;

    // callbacks
    this.onMove = null; this.onMode = null; this.onTeleport = null; this.onClick = null; this.onMenu = null;
    this.onPointerHold = null; this.onStow = null; this.onUnstow = null; this.chipAt = null;
    this.onGaze = null; this.onDoze = null; this.onIdleWave = null; // never called

    // animation
    this.blend = new StateBlend();
    this.idle = new IdleScheduler({ random, energy: () => this.companion?.state?.energy ?? 0.5 });
    this.motions = new MotionMixer();
    this.clock = new SceneClock();
    this._act = null;
    this.holds = {};             // the aim / approval holds her functions keep up
    this.agentHolds = new Map(); // tool → the act its start began
    this.timers = [];
    this.thinkUntil = 0; this.listenUntil = 0; this.speakUntil = 0;
    this.agentThink = new Map(); // tool → when it started
    this.musicUntil = 0;
    this.last = null;
    this.lastBlend = 'idle';
    this.moved = null;
    this.shownOpacity = null;

    this.setScale(this.scale);
    this.bindPointer();
    this.frame = this.frame.bind(this);
    this.schedule(this.frame);
  }

  // ---------- geometry ----------

  get size() { return Math.max(P.minSize, Math.round(P.sizeFromScale * this.scale)); }
  get radius() { return this.size / 2; }
  get bandRadius() { return this.radius + BOB; } // her resting bob never takes her out of the band
  get travel() { return this.traveler.current; }

  // First run: the lower-right part of the wander band.
  firstAnchor() {
    const { w, h } = this.view;
    const p = clampToView({ x: w - 0.15 * w, y: h - 0.18 * h }, this.radius, this.view);
    return nearestBandPoint(p, this.bandRadius, this.view);
  }

  setScale(scale) {
    this.scale = scale;
    this.renderer?.setSize(this.size, this.dpr());
    if (this.canvas?.style) this.canvas.style.width = this.canvas.style.height = `${this.size}px`;
    this.reclamp();
  }

  // A new view: her route is planned again, and an anchor that was in the band stays in it.
  setView(w, h) {
    if (this.view.w === w && this.view.h === h) return;
    const wasIn = this.anchor && inBand(this.anchor, this.bandRadius, this.view);
    this.view = { w, h };
    this.reclamp();
    if (wasIn) this.anchor = nearestBandPoint(this.anchor, this.bandRadius, this.view);
  }

  // Keeps her (and where she's heading) fully inside the view.
  reclamp() {
    const fit = p => clampToView(p, this.radius, this.view);
    this.pos = fit(this.pos);
    if (this.anchor) this.anchor = fit(this.anchor);
    this.traveler.reclamp(fit);
    if (this.dragTo) this.dragTo = fit(this.dragTo);
    this.place();
  }

  head() { return { x: this.pos.x, y: this.pos.y - this.size * 0.25, top: this.pos.y - this.radius }; }

  towardCenter() { return this.pos.x < this.view.w / 2 ? 1 : -1; }

  // Not while she can't be seen: hidden, folded, no renderer, or its context lost for good.
  hit(x, y) {
    if (this.hidden || this.fold > 0.5 || !this.renderer) return false;
    if (this.lostSince != null && this.now() - this.lostSince >= LOST_MS) return false;
    return Math.hypot(x - this.pos.x, y - this.pos.y) <= 0.45 * this.size;
  }

  // 'post': her first-run corner; 'stage': where she is (a finished task doesn't move her); else a band point.
  spot(name) {
    const r = this.bandRadius, view = this.view;
    if (name === 'stage') return { ...this.pos };
    if (name === 'post') {
      const p = clampToView({ x: view.w * 0.85, y: view.h * 0.82 }, r, view);
      return inBand(p, r, view) ? p : pickWanderTarget({ from: p, radius: r, view, random: this.random });
    }
    return pickWanderTarget({ from: this.pos, radius: r, view, random: this.random });
  }

  setWindows(data) { this.windows = data; }

  // ---------- state ----------

  setMode(mode) {
    const now = this.now();
    this.nextMove = Math.max(this.nextMove, now + 55000);
    if (mode === 'idle') this.agentThink.clear(); // an agent end that never came can't leave her thinking
    if (this.mode === mode) return;
    const prev = this.mode;
    this.mode = mode;
    this.onMode?.(mode, prev);
  }

  wake() {
    this.dormant = false;
    this.resting = false;
    if (this.mode === 'sleep') this.setMode('idle');
  }

  goToWork() { this.setMode('work'); }

  attend() {
    this.wake();
    this.listenUntil = this.now() + LISTEN_MS;
  }

  wakeHeard() {
    this.wake();
    this.play('wake');
    this.listenUntil = this.now() + LISTEN_MS;
  }

  setChatThinking(on) { this.chatThinking = Boolean(on); }

  get speechLevel() { return this._speech; }
  set speechLevel(level) {
    const v = Number.isFinite(level) ? clamp(level, 0, 1) : 0;
    this._speech = v;
    this.blend.setVoice(v);
    if (v > SPEAK_LEVEL) this.speakUntil = this.now() + SPEAK_HOLD;
  }

  // Busy: on a function's way somewhere, holding something (music aside), or in a strong motion.
  get busy() {
    const now = this.now();
    if (this.travel?.fn) return true;
    return this.motions.list.some(a => live(a, now) && now >= a.start && (a.hold ? a.name !== 'musicPulse' : a.priority >= 2));
  }

  get act() {
    const a = this._act, now = this.now();
    return a && now < a.until && live(a.entry, now) ? { player: { name: a.name } } : null;
  }

  // ---------- removed pet behaviors: safe no-ops ----------

  sitOn() { return resolved(); }
  possess() { return resolved(); }
  doze() { return resolved(); }
  unpeek() { return resolved(); }
  intro(spot) { return this.materialize(spot); }
  canSit() { return false; }
  pickSeat() { return null; }
  requestPosture() { return Promise.resolve(bodyResponse('sit').reply); }

  // ---------- loop ----------

  after(ms, fn) { this.timers.push({ at: this.now() + ms, fn }); }

  blendMode(now) {
    if (now < this.speakUntil) return 'speak';
    if (this.mode === 'alert' || now < this.listenUntil) return 'listen';
    if (this.mode === 'work' || this.chatThinking || now < this.thinkUntil || this.agentThink.size) return 'think';
    if (this.mode === 'sleep' || this.resting) return 'rest';
    return 'idle';
  }

  frame() {
    this.schedule(this.frame);
    const now = this.now();
    const dt = this.last == null ? 0 : clamp((now - this.last) / 1000, 0, MAX_DT) || 0;
    this.last = now;
    const reduced = Boolean(this.reduced());

    const due = this.timers.filter(t => now >= t.at);
    if (due.length) {
      this.timers = this.timers.filter(t => now < t.at);
      for (const t of due) t.fn();
    }
    for (const [tool, at] of this.agentThink) if (now - at > AGENT_THINK_MS) this.agentThink.delete(tool);
    if (this._act && (now >= this._act.until || !live(this._act.entry, now))) this.endAct(now >= this._act.until);
    this.lostSince = this.renderer?.lost ? this.lostSince ?? now : null;
    this.stepFold(dt, reduced);
    this.stepMusic(now);
    this.stepHolds(now);
    this.stepPosition(dt, reduced);

    const mode = this.blendMode(now);
    if (PAUSES.has(this.lastBlend) && !PAUSES.has(mode)) this.nextMove = Math.max(this.nextMove, now + GRACE_MS);
    this.lastBlend = mode;
    this.blend.setMode(mode);
    this.blend.step(dt);
    const calm = mode === 'idle' && this.mode === 'idle' && !this.dragging && !this.travel?.fn && !reduced && !this.fold;
    this.traveler.wander(now, calm && this.wander && !this.down && !this.focus && !this.approvalOn && !this.chatThinking
      && !this.hidden && !this.dormant && !this.fullscreen && !this.gaming);
    const idle = this.idle.update(now, { allowed: calm && this.companion?.options?.idleAnimations !== false });
    const motions = this.motions.update(now);
    this.stepAim(dt, motions);
    this.stepTrail(dt, motions);
    const aim = this.aimAngle, trailAngle = this.trailAngle;
    this.clock.step(dt, this.blend, idle, motions, { reduced, aim });
    this.drawn = { idle, motions, aim, reduced, trailAngle };
    this.drawFrame(now);
  }

  // Draws one frame now from the last step's state (paused while hidden or folded away; once per `now`), and places her.
  drawFrame(now = this.now()) {
    const d = this.drawn;
    if (d && now !== this.drawnAt && !this.hidden && this.fold < 1 && !globalThis.document?.hidden && this.renderer
      && !this.renderer.lost) {
      this.drawnAt = now;
      const t = now / 1000;
      const scene = buildScene({ s: this.size, t, clock: this.clock, blend: this.blend, ...d, fold: this.sceneFold });
      try { this.renderer.draw(scene, t); } catch (error) { console.error?.('Stella: draw failed', error); }
    }
    this.place();
  }

  // Positions the canvas on screen (with the resting bob, kept inside the view) and reports her head when she moved.
  place() {
    const half = this.size / 2;
    const y = clamp(this.pos.y + this.traveler.bob, half, Math.max(half, this.view.h - half));
    if (this.root?.style) {
      this.root.style.transform = `translate3d(${(this.pos.x - half).toFixed(1)}px, ${(y - half).toFixed(1)}px, 0)`;
    }
    if (this.canvas?.style) this.canvas.style.transform = `rotate(${this.lean.toFixed(4)}rad)`;
    const o = this.traveler.opacity * this.foldOpacity, away = this.fold >= 1;
    if (this.root?.style && o !== this.shownOpacity) { this.root.style.opacity = String(Number(o.toFixed(3))); this.shownOpacity = o; }
    if (this.root?.style && away !== this.shownAway) { this.root.style.visibility = away ? 'hidden' : ''; this.shownAway = away; }
    const m = this.moved;
    if (!m || m.x !== this.pos.x || m.y !== this.pos.y || m.size !== this.size) {
      this.moved = { x: this.pos.x, y: this.pos.y, size: this.size };
      this.onMove?.(this.head());
    }
  }
}

for (const part of [Acts, Drag, Focus, Fold]) Object.defineProperties(Stella.prototype, Object.getOwnPropertyDescriptors(part));

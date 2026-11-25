// Stella: the overlay controller. Owns her position, drag, state blend, idle
// variations and motions, and drives the renderer once per frame. It exposes the
// same surface the rest of the renderer used on the old sprite character, so
// callers keep calling `capri.*` unchanged. No DOM access at import time.
import { clamp, damp } from './math.js';
import { P } from './params.js';
import { StateBlend } from './blend.js';
import { IdleScheduler } from './idle.js';
import { clampToView, inBand, pickWanderTarget, restDuration } from './wander.js';
import { MOTIONS, MotionMixer, motionForAct, motionForAgentTool, motionForCodexTool, bodyResponse } from './motions.js';
import { SceneClock, buildScene } from './scene.js';
import { StellaRenderer } from './renderer.js';

const DRAG_THRESHOLD = 5;   // px before a press becomes a drag
const FOLLOW_RATE = 14;     // 1/s: how tightly she follows the pointer, and settles after a drop
const LEAN_RATE = 8;        // 1/s
const LEAN_MAX = 0.3;       // rad
const LEAN_PER_SPEED = 0.0005; // rad per px/s
const MAX_DT = 0.05;        // s
const SPEAK_LEVEL = 0.015, SPEAK_HOLD = 400;
const THINK_MS = 2000, LISTEN_MS = 3000, MUSIC_MS = 45000, CELEBRATE_SPEAK_MS = 600;
const MUSIC_OPS = new Set(['play_music', 'play_video', 'youtube_latest']);
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
    view, dpr = () => globalThis.devicePixelRatio || 1 } = {}) {
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
    this.chatThinking = false;
    this.companion = null;
    this.windows = { fg: 0, wins: [] };
    this.possessWindows = true; // ignored: she doesn't possess windows anymore
    this._speech = 0;

    // geometry
    this.scale = 0.6;
    this.view = view ? { w: view.w, h: view.h } : { w: globalThis.innerWidth || 1280, h: globalThis.innerHeight || 720 };
    this.pos = clampToView({ x: this.view.w * 0.85, y: this.view.h * 0.82 }, this.radius, this.view);
    this.anchor = null;
    this.aimAngle = null; // set by pointing (Task 10)
    this.travel = null;   // { to, rate, fn, teleport }
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
    this.timers = [];
    this.thinkUntil = 0; this.listenUntil = 0; this.speakUntil = 0;
    this.agentThink = new Set();
    this.musicUntil = 0;
    this.last = null;
    this.moved = null;

    this.setScale(this.scale);
    this.bindPointer();
    this.frame = this.frame.bind(this);
    this.schedule(this.frame);
  }

  // ---------- geometry ----------

  get size() { return Math.max(P.minSize, Math.round(P.sizeFromScale * this.scale)); }
  get radius() { return this.size / 2; }

  setScale(scale) {
    this.scale = scale;
    this.renderer?.setSize(this.size, this.dpr());
    if (this.canvas?.style) this.canvas.style.width = this.canvas.style.height = `${this.size}px`;
    this.reclamp();
  }

  setView(w, h) {
    this.view = { w, h };
    this.reclamp();
  }

  // Keeps her (and where she's heading) fully inside the view.
  reclamp() {
    const fit = p => clampToView(p, this.radius, this.view);
    this.pos = fit(this.pos);
    if (this.travel) this.travel.to = fit(this.travel.to);
    if (this.dragTo) this.dragTo = fit(this.dragTo);
    this.place();
  }

  head() { return { x: this.pos.x, y: this.pos.y - this.size * 0.25, top: this.pos.y - this.radius }; }

  towardCenter() { return this.pos.x < this.view.w / 2 ? 1 : -1; }

  hit(x, y) {
    if (this.hidden || (this.fold || 0) > 0.5) return false;
    return Math.hypot(x - this.pos.x, y - this.pos.y) <= 0.45 * this.size;
  }

  spot(name) {
    const r = this.radius, view = this.view;
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
    if (this.mode === mode) return;
    const prev = this.mode;
    this.mode = mode;
    this.onMode?.(mode, prev);
  }

  wake() {
    this.dormant = false;
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

  get busy() { return this.motions.busy(this.now()) || Boolean(this.travel?.fn); }

  get act() {
    const a = this._act;
    return a && this.now() < a.until ? { player: { name: a.name } } : null;
  }

  // ---------- motions ----------

  // Plays a motion; resolves when it ends or is replaced. Nothing plays while she's dragged or dormant.
  play(name) {
    if (!name || !MOTIONS[name] || this.dragging || this.dormant) return resolved();
    const now = this.now();
    if (!this.motions.play(name, now)) return resolved();
    this.endAct(false);
    const def = MOTIONS[name];
    return new Promise(done => { this._act = { name, until: def.hold ? Infinity : now + def.duration, done }; });
  }

  endAct(completed) {
    const a = this._act;
    if (!a) return;
    this._act = null;
    if (a.until === Infinity) this.motions.release(a.name, this.now());
    a.done(completed);
  }

  perform(name, dir = 0) {
    const motion = motionForAct(name) ?? (MOTIONS[name] ? name : null);
    if (!motion) return resolved();
    const done = this.play(motion);
    if (MOTIONS[motion].hold) {
      this.after(1500, () => (this._act?.name === motion ? this.endAct(true) : this.motions.release(motion, this.now())));
    }
    return done;
  }

  reactToAction(name) {
    if (name === 'think') { this.thinkUntil = this.now() + THINK_MS; return; }
    const motion = motionForAct(name) ?? (MOTIONS[name] && !MOTIONS[name].hold ? name : null);
    if (motion) this.play(motion);
  }

  reactToTool(tool) {
    const motion = motionForCodexTool(tool);
    if (motion === 'think') this.thinkUntil = this.now() + THINK_MS;
    else this.play(motion);
  }

  // A tool call from her own agent: { tool, op, phase: 'start' | 'end', ok }.
  agentActivity({ tool, op, phase, ok } = {}) {
    const motion = motionForAgentTool(tool, op), now = this.now();
    if (phase === 'start') {
      if (tool === 'capri_apps') this.releaseMusic();
      if (motion === 'think') this.agentThink.add(tool);
      // trail has no direction input in the scene; the overlay doesn't know where the drawing is anyway.
      else this.play(motion);
      return;
    }
    if (phase !== 'end') return;
    this.agentThink.delete(tool);
    if (MOTIONS[motion]?.hold) {
      this.motions.release(motion, now);
      if (this._act?.name === motion) this._act.until = now;
    }
    if (ok === false) this.play('glitch');
    else if (ok && tool === 'capri_apps' && MUSIC_OPS.has(op)) this.musicUntil = now + MUSIC_MS;
  }

  releaseMusic() {
    this.musicUntil = 0;
    this.motions.release('musicPulse', this.now());
  }

  pulse() { return this.play('pulse'); }
  hurt() { return this.play('glitch'); }
  spark() { this.play('pulse'); return true; }
  zap() { this.play('flare'); return true; }
  gaze() { this.play('pulse'); return true; }
  earnUplink() { this.play('flare'); return true; }

  celebrate({ onSpeak } = {}) {
    this.play('celebrate');
    return new Promise(done => this.after(CELEBRATE_SPEAK_MS, () => { onSpeak?.(); done(); }));
  }

  // ---------- removed pet behaviors: safe no-ops ----------

  sitOn() { return resolved(); }
  possess() { return resolved(); }
  doze() { return resolved(); }
  unpeek() { return resolved(); }
  intro(spot, opts) { return this.materialize ? this.materialize(spot, opts) : resolved(); }
  canSit() { return false; }
  pickSeat() { return null; }
  requestPosture() { return Promise.resolve(bodyResponse('sit').reply); }

  // ---------- pointer ----------

  bindPointer() {
    const root = this.root;
    if (!root?.addEventListener) return;
    root.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !this.pointerDown(e.clientX, e.clientY, e.pointerId)) return;
      try { root.setPointerCapture?.(e.pointerId); } catch {}
    });
    root.addEventListener('pointermove', e => this.pointerMove(e.clientX, e.clientY, e.pointerId));
    root.addEventListener('pointerup', e => { if (e.button === 0) this.pointerUp(e.clientX, e.clientY, e.pointerId); });
    root.addEventListener('pointercancel', () => this.cancelDrag());
    root.addEventListener('lostpointercapture', () => this.cancelDrag());
    root.addEventListener('contextmenu', e => {
      e.preventDefault?.();
      if (this.hit(e.clientX, e.clientY)) this.onMenu?.();
    });
    globalThis.addEventListener?.('blur', () => this.cancelDrag());
  }

  // Returns true when the press landed on her and is now held.
  pointerDown(x, y, id = 0) {
    if (this.down || this.gaming || this.fullscreen || this.travel?.fn || !this.hit(x, y)) return false;
    this.down = { x, y, id, pos: { ...this.pos } };
    this.pointerHeld = true;
    this.onPointerHold?.();
    return true;
  }

  pointerMove(x, y, id = 0) {
    const d = this.down;
    if (!d || id !== d.id) return;
    if (!this.dragging) {
      if (Math.hypot(x - d.x, y - d.y) <= DRAG_THRESHOLD) return;
      this.dragging = true;
      this.wake();
      this.endAct(false);
      this.endTravel();
      this.onTeleport?.('start');
    }
    this.dragTo = this.dropPoint(x, y);
  }

  pointerUp(x, y, id = 0) {
    if (!this.down || id !== this.down.id) return;
    this.release(false, x, y);
  }

  cancelDrag() { this.release(true); }

  dropPoint(x, y) {
    const d = this.down;
    return clampToView({ x: d.pos.x + x - d.x, y: d.pos.y + y - d.y }, this.radius, this.view);
  }

  release(cancelled, x, y) {
    const d = this.down;
    if (!d) return;
    const to = Number.isFinite(x) && Number.isFinite(y) ? this.dropPoint(x, y) : this.dragTo;
    const wasDragging = this.dragging;
    this.down = null;
    this.dragTo = null;
    this.pointerHeld = false;
    this.dragging = false;
    try { if (this.root?.hasPointerCapture?.(d.id)) this.root.releasePointerCapture(d.id); } catch {}
    if (wasDragging) {
      const drop = to || { ...this.pos };
      this.travel = { to: { ...drop }, rate: FOLLOW_RATE, fn: false, teleport: true };
      this.anchor = { ...drop };
      this.saveAnchor({ ...drop });
      this.nextMove = this.now() + restDuration(this.random); // the wander timer restarts from the drop
    } else if (!cancelled) {
      this.onClick?.();
    }
    this.onPointerHold?.();
  }

  // Stops any travel where she is; that spot becomes her anchor.
  endTravel() {
    const t = this.travel;
    if (!t) return;
    this.travel = null;
    this.anchor = { ...this.pos };
    if (t.teleport) this.onTeleport?.('end');
  }

  // ---------- loop ----------

  after(ms, fn) { this.timers.push({ at: this.now() + ms, fn }); }

  blendMode(now) {
    if (now < this.speakUntil) return 'speak';
    if (this.mode === 'alert' || now < this.listenUntil) return 'listen';
    if (this.mode === 'work' || this.chatThinking || now < this.thinkUntil || this.agentThink.size) return 'think';
    if (this.mode === 'sleep') return 'rest';
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
    if (this._act && now >= this._act.until) this.endAct(true);
    this.stepMusic(now);
    this.stepPosition(dt, reduced);

    const mode = this.blendMode(now);
    this.blend.setMode(mode);
    this.blend.step(dt);
    const allowed = mode === 'idle' && this.mode === 'idle' && !this.dragging && !this.travel?.fn && !reduced
      && this.companion?.options?.idleAnimations !== false;
    const idle = this.idle.update(now, { allowed });
    const motions = this.motions.update(now);
    const aim = this.aimAngle;
    this.clock.step(dt, this.blend, idle, motions, { reduced, aim });

    const paused = this.hidden || (this.fold || 0) >= 1 || globalThis.document?.hidden;
    if (!paused && this.renderer && !this.renderer.lost) {
      const t = now / 1000;
      const scene = buildScene({ s: this.size, t, clock: this.clock, blend: this.blend, idle, motions, aim, reduced,
        fold: this.fold || 0 });
      try { this.renderer.draw(scene, t); } catch (error) { console.error?.('Stella: draw failed', error); }
    }
    this.place();
  }

  stepMusic(now) {
    if (!this.musicUntil) return;
    if (now >= this.musicUntil) { this.releaseMusic(); return; }
    const on = this.motions.list.some(a => a.name === 'musicPulse' && a.killedAt == null && a.releasedAt == null);
    if (!on && !this.dragging && !this.dormant) this.motions.play('musicPulse', now);
  }

  stepPosition(dt, reduced) {
    const prev = { ...this.pos };
    if (this.dragging && this.dragTo) {
      this.pos = { x: damp(this.pos.x, this.dragTo.x, FOLLOW_RATE, dt), y: damp(this.pos.y, this.dragTo.y, FOLLOW_RATE, dt) };
    } else if (this.travel && reduced) {
      this.endTravel(); // reduced motion: she stops where she is, no snap
    } else if (this.travel) {
      const { to, rate } = this.travel;
      this.pos = { x: damp(this.pos.x, to.x, rate, dt), y: damp(this.pos.y, to.y, rate, dt) };
      if (Math.hypot(to.x - this.pos.x, to.y - this.pos.y) < 0.5) {
        this.pos = { ...to };
        const t = this.travel;
        this.travel = null;
        if (t.teleport) this.onTeleport?.('end');
      }
    }
    // Her points lean against the drag's motion.
    const vx = dt > 0 ? (this.pos.x - prev.x) / dt : 0;
    const target = this.dragging && !reduced ? clamp(-vx * LEAN_PER_SPEED, -LEAN_MAX, LEAN_MAX) : 0;
    this.lean = damp(this.lean, target, LEAN_RATE, dt);
  }

  // Positions the canvas on screen and reports her head when she moved.
  place() {
    const half = this.size / 2;
    if (this.root?.style) {
      this.root.style.transform = `translate3d(${(this.pos.x - half).toFixed(1)}px, ${(this.pos.y - half).toFixed(1)}px, 0)`;
    }
    if (this.canvas?.style) this.canvas.style.transform = `rotate(${this.lean.toFixed(4)}rad)`;
    const m = this.moved;
    if (!m || m.x !== this.pos.x || m.y !== this.pos.y || m.size !== this.size) {
      this.moved = { x: this.pos.x, y: this.pos.y, size: this.size };
      this.onMove?.(this.head());
    }
  }
}

// Stella: the overlay controller. Owns her state blend, idle variations, motions,
// drag and functions (pointing, walkthrough focus, body actions), and drives the
// renderer once per frame; where she goes lives in travel.js. It exposes the same
// surface the rest of the renderer used on the old sprite character, so callers
// keep calling `capri.*` unchanged. No DOM access at import time.
import { clamp, damp } from './math.js';
import { P } from './params.js';
import { StateBlend } from './blend.js';
import { IdleScheduler } from './idle.js';
import { besideTarget, clampToView, edgeToward, inBand, pickWanderTarget, restDuration } from './wander.js';
import { MOTIONS, MotionMixer, motionForAct, motionForAgentTool, motionForCodexTool, bodyResponse } from './motions.js';
import { SceneClock, buildScene } from './scene.js';
import { StellaRenderer } from './renderer.js';
import { BOB, Traveler, approachCenter, nearestBandPoint } from './travel.js';

const DRAG_THRESHOLD = 5;   // px before a press becomes a drag
const FOLLOW_RATE = 14;     // 1/s: how tightly she follows the pointer
const LEAN_RATE = 8;        // 1/s
const LEAN_MAX = 0.3;       // rad
const LEAN_PER_SPEED = 0.0005; // rad per px/s
const MAX_DT = 0.05;        // s
const SPEAK_LEVEL = 0.015, SPEAK_HOLD = 400;
const THINK_MS = 2000, LISTEN_MS = 3000, MUSIC_MS = 45000, CELEBRATE_SPEAK_MS = 600, AGENT_THINK_MS = 60000;
const AIM_TURN = 2;         // rad/s: fastest her aim swings to a new target
const RETURN_MS = 1500;     // after pointing, before she heads back
const NUDGE = 120;          // px: how far a reminder or approval brings her toward the middle
const REMIND_STAY = 10000;  // ms near the middle after a reminder
const DIRECTIONS = { left: Math.PI, right: 0, up: -Math.PI / 2, down: Math.PI / 2 };
const MUSIC_OPS = new Set(['play_music', 'play_video', 'youtube_latest']);
const resolved = () => Promise.resolve();
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const isPoint = p => Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
const toRect = t => (isPoint(t) ? { x: t.x, y: t.y, w: Number.isFinite(t.w) ? t.w : 1, h: Number.isFinite(t.h) ? t.h : 1 } : null);
// A mixer entry still playing (not killed, not released, not over).
const live = (a, now) => Boolean(a) && a.killedAt == null && (a.hold ? a.releasedAt == null : now - a.start < a.duration);
const letGo = (a, now) => { if (a?.hold && a.releasedAt == null && a.killedAt == null) a.releasedAt = now; };

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
    this.moved = null;

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

  setView(w, h) {
    this.view = { w, h };
    this.reclamp();
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

  hit(x, y) {
    if (this.hidden || (this.fold || 0) > 0.5) return false;
    return Math.hypot(x - this.pos.x, y - this.pos.y) <= 0.45 * this.size;
  }

  spot(name) {
    const r = this.bandRadius, view = this.view;
    if (name === 'post') {
      const p = clampToView({ x: view.w * 0.85, y: view.h * 0.82 }, r, view);
      return inBand(p, r, view) ? p : pickWanderTarget({ from: p, radius: r, view, random: this.random });
    }
    return pickWanderTarget({ from: this.pos, radius: r, view, random: this.random });
  }

  setWindows(data) { this.windows = data; }

  // ---------- travel and functions ----------

  // Glides to `point` along a gentle curve. Resolves true on arrival, false if something replaced it.
  glideTo(point, { reason = 'glide' } = {}) {
    if (!isPoint(point)) return Promise.resolve(false);
    return this.traveler.go(point, { reason, fn: true });
  }

  teleport(spot) { return this.glideTo(spot, { reason: 'teleport' }); }

  goHome() { return this.down ? resolved() : this.traveler.goHome(); }

  canPoint(win) {
    const r = toRect(win);
    return Boolean(r && r.w > 0 && r.h > 0 && r.x < this.view.w && r.x + r.w > 0 && r.y < this.view.h && r.y + r.h > 0);
  }

  // Glides beside `target` (a window rect or a point) and aims a blade at its center until
  // stopPointing() or the next focus. Resolves true when she's there and still pointing at it.
  pointAt(target, { label = '' } = {}) {
    const rect = toRect(target);
    if (!rect) return Promise.resolve(false);
    this.homeToken++;
    const at = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    const focus = this.focus = { at };
    this.pointing = { dir: at.x < this.pos.x ? -1 : 1, rect, label };
    const to = besideTarget({ target: rect, radius: this.bandRadius, view: this.view, from: this.pos });
    return this.traveler.go(to, { reason: 'point', fn: true }).then(() => this.focus === focus);
  }

  // Done showing: the blade lets go, and after a moment she heads back to her anchor area.
  stopPointing() {
    if (!this.focus && !this.pointing) return;
    this.focus = this.pointing = null;
    const token = ++this.homeToken;
    this.after(RETURN_MS, () => { if (token === this.homeToken && !this.approvalOn) this.goHome(); });
  }

  // Walkthrough step: { rect } → beside it, aiming; { direction } → the edge of her display that
  // way, aiming out; null → let go and go back to her anchor area.
  guideFocus(focus) {
    if (focus?.rect) return this.pointAt(focus.rect, { label: focus.label });
    const angle = DIRECTIONS[focus?.direction];
    this.homeToken++;
    if (angle === undefined) {
      this.focus = this.pointing = null;
      return this.goHome();
    }
    const f = this.focus = { angle };
    this.pointing = { dir: Math.round(Math.cos(angle)) };
    const to = edgeToward({ direction: focus.direction, radius: this.bandRadius, view: this.view, from: this.pos });
    return this.traveler.go(to, { reason: 'guide', fn: true }).then(() => this.focus === f);
  }

  // Toward the cursor, stopping at the edge of the center zone; without one, toward the middle.
  summon(cursor) {
    if (!isPoint(cursor)) return this.approach(Infinity, 'come');
    this.homeToken++;
    const r = this.bandRadius;
    const near = besideTarget({ target: { x: cursor.x, y: cursor.y, w: 1, h: 1 }, radius: r, view: this.view, from: this.pos });
    return this.traveler.go(nearestBandPoint(near, r, this.view), { reason: 'come', fn: true });
  }

  approach(maxDist, reason) {
    this.homeToken++;
    return this.traveler.go(approachCenter(this.pos, maxDist, this.bandRadius, this.view), { reason, fn: true });
  }

  // A reminder is due: three bright rings, a small drift toward the middle, then back.
  remind() {
    this.play('chime');
    const arrive = this.approach(NUDGE, 'remind');
    const token = this.homeToken;
    this.after(REMIND_STAY, () => { if (token === this.homeToken && !this.focus && !this.approvalOn) this.goHome(); });
    return arrive;
  }

  // Waiting on an approval: the ring holds and she comes a little closer, until answered.
  approval(on) {
    on = Boolean(on);
    if (on === this.approvalOn) return resolved();
    this.approvalOn = on;
    if (on) return this.approach(NUDGE, 'approval');
    if (this.focus) return resolved();
    this.homeToken++;
    return this.goHome();
  }

  // The capri_body tool. `come` goes to `cursor` when given, else toward the middle.
  async bodyAction(action, { cursor } = {}) {
    const r = bodyResponse(action);
    if (r.wake) this.wake();
    if (r.rest) this.resting = true;
    if (r.motion) this.play(r.motion);
    if (r.come) await this.summon(cursor);
    return r.reply ?? 'done';
  }

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

  // ---------- motions ----------

  // Starts a motion as her current act; null when it can't play. Nothing plays while she's dragged or dormant.
  start(name) {
    if (!name || !MOTIONS[name] || this.dragging || this.dormant) return null;
    const now = this.now();
    if (!this.motions.play(name, now)) return null;
    const entry = this.motions.list[this.motions.list.length - 1];
    this.endAct(false);
    const def = MOTIONS[name];
    const act = { name, entry, until: def.hold ? Infinity : now + def.duration };
    act.promise = new Promise(done => { act.done = done; });
    this._act = act;
    return act;
  }

  // Plays a motion; resolves when it ends or is replaced.
  play(name) { return this.start(name)?.promise ?? resolved(); }

  endAct(completed) {
    const a = this._act;
    if (!a) return;
    this._act = null;
    letGo(a.entry, this.now());
    a.done(completed);
  }

  // A held motion started here lets go after 1.5 s; one this call didn't start is left alone.
  perform(name, dir = 0) {
    const motion = motionForAct(name) ?? (MOTIONS[name] ? name : null);
    const act = motion && this.start(motion);
    if (!act) return resolved();
    if (MOTIONS[motion].hold) this.after(1500, () => { if (this._act === act) this.endAct(true); });
    return act.promise;
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
      if (motion === 'think') { this.agentThink.set(tool, now); return; }
      // trail has no direction input in the scene; the overlay doesn't know where the drawing is anyway.
      const act = this.start(motion);
      if (act && MOTIONS[motion].hold) this.agentHolds.set(tool, act);
      return;
    }
    if (phase !== 'end') return;
    this.agentThink.delete(tool);
    const act = this.agentHolds.get(tool);
    if (act) {
      this.agentHolds.delete(tool);
      letGo(act.entry, now);
      if (this._act === act) act.until = now;
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
      this.traveler.stop(false, true); // the drag takes over any travel; onTeleport stays open
      this.traveler.report(true);
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
      this.anchor = { ...drop };
      this.saveAnchor({ ...drop });
      if (this.reduced()) { this.pos = { ...drop }; this.traveler.stop(true); } // she followed 1:1: nothing to settle
      else this.traveler.settle(drop);
      this.nextMove = this.now() + restDuration(this.random); // the wander timer restarts from the drop
    } else if (!cancelled) {
      this.resting = false; // a click ends a nap
      this.onClick?.();
    }
    this.onPointerHold?.();
  }

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
    this.stepMusic(now);
    this.stepHolds(now);
    this.stepPosition(dt, reduced);

    const mode = this.blendMode(now);
    this.blend.setMode(mode);
    this.blend.step(dt);
    const calm = mode === 'idle' && this.mode === 'idle' && !this.dragging && !this.travel?.fn && !reduced;
    this.traveler.wander(now, calm && this.wander && !this.down && !this.focus && !this.approvalOn && !this.chatThinking
      && !this.hidden && !this.dormant && !this.fullscreen && !this.gaming && !this.fold);
    const idle = this.idle.update(now, { allowed: calm && this.companion?.options?.idleAnimations !== false });
    const motions = this.motions.update(now);
    this.stepAim(dt, motions);
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

  // Keeps her function holds up (approval first: it matters more than the blade) and lets them go when done.
  stepHolds(now) {
    for (const [name, want] of [['approval', this.approvalOn], ['aim', Boolean(this.focus)]]) {
      const mine = this.holds[name];
      if (!want) { letGo(mine, now); this.holds[name] = null; continue; }
      if (live(mine, now) || this.dragging || this.dormant) continue;
      if (this.motions.list.some(a => live(a, now) && a.priority >= MOTIONS[name].priority)) continue;
      if (this.motions.play(name, now)) this.holds[name] = this.motions.list[this.motions.list.length - 1];
    }
  }

  // The aimed angle follows the focus from where she is, swinging at most AIM_TURN rad/s.
  stepAim(dt, motions) {
    const f = this.focus;
    if (!f) { if (!(motions.aim > 0)) this.aimAngle = null; return; }
    const want = f.at ? Math.atan2(f.at.y - this.pos.y, f.at.x - this.pos.x) : f.angle;
    if (this.aimAngle == null) this.aimAngle = want;
    else this.aimAngle = wrap(this.aimAngle + clamp(wrap(want - this.aimAngle), -AIM_TURN * dt, AIM_TURN * dt));
    if (f.at && this.pointing) this.pointing.dir = f.at.x < this.pos.x ? -1 : 1;
  }

  stepPosition(dt, reduced) {
    const prev = { ...this.pos };
    if (this.dragging && this.dragTo) {
      this.pos = reduced ? { ...this.dragTo } // reduced motion: 1:1 with the pointer
        : { x: damp(this.pos.x, this.dragTo.x, FOLLOW_RATE, dt), y: damp(this.pos.y, this.dragTo.y, FOLLOW_RATE, dt) };
    }
    this.traveler.step(dt, reduced);
    // Her points lean against the drag's motion.
    const vx = dt > 0 ? (this.pos.x - prev.x) / dt : 0;
    const target = this.dragging && !reduced ? clamp(-vx * LEAN_PER_SPEED, -LEAN_MAX, LEAN_MAX) : 0;
    this.lean = damp(this.lean, target, LEAN_RATE, dt);
  }

  // Positions the canvas on screen (with the resting bob, kept inside the view) and reports her head when she moved.
  place() {
    const half = this.size / 2;
    const y = clamp(this.pos.y + this.traveler.bob, half, Math.max(half, this.view.h - half));
    if (this.root?.style) {
      this.root.style.transform = `translate3d(${(this.pos.x - half).toFixed(1)}px, ${(y - half).toFixed(1)}px, 0)`;
    }
    if (this.canvas?.style) this.canvas.style.transform = `rotate(${this.lean.toFixed(4)}rad)`;
    const m = this.moved;
    if (!m || m.x !== this.pos.x || m.y !== this.pos.y || m.size !== this.size) {
      this.moved = { x: this.pos.x, y: this.pos.y, size: this.size };
      this.onMove?.(this.head());
    }
  }
}

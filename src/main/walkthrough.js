'use strict';
const { validateWalkthrough } = require('./guide-schema');
const { DISPLAY_NAME } = require('./identity');

// Runs a validated walkthrough plan locally, one step at a time. Pure logic: targets, drawing, speech,
// pointer, foreground window, re-planning and timers are all injected, so every rule is testable with fakes.
//
//   resolving --found--> waiting --click in ring / next--> resolving (after SETTLE_MS) ... --> ended('done')
//   resolving --not found for RESOLVE_TIMEOUT_MS--> replanning --plan--> resolving | --null/invalid--> ended('lost')
//   waiting/resolving --click elsewhere / another app / question()--> paused
//   paused --continue / next / the card's Continue / resume() / expected window back--> resolving (the paused card says so);  paused > PAUSE_LIMIT_MS --> ended('paused-too-long')
//   any --stop--> ended('stopped')
//
// The pointer is read only while waiting on a click step. Its coordinates are never stored: each tick keeps only
// which zone ('ring' | 'card' | 'elsewhere') a press started in.
const POLL_MS = 33;
const RING_MARGIN = 8;
const SETTLE_MS = 400;
const RESOLVE_TIMEOUT_MS = 3000;
const RESOLVE_RETRY_MS = 500;
const MAX_REPLANS = 2;
const PAUSE_LIMIT_MS = 60000;
const NEW_WINDOW_GRACE_MS = 2000;
const WATCH_MS = 250; // foreground check cadence when not polling the pointer
const CLOSING = new Set(['done', 'lost', 'paused-too-long']);

const within = (p, b, m = 0) => Boolean(b) && Number.isFinite(p.x) && Number.isFinite(p.y)
  && p.x >= b.x - m && p.x <= b.x + b.width + m && p.y >= b.y - m && p.y <= b.y + b.height + m;
const validBox = b => Boolean(b) && typeof b === 'object' && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(b[k]))
  && b.width >= 0 && b.height >= 0;
const appKey = s => (typeof s === 'string' ? s.trim().toLowerCase().replace(/\.exe$/, '') : '');
const log = () => console.error('[capri] A walkthrough callback failed.');

class Walkthrough {
  // render(marks, card, { window }) draws the step (returns { cardBounds } or a promise of it); render([], null) clears.
  // request is what replan receives as the original request; it defaults to the plan's title.
  // appName(window) gives a foreground window's process name for expectApp; by default window.app.
  constructor({ plan, targets, render, speak, pointer, foreground, replan = async () => null, lines = () => '',
    now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, onEnd = () => {}, name = DISPLAY_NAME,
    request, ownPid = process.pid, appName = w => w?.app ?? null }) {
    const valid = validateWalkthrough(plan);
    this.deps = { targets, render, speak, pointer, foreground, replan, lines, now, setTimer, clearTimer, onEnd, appName };
    this.name = name;
    this.ownPid = ownPid;
    this.title = valid.title;
    this.request = typeof request === 'string' && request.trim() ? request : valid.title;
    this.steps = valid.steps;
    this.index = 0;
    this.state = 'resolving';
    this.started = false;
    this.replans = 0;
    this.generation = 0;
    this.stepTimer = null;
    this.watchTimer = null;
    this.settling = false;
    this.resolveSince = 0;
    this.ring = null;       // the target's bounds, native px
    this.cardBox = null;    // the guide card's bounds, native px
    this.base = null;       // { id, pid, app } of the window the step lives in
    this.expectApp = null;  // the app the last completed step said comes next
    this.clickedAt = -Infinity;
    this.pressed = null;    // null (unread) | 'idle' | 'before' | 'ring' | 'card' | 'elsewhere'
    this.pauseCause = null;
    this.pausedAt = 0;
    this.drawSeq = 0;       // render calls issued
    this.paintedSeq = 0;    // newest render call that has finished
    this.drawing = null;    // the latest { marks, card, extra } asked for (target bounds only, never the pointer)
  }

  get step() { return this.steps[this.index]; }

  start() {
    if (this.started || this.state === 'ended') return;
    this.started = true;
    this.go(0, false);
  }

  command(cmd) {
    if (this.state === 'ended') return;
    switch (cmd) {
      case 'stop': this.finish('stopped'); break;
      case 'continue': this.resume(); break;
      case 'repeat': if (this.state === 'waiting' || this.state === 'paused') this.say(this.step.say); break;
      // While paused, Next resumes the current step instead of skipping it (the user may not have done it yet).
      case 'next': if (this.state === 'paused') this.resume(); else if (this.state !== 'replanning' && !this.settling) this.advance(); break;
      case 'back': if (this.state !== 'replanning') this.go(Math.max(0, this.index - 1), false); break;
      default: break;
    }
  }

  cardAction(id) { if (id === 'next' || id === 'stop' || id === 'continue') this.command(id); }

  question() { this.pause('question'); }

  resume() { if (this.state === 'paused') this.go(this.index, false); }

  // --- transitions ---

  go(index, settle) {
    this.generation += 1;
    const gen = this.generation;
    this.stop(this.stepTimer); this.stepTimer = null;
    Object.assign(this, { index, state: 'resolving', ring: null, pressed: null, pauseCause: null, settling: settle });
    // The previous ring comes down at once; the card already shows this step's line while its target is found.
    this.draw([], this.cardSpec()).then(box => { if (gen === this.generation) this.cardBox = box; });
    const begin = () => { this.settling = false; this.resolveSince = this.deps.now(); this.attempt(gen); };
    if (settle) this.stepTimer = this.deps.setTimer(() => { this.stepTimer = null; if (gen === this.generation) begin(); }, SETTLE_MS);
    else begin();
    this.watch();
  }

  async attempt(gen) {
    const ctx = { check: () => { if (gen !== this.generation) throw Error('The walkthrough step changed.'); } };
    let found;
    try { found = await this.deps.targets.resolve(this.step.target, ctx); } catch { found = { ok: false }; }
    if (gen !== this.generation) return;
    if (found?.ok && validBox(found.bounds)) return this.show(found, gen); // no usable bounds counts as not found
    if (this.deps.now() - this.resolveSince >= RESOLVE_TIMEOUT_MS) return this.lost();
    this.stepTimer = this.deps.setTimer(() => { this.stepTimer = null; if (gen === this.generation) this.attempt(gen); }, RESOLVE_RETRY_MS);
  }

  async show(found, gen) {
    const bounds = { ...found.bounds };
    const marks = [
      { id: 'walk-ring', kind: 'ring', bounds },
      { id: 'walk-number', kind: 'number', bounds, text: String(this.index + 1) },
    ];
    const cardBox = await this.draw(marks, this.cardSpec(), { window: found.window });
    if (gen !== this.generation) return;
    // The step lives in the target's window when resolve says which; otherwise in whatever is in front now.
    const win = found.window && found.window.id !== undefined && Number.isFinite(found.window.pid) ? found.window : this.foregroundWindow();
    if (win && !this.own(win)) this.base = this.identify(win);
    Object.assign(this, { ring: bounds, cardBox, state: 'waiting', pressed: null });
    this.say(this.step.say);
    this.watch();
  }

  advance() {
    const done = this.step;
    this.expectApp = done.expectApp || null;
    if (this.index + 1 >= this.steps.length) this.finish('done');
    else this.go(this.index + 1, true);
  }

  pause(cause) {
    if (this.state !== 'waiting' && this.state !== 'resolving') return;
    this.generation += 1;
    this.stop(this.stepTimer); this.stepTimer = null;
    Object.assign(this, { state: 'paused', pauseCause: cause, pausedAt: this.deps.now(), ring: null, pressed: null, settling: false });
    this.draw([], this.cardSpec()).then(box => { if (this.state === 'paused') this.cardBox = box; });
    this.watch();
  }

  async lost() {
    if (this.replans >= MAX_REPLANS) return this.finish('lost');
    this.replans += 1;
    this.generation += 1;
    const gen = this.generation;
    this.state = 'replanning';
    this.stop(this.watchTimer); this.watchTimer = null;
    this.draw([], this.cardSpec()); // never a ring while she doesn't know where the control is
    const done = this.steps.slice(0, this.index);
    let plan = null;
    try { plan = validateWalkthrough(await this.deps.replan({ request: this.request, done, missing: this.step.target })); } catch { plan = null; }
    if (gen !== this.generation || this.state === 'ended') return;
    if (!plan) return this.finish('lost');
    this.steps = done.concat(plan.steps);
    this.go(this.index, false);
  }

  finish(reason) {
    if (this.state === 'ended') return;
    this.generation += 1;
    this.stop(this.stepTimer); this.stop(this.watchTimer);
    Object.assign(this, { state: 'ended', stepTimer: null, watchTimer: null, settling: false, ring: null, cardBox: null,
      base: null, pressed: null, pauseCause: null });
    this.draw([], null);
    if (CLOSING.has(reason)) {
      let line = '';
      try { line = this.deps.lines(reason, { name: this.name }); } catch { log(); }
      if (line) this.say(line);
    }
    try { this.deps.onEnd({ reason }); } catch { log(); }
  }

  // --- the watch tick: foreground always, the pointer only while waiting on a click step ---

  watch() {
    this.stop(this.watchTimer); this.watchTimer = null;
    if (!['resolving', 'waiting', 'paused'].includes(this.state)) return;
    const ms = this.polling() ? POLL_MS : WATCH_MS;
    this.watchTimer = this.deps.setTimer(() => { this.watchTimer = null; this.tick(); }, ms);
  }

  polling() { return this.state === 'waiting' && this.step?.action === 'click'; }

  tick() {
    if (this.state === 'paused') this.tickPaused();
    else if (this.state === 'waiting' || this.state === 'resolving') {
      this.checkWindow();
      if (this.polling()) this.poll();
    }
    if (this.state !== 'ended' && this.state !== 'replanning' && !this.watchTimer) this.watch();
  }

  tickPaused() {
    if (this.pauseCause !== 'question' && this.deps.now() - this.pausedAt >= PAUSE_LIMIT_MS) return this.finish('paused-too-long');
    const fg = this.foregroundWindow();
    if (!fg || this.own(fg)) return;
    const back = this.base ? fg.id === this.base.id || fg.pid === this.base.pid || this.expectedApp(fg) : false;
    if (this.pauseCause === 'click' && !back) this.pauseCause = 'window'; // the stray click went to another app
    else if (this.pauseCause === 'window' && back) this.resume();
  }

  checkWindow() {
    const fg = this.foregroundWindow();
    if (!fg || this.own(fg)) return; // her own windows are like the guide card
    if (this.base && fg.id === this.base.id) return;
    const expected = !this.base || fg.pid === this.base.pid || this.expectedApp(fg)
      || this.deps.now() - this.clickedAt <= NEW_WINDOW_GRACE_MS;
    if (expected) this.base = this.identify(fg);
    else this.pause('window');
  }

  poll() {
    let p;
    try { p = this.deps.pointer(); } catch { return; }
    const down = Boolean(p?.down);
    if (this.pressed === null) { this.pressed = down ? 'before' : 'idle'; return; }
    if (down && this.pressed === 'idle') { this.pressed = this.zone(p); return; }
    if (down || this.pressed === 'idle') return;
    const from = this.pressed, to = this.zone(p);
    this.pressed = 'idle';
    if (from === 'before') return; // held down before the step began
    if (from === 'ring' && to === 'ring') { this.clickedAt = this.deps.now(); return this.advance(); }
    if (from === 'card' || to === 'card') return; // the card's buttons report through cardAction
    const fg = this.foregroundWindow();
    if (fg && this.own(fg)) return; // a click into her chat panel or overlay
    this.pause('click');
  }

  zone(p) {
    if (p && within(p, this.cardBox)) return 'card';
    if (p && within(p, this.ring, RING_MARGIN)) return 'ring';
    return 'elsewhere';
  }

  // --- helpers ---

  expectedApp(w) {
    const app = appKey(this.safeAppName(w));
    return Boolean(app) && [this.expectApp, this.step?.expectApp].some(e => appKey(e) === app);
  }

  safeAppName(w) { try { return this.deps.appName(w); } catch { return null; } }
  identify(w) { return { id: w.id, pid: w.pid, app: this.safeAppName(w) }; }
  own(w) { return w.pid === this.ownPid; }
  foregroundWindow() { try { return this.deps.foreground() || null; } catch { return null; } }
  stop(timer) { if (timer !== null && timer !== undefined) this.deps.clearTimer(timer); }

  // Paused: a short localized line says so, above the step, with Continue instead of Next.
  cardSpec() {
    if (this.state === 'paused') {
      let paused = '';
      try { paused = this.deps.lines('paused', { name: this.name }) || ''; } catch { log(); }
      return { kind: 'note', title: this.title, text: paused ? `${paused} ${this.step.say}` : this.step.say,
        buttons: [{ id: 'continue' }, { id: 'stop' }] };
    }
    return { kind: 'steps', title: this.title, items: [this.step.say], buttons: [{ id: 'next' }, { id: 'stop' }] };
  }

  // Resolves to the card's bounds (or null). Rendering failures are logged, never thrown into timers.
  // Every call records the latest drawing. If an older render finishes after a newer one (a step's ring landing
  // after next/back/pause moved on), the latest drawing is painted again, so a stale ring never stays on screen.
  draw(marks, card, extra) {
    this.drawSeq += 1;
    this.drawing = { marks, card, extra };
    return this.paint(this.drawSeq, marks, card, extra);
  }

  async paint(seq, marks, card, extra) {
    let box = null;
    try {
      const out = await this.deps.render(marks, card, extra);
      box = validBox(out?.cardBounds) ? { ...out.cardBounds } : null;
    } catch { console.error('[capri] Could not update the walkthrough guide.'); return null; }
    if (seq < this.paintedSeq) {
      const latest = this.drawing;
      this.draw(latest.marks, latest.card, latest.extra).then(b => {
        if (this.drawing === latest && this.state !== 'ended' && latest.card) this.cardBox = b;
      });
    } else this.paintedSeq = seq;
    return box;
  }

  say(text) {
    try {
      const out = this.deps.speak(text, { purpose: 'guide' });
      if (out && typeof out.then === 'function') out.then(undefined, log);
    } catch { log(); }
  }
}

module.exports = {
  Walkthrough, POLL_MS, RING_MARGIN, SETTLE_MS, RESOLVE_TIMEOUT_MS, RESOLVE_RETRY_MS, MAX_REPLANS, PAUSE_LIMIT_MS,
  NEW_WINDOW_GRACE_MS, WATCH_MS,
};

'use strict';
const { validateDraw } = require('./guide-schema');
const { DISPLAY_NAME } = require('./identity');

// One drawing at a time, owned by the window it annotates. Pure apart from the injected
// targets, layer, layout, foreground and timers, so lifetime rules are testable with fakes.
const CHECK_MS = 250;
const STILL_MS = 500;
const IDLE_MS = 120000;

const rect = w => ({ x: w.x, y: w.y, width: w.width, height: w.height });
const sameRect = (a, b) => ['x', 'y', 'width', 'height'].every(k => a[k] === b[k]);
const shift = (b, dx, dy) => ({ ...b, x: b.x + dx, y: b.y + dy });

// Where a laid-out drawing is, for Stella to aim at: its first mark (else its first card) as { displayId, rect } in
// absolute DIP, or null. `laid` is layout()'s Map of displayId -> { marks, cards } with display-relative boxes.
function layoutTarget(laid, displays) {
  for (const kind of ['marks', 'cards']) {
    for (const [id, s] of laid || []) {
      const display = displays.find(d => d.id === id), b = s?.[kind]?.[0]?.box;
      if (display && b) return { displayId: id, rect: { x: b.x + display.bounds.x, y: b.y + display.bounds.y, width: b.width, height: b.height } };
    }
  }
  return null;
}

// capri_draw's schema requires every field, so the tool uses empty values for "none":
// to [] (or one target for an arrow), nth 0. Empty id/text/title are already treated as absent by validateDraw.
function fromTool(args) {
  if (!args || typeof args !== 'object' || !Array.isArray(args.marks)) return args;
  const target = t => {
    if (!t || typeof t !== 'object' || Array.isArray(t) || t.nth !== 0) return t;
    const { nth, ...rest } = t; return rest;
  };
  const marks = args.marks.map(m => {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return m;
    const out = { ...m, target: target(m.target) };
    if (Array.isArray(m.to)) {
      if (!m.to.length) delete out.to;
      else out.to = m.to.length === 1 ? target(m.to[0]) : m.to;
    } else if (m.to !== undefined) out.to = target(m.to);
    return out;
  });
  return { ...args, marks };
}

class GuideSession {
  constructor({ targets, layer, layout, foreground, now = Date.now, setInterval: every = setInterval,
    clearInterval: stopEvery = clearInterval, allowed = () => true, keep = allowed, ownPid = process.pid, yieldFocus = async () => {}, gate = null,
    onDrawn = null }) {
    // foreground is the raw foreground window; windows of ownPid (her overlay, chat panel, guide layer) never own a drawing.
    // allowed(): a new drawing may start. keep(): a drawing already shown may stay. They differ in Gaming mode: a drawing
    // the user asked for by voice outlives that voice session (Gaming mode turning on clears it explicitly in main).
    // onDrawn(laid): after each capri_draw that shows something, with the laid-out scene (see layoutTarget).
    Object.assign(this, { targets, layer, layout, foreground, now, every, stopEvery, allowed, keep, ownPid, yieldFocus, gate, onDrawn });
    this.marks = new Map(); // id -> { id, kind, target, to?, text?, bounds, toBounds? }
    this.cards = [];
    this.window = null;     // the annotated window, native px, as last seen
    this.timer = null;
    this.hidden = false;
    this.stillSince = 0;
    this.lastActivity = 0;
    this.generation = 0;
    this.queue = Promise.resolve();
  }

  own(w) { return Boolean(w && w.pid === this.ownPid); }

  get active() { return Boolean(this.window && (this.marks.size || this.cards.length)); }

  // Codex calls capri_draw one at a time per turn, but serialize anyway so drawings never interleave.
  draw(args, ctx = {}) {
    const run = this.queue.then(() => this.drawNow(args, ctx));
    this.queue = run.catch(() => {});
    return run;
  }

  async drawNow(args, ctx) {
    ctx.check?.();
    if (!this.allowed()) throw Error(`Screen awareness is off or paused, so ${DISPLAY_NAME} can’t draw on screen.`);
    this.gate?.check(); // exclusive fullscreen: nothing can appear over it
    const drawing = validateDraw(fromTool(args));
    const wanted = new Map(drawing.marks.map(m => [m.id, m])); // a repeated id: the later mark wins
    if (drawing.clear) this.clear('redraw');
    let win = this.foreground();
    if (!win || this.own(win)) {
      // Typed in her chat panel: step aside once so the window behind it is in front again.
      await this.yieldFocus();
      ctx.check?.();
      win = this.foreground();
    }
    if (!win || this.own(win)) throw Error('There is no foreground window to explain.');
    if (this.window && this.window.id !== win.id) this.clear('new-window');
    const generation = this.generation;
    const failed = [], placed = [];
    for (const mark of wanted.values()) {
      const found = await this.place(mark, ctx);
      if (found.ok) placed.push(found.mark); else failed.push({ id: mark.id, reason: found.reason });
    }
    ctx.check?.();
    if (generation !== this.generation) throw Error('The drawing was cleared before it finished.');
    this.generation += 1; // supersedes an in-flight re-placement after a move
    for (const { id } of failed) this.marks.delete(id);
    for (const mark of placed) this.marks.set(mark.id, mark); // a replaced id keeps its place in the order
    if (drawing.cards.length) this.cards = drawing.cards;
    const drawn = placed.length + drawing.cards.length;
    this.window = { ...win };
    if (!this.active) { this.clear('empty'); return { drawn, failed }; }
    this.hidden = false;
    this.touch();
    this.render();
    this.start();
    try { this.onDrawn?.(this.layout(this.scene())); } catch { /* her trail's aim is best effort */ }
    return { drawn, failed };
  }

  async place(mark, ctx) {
    const from = await this.targets.resolve(mark.target, ctx);
    if (!from.ok) return from;
    const out = { id: mark.id, kind: mark.kind, target: mark.target, bounds: from.bounds };
    if (mark.text !== undefined) out.text = mark.text;
    if (mark.to) {
      const to = await this.targets.resolve(mark.to, ctx);
      if (!to.ok) return to;
      out.to = mark.to;
      out.toBounds = to.bounds;
    }
    return { ok: true, mark: out };
  }

  // A walkthrough step or other explicit interaction keeps the drawing alive.
  touch() { this.lastActivity = this.now(); }

  clear(reason = 'clear') {
    this.generation += 1;
    this.stop();
    this.marks.clear();
    this.cards = [];
    this.window = null;
    this.hidden = false;
    this.lastReason = reason;
    this.settle(() => this.layer.clear());
  }

  scene() {
    const marks = [...this.marks.values()].map(m => {
      const out = { id: m.id, kind: m.kind, bounds: m.bounds };
      if (m.toBounds) out.toBounds = m.toBounds;
      if (m.text !== undefined) out.text = m.text;
      return out;
    });
    return { marks, cards: this.cards, window: rect(this.window) };
  }

  render() { this.settle(() => this.layer.render(this.layout(this.scene()))); }
  hide() { this.settle(() => this.layer.render(new Map())); }

  // Layer calls can reject (a guide window replaced mid-load). Log, never throw into timers.
  settle(fn) {
    const log = () => console.error('[capri] Could not update the on-screen guide.');
    try {
      const result = fn();
      if (result && typeof result.then === 'function') result.then(undefined, log);
    } catch { log(); }
  }

  start() {
    if (!this.timer) this.timer = this.every(() => this.check(), CHECK_MS);
    this.timer?.unref?.();
  }

  stop() {
    if (this.timer) this.stopEvery(this.timer);
    this.timer = null;
  }

  // Runs inside setInterval: never throws; a failure (e.g. a native call) clears the drawing.
  check() {
    try { this.checkNow(); } catch {
      console.error('[capri] The on-screen guide check failed; clearing it.');
      this.clear('error');
    }
  }

  checkNow() {
    if (!this.active || this.replacing) return;
    if (!this.keep()) return this.clear('not-allowed');
    if (this.now() - this.lastActivity >= IDLE_MS) return this.clear('idle');
    const current = this.foreground();
    if (this.own(current)) return; // her own window in front: keep the drawing as it is
    if (!current || current.id !== this.window.id) return this.clear('foreground');
    if (!sameRect(current, this.window)) {
      if (!this.hidden) { this.hidden = true; this.hide(); this.moved = { from: rect(this.window) }; }
      this.window = { ...current };
      this.stillSince = this.now();
      return;
    }
    if (this.hidden && this.now() - this.stillSince >= STILL_MS) this.replace();
  }

  // The window stopped moving. Text is read again where it now is. Control and snapshot
  // geometry is cached from before the move: it moves with a pure move, and is dropped after a resize.
  async replace() {
    const generation = this.generation, from = this.moved.from, to = rect(this.window);
    const resized = from.width !== to.width || from.height !== to.height;
    const dx = to.x - from.x, dy = to.y - from.y;
    const live = t => t.type === 'text';
    this.replacing = true;
    try {
      const next = [];
      for (const mark of this.marks.values()) {
        const refresh = async (target, bounds) => {
          if (live(target)) { const r = await this.targets.resolve(target, {}); return r.ok ? r.bounds : null; }
          return resized ? null : shift(bounds, dx, dy);
        };
        const bounds = await refresh(mark.target, mark.bounds);
        const toBounds = mark.to ? await refresh(mark.to, mark.toBounds) : undefined;
        if (bounds && (!mark.to || toBounds)) next.push({ ...mark, bounds, ...(mark.to ? { toBounds } : {}) });
      }
      if (generation !== this.generation) return;
      this.marks = new Map(next.map(m => [m.id, m]));
      if (!this.active) return this.clear('lost-targets');
      const current = this.foreground();
      if (!this.own(current) && (!current || current.id !== this.window.id)) return this.clear('foreground');
      if (!this.own(current) && !sameRect(current, this.window)) {
        // It moved again while re-reading: stay hidden and wait for stillness from the new spot.
        this.moved = { from: to };
        this.window = { ...current };
        this.stillSince = this.now();
        return;
      }
      this.hidden = false;
      this.moved = null;
      this.render();
    } catch {
      if (generation === this.generation) this.clear('error');
    } finally {
      this.replacing = false;
    }
  }
}

module.exports = { GuideSession, fromTool, layoutTarget };

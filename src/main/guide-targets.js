'use strict';

const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

class GuideTargets {
  constructor({ accessibility, screen, foreground, now = Date.now }) {
    Object.assign(this, { accessibility, screen, foreground, now });
  }

  fresh(at) {
    const now = this.now();
    return Number.isFinite(at) && now >= at && now - at < 30000;
  }

  sameWindow(window) {
    const current = this.foreground();
    return Boolean(window && current && current.id === window.id && current.pid === window.pid);
  }

  // Native-pixel bounds must overlap the current foreground window.
  finish(bounds, window) {
    const current = this.foreground();
    if (!current || !bounds || !Object.values(bounds).every(Number.isFinite)) return { ok: false, reason: 'not-found' };
    if (!intersects(bounds, current)) return { ok: false, reason: 'outside-window' };
    return { ok: true, bounds, window: window || current };
  }

  async resolve(target, ctx) {
    ctx.check?.();
    switch (target?.type) {
      case 'control': return this.control(target);
      case 'text': return this.text(target.text, target.nth, ctx);
      case 'snapshot': return this.snapshot(target);
      case 'name': return this.name(target, ctx);
      default: return { ok: false, reason: 'not-found' };
    }
  }

  control({ id }) {
    const found = this.accessibility.controlBounds(id);
    if (!found || !this.fresh(found.at) || !this.sameWindow(found.window)) return { ok: false, reason: 'stale' };
    return this.finish(found.bounds, found.window);
  }

  async text(text, nth, ctx) {
    const window = this.foreground();
    if (!window?.id) return { ok: false, reason: 'stale' };
    const matches = await this.accessibility.readPixels(window, text, ctx);
    ctx.check?.();
    if (!this.sameWindow(window)) return { ok: false, reason: 'stale' };
    if (!matches.length) return { ok: false, reason: 'not-found' };
    if (nth === undefined && matches.length > 1) return { ok: false, reason: 'ambiguous' };
    const match = matches[(nth ?? 1) - 1];
    return match ? this.finish(match.bounds, window) : { ok: false, reason: 'not-found' };
  }

  snapshot({ snapshotId, x, y, width, height }) {
    const frame = this.screen.frames.get(snapshotId), window = this.foreground();
    if (!frame || !window || window.id !== frame.foreground || !this.fresh(frame.at)) return { ok: false, reason: 'stale' };
    const display = this.screen.displays().find(d => String(d.id) === String(frame.display.id));
    if (!display || JSON.stringify(display.bounds) !== JSON.stringify(frame.display.bounds)) return { ok: false, reason: 'stale' };
    const { bounds: b } = display;
    const map = (px, py) => this.screen.toNativePoint({ x: Math.round(b.x + px * b.width / frame.width), y: Math.round(b.y + py * b.height / frame.height) });
    const a = map(x, y), c = map(x + width, y + height);
    return this.finish({ x: a.x, y: a.y, width: c.x - a.x, height: c.y - a.y }, window);
  }

  async name({ name, role }, ctx) {
    if (typeof name !== 'string' || !name.trim()) return { ok: false, reason: 'not-found' };
    const wanted = name.trim().toLowerCase();
    const { controls } = await this.accessibility.inspect(name, ctx);
    const hits = (controls || []).filter(c => typeof c.name === 'string' && c.name.trim().toLowerCase() === wanted &&
      (!role || String(c.role).toLowerCase() === role.toLowerCase()));
    if (hits.length > 1) return { ok: false, reason: 'ambiguous' };
    if (hits.length === 1) {
      const found = this.control({ id: hits[0].id });
      if (found.ok || found.reason !== 'stale') return found;
    }
    return this.text(name, undefined, ctx);
  }
}

module.exports = { GuideTargets };

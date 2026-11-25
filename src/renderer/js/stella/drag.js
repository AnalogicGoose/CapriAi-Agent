// Stella: press, drag and drop. Installed on Stella's prototype; `this` is the controller.
import { clamp, damp } from './math.js';
import { clampToView, restDuration } from './wander.js';

const DRAG_THRESHOLD = 5;      // px before a press becomes a drag
const FOLLOW_RATE = 14;        // 1/s: how tightly she follows the pointer
const LEAN_RATE = 8;           // 1/s
const LEAN_MAX = 0.3;          // rad
const LEAN_PER_SPEED = 0.0005; // rad per px/s

export const Drag = {
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
  },

  // Returns true when the press landed on her and is now held.
  pointerDown(x, y, id = 0) {
    if (this.down || this.gaming || this.fullscreen || !this.hit(x, y)) return false; // any glide can be interrupted
    this.down = { x, y, id, pos: { ...this.pos } };
    this.pointerHeld = true;
    this.onPointerHold?.();
    return true;
  },

  pointerMove(x, y, id = 0) {
    const d = this.down;
    if (!d || id !== d.id) return;
    if (!this.dragging) {
      if (Math.hypot(x - d.x, y - d.y) <= DRAG_THRESHOLD) return;
      this.dragging = true;
      this.wake();
      this.endAct(false);
      this.traveler.stop(false); // the drag takes over any travel; a focus keeps aiming
    }
    this.dragTo = this.dropPoint(x, y);
  },

  pointerUp(x, y, id = 0) {
    if (!this.down || id !== this.down.id) return;
    this.release(false, x, y);
  },

  cancelDrag() { this.release(true); },

  dropPoint(x, y) {
    const d = this.down;
    return clampToView({ x: d.pos.x + x - d.x, y: d.pos.y + y - d.y }, this.radius, this.view);
  },

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
      this.homeToken++; // she stays where dropped: pending returns are off
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
  },

  // Follows the pointer while dragged (1:1 under reduced motion), runs her travel, and leans
  // against the drag's motion.
  stepPosition(dt, reduced) {
    const prev = { ...this.pos };
    if (this.dragging && this.dragTo) {
      this.pos = reduced ? { ...this.dragTo }
        : { x: damp(this.pos.x, this.dragTo.x, FOLLOW_RATE, dt), y: damp(this.pos.y, this.dragTo.y, FOLLOW_RATE, dt) };
    }
    this.traveler.step(dt, reduced);
    const vx = dt > 0 ? (this.pos.x - prev.x) / dt : 0;
    const target = this.dragging && !reduced ? clamp(-vx * LEAN_PER_SPEED, -LEAN_MAX, LEAN_MAX) : 0;
    this.lean = damp(this.lean, target, LEAN_RATE, dt);
  },
};

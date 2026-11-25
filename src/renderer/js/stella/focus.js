// Stella: her functions' placement — pointing, walkthrough focus, summon, reminders,
// approvals, body actions — and the holds and aim they keep up. Installed on Stella's
// prototype; `this` is the controller.
import { clamp } from './math.js';
import { besideTarget, edgeToward } from './wander.js';
import { CO_HOLDS, MOTIONS, bodyResponse } from './motions.js';
import { approachCenter, nearestBandPoint } from './travel.js';

const AIM_TURN = 2;         // rad/s: fastest her aim swings to a new target
const TRAIL_TURN = 4;       // rad/s: fastest the drawing trail swings to a new direction
const RETURN_MS = 1500;     // after pointing, before she heads back
const NUDGE = 120;          // px: how far a reminder or approval brings her toward the middle
const REMIND_STAY = 10000;  // ms near the middle after a reminder
const DIRECTIONS = { left: Math.PI, right: 0, up: -Math.PI / 2, down: Math.PI / 2 };
const resolved = () => Promise.resolve();
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
export const isPoint = p => Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
const toRect = t => (isPoint(t) ? { x: t.x, y: t.y, w: Number.isFinite(t.w) ? t.w : 1, h: Number.isFinite(t.h) ? t.h : 1 } : null);
// A mixer entry still playing (not killed, not released, not over).
export const live = (a, now) => Boolean(a) && a.killedAt == null && (a.hold ? a.releasedAt == null : now - a.start < a.duration);
export const letGo = (a, now) => { if (a?.hold && a.releasedAt == null && a.killedAt == null) a.releasedAt = now; };

export const Focus = {
  // Glides to `point` along a gentle curve (whatever she was pointing at is let go). Resolves true
  // on arrival, false if something replaced it.
  glideTo(point, { reason = 'glide' } = {}) {
    if (!isPoint(point)) return Promise.resolve(false);
    // Already there (spot('stage')): nothing moves and nothing she shows is let go.
    if (!this.travel && Math.hypot(point.x - this.pos.x, point.y - this.pos.y) < 1) return Promise.resolve(true);
    if (this.focus || this.pointing) { this.focus = this.pointing = null; this.homeToken++; }
    return this.traveler.go(point, { reason, fn: true });
  },

  teleport(spot) { return this.glideTo(spot, { reason: 'teleport' }); },

  goHome() { return this.down ? resolved() : this.traveler.goHome(); },

  canPoint(win) {
    const r = toRect(win);
    return Boolean(r && r.w > 0 && r.h > 0 && r.x < this.view.w && r.x + r.w > 0 && r.y < this.view.h && r.y + r.h > 0);
  },

  // Glides beside `target` (a window rect or a point) and aims a blade at its center until
  // stopPointing() or the next focus. While a focus is on, pointing owns her position. Resolves true
  // when she got there (not dragged or sent elsewhere first) and is still pointing at it.
  pointAt(target, { label = '' } = {}) {
    const rect = toRect(target);
    if (!rect) return Promise.resolve(false);
    this.homeToken++;
    const at = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    const focus = this.focus = { at };
    this.pointing = { dir: at.x < this.pos.x ? -1 : 1, rect, label };
    const to = besideTarget({ target: rect, radius: this.bandRadius, view: this.view, from: this.pos });
    return this.traveler.go(to, { reason: 'point', fn: true }).then(arrived => arrived && this.focus === focus);
  },

  // Done showing: the blade lets go, and after a moment she heads back to her anchor area.
  stopPointing() {
    if (!this.focus && !this.pointing) return;
    this.focus = this.pointing = null;
    const token = ++this.homeToken;
    this.after(RETURN_MS, () => { if (token === this.homeToken && !this.approvalOn) this.goHome(); });
  },

  // Walkthrough step: { rect } → beside it, aiming; { direction } → the edge of her display that
  // way, aiming out; null → let go and go back to her anchor area (once any approval is answered).
  guideFocus(focus) {
    if (focus?.rect) return this.pointAt(focus.rect, { label: focus.label });
    const angle = DIRECTIONS[focus?.direction];
    this.homeToken++;
    if (angle === undefined) {
      this.focus = this.pointing = null;
      return this.approvalOn ? resolved() : this.goHome();
    }
    const f = this.focus = { angle };
    this.pointing = { dir: Math.round(Math.cos(angle)) };
    const to = edgeToward({ direction: focus.direction, radius: this.bandRadius, view: this.view, from: this.pos });
    return this.traveler.go(to, { reason: 'guide', fn: true }).then(arrived => arrived && this.focus === f);
  },

  // Toward the cursor, stopping at the edge of the center zone; without one, toward the middle.
  // While she points at something she stays there.
  summon(cursor) {
    if (this.focus) return resolved();
    if (!isPoint(cursor)) return this.approach(Infinity, 'come');
    this.homeToken++;
    const r = this.bandRadius;
    const near = besideTarget({ target: { x: cursor.x, y: cursor.y, w: 1, h: 1 }, radius: r, view: this.view, from: this.pos });
    return this.traveler.go(nearestBandPoint(near, r, this.view), { reason: 'come', fn: true });
  },

  approach(maxDist, reason) {
    if (this.focus) return resolved();
    this.homeToken++;
    return this.traveler.go(approachCenter(this.pos, maxDist, this.bandRadius, this.view), { reason, fn: true });
  },

  // A reminder is due: three bright rings, a small drift toward the middle, then back. Pointing
  // or waiting on an approval, she's already placed: just the rings.
  remind() {
    this.play('chime');
    if (this.focus || this.approvalOn) return resolved();
    const arrive = this.approach(NUDGE, 'remind');
    const token = this.homeToken;
    this.after(REMIND_STAY, () => { if (token === this.homeToken && !this.focus && !this.approvalOn) this.goHome(); });
    return arrive;
  },

  // Waiting on an approval: the ring holds and she comes a little closer (unless pointing), until answered.
  approval(on) {
    on = Boolean(on);
    if (on === this.approvalOn) return resolved();
    this.approvalOn = on;
    if (on) return this.approach(NUDGE, 'approval');
    if (this.focus) return resolved();
    this.homeToken++;
    return this.goHome();
  },

  // The capri_body tool. `come` goes to `cursor` when given, else toward the middle. The reply
  // comes as soon as the move starts: callers never wait for her to arrive.
  async bodyAction(action, { cursor } = {}) {
    const r = bodyResponse(action);
    if (r.wake) this.wake();
    if (r.rest) this.resting = true;
    if (r.motion) this.play(r.motion);
    if (r.come) void this.summon(cursor);
    return r.reply ?? 'done';
  },

  // capri_draw finished drawing: { rect } on her display, { direction } of another display, or null
  // (unknown: toward the middle). Aims the trail there (replaying it if it's over); she doesn't move.
  drawAt(info) {
    const rect = toRect(info?.rect), angle = DIRECTIONS[info?.direction];
    this.drawTarget = rect ? { at: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 } } : angle === undefined ? null : { angle };
    const now = this.now();
    if (this.motions.list.some(a => a.name === 'trail' && live(a, now))) return;
    this.motions.lastRoutine = -Infinity; // a function's cue, not a routine flourish: the routine gap doesn't apply
    this.start('trail');
  },

  // The trail's direction follows the drawing from where she is, swinging at most TRAIL_TURN rad/s.
  stepTrail(dt, motions) {
    if (!(motions.trail > 0)) { this.trailAngle = null; return; }
    const d = this.drawTarget, at = d?.at || (d ? null : { x: this.view.w / 2, y: this.view.h / 2 });
    const want = at ? Math.atan2(at.y - this.pos.y, at.x - this.pos.x) : d.angle;
    if (this.trailAngle == null) this.trailAngle = want;
    else this.trailAngle = wrap(this.trailAngle + clamp(wrap(want - this.trailAngle), -TRAIL_TURN * dt, TRAIL_TURN * dt));
  },

  // Keeps her function holds up and lets them go when done. Aim and approval coexist (CO_HOLDS);
  // anything else as strong (a glitch, a chime) plays first.
  stepHolds(now) {
    for (const [name, want] of [['approval', this.approvalOn], ['aim', Boolean(this.focus)]]) {
      const mine = this.holds[name];
      if (!want) { letGo(mine, now); this.holds[name] = null; continue; }
      if (live(mine, now) || this.dragging || this.dormant) continue;
      if (this.motions.list.some(a => live(a, now) && !CO_HOLDS.has(a.name) && a.priority >= MOTIONS[name].priority)) continue;
      if (this.motions.play(name, now)) this.holds[name] = this.motions.list[this.motions.list.length - 1];
    }
  },

  // The aimed angle follows the focus from where she is, swinging at most AIM_TURN rad/s.
  stepAim(dt, motions) {
    const f = this.focus;
    if (!f) { if (!(motions.aim > 0)) this.aimAngle = null; return; }
    const want = f.at ? Math.atan2(f.at.y - this.pos.y, f.at.x - this.pos.x) : f.angle;
    if (this.aimAngle == null) this.aimAngle = want;
    else this.aimAngle = wrap(this.aimAngle + clamp(wrap(want - this.aimAngle), -AIM_TURN * dt, AIM_TURN * dt));
    if (f.at && this.pointing) this.pointing.dir = f.at.x < this.pos.x ? -1 : 1;
  },
};

'use strict';
// Fires due reminders from a single timer. Pure logic: clock and timers are injected.

const { nextDue } = require('./reminder-schedule');

const MISSED_AFTER_MS = 120000;
const MAX_WAIT_MS = 6 * 3600000;
const MAX_STEPS = 1000;

// Latest occurrence of the reminder that is <= nowMs. The floor is its effective due time `due` (the snoozed
// time if snoozed, else next_due); a snoozed time that is already the latest slot is returned as is.
// Interval schedules use the start-anchored grid arithmetically (no loop, so months asleep at 5 min are O(1)).
// Other kinds step nextDue forward from `due`, capped at MAX_STEPS (about 2.7 years of daily); if the cap is hit
// we return the last occurrence reached, and markFired's next occurrence may still be <= now, in which
// case the following check() fires again and converges rather than looping unboundedly here.
function latestOccurrence(reminder, nowMs) {
  const due = reminder.snoozed_until != null ? reminder.snoozed_until : reminder.next_due;
  if (due >= nowMs) return due;
  const s = reminder.schedule;
  if (s.kind === 'interval') {
    const step = s.every_minutes * 60000;
    const start = Date.parse(s.start);
    return Math.max(due, start + Math.floor((nowMs - start) / step) * step);
  }
  let latest = due;
  for (let i = 0; i < MAX_STEPS; i++) {
    const next = nextDue(s, new Date(latest));
    if (!next || next.getTime() > nowMs) break;
    latest = next.getTime();
  }
  return latest;
}

class ReminderScheduler {
  constructor({ store, now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout, fire }) {
    this.store = store;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.fire = fire;
    this.timer = null;
    this._checking = false;
    this._unsubscribe = store.onChange(() => { if (!this._checking) this.arm(); });
  }

  arm() {
    if (this.timer !== null) { this.clearTimer(this.timer); this.timer = null; }
    const wake = this.store.nextWake();
    if (wake === null) return;
    const wait = Math.max(0, Math.min(wake - this.now().getTime(), MAX_WAIT_MS));
    this.timer = this.setTimer(() => { this.timer = null; this.check(); }, wait);
  }

  check() {
    this._checking = true;
    try {
      const nowMs = this.now().getTime();
      for (const queued of this.store.due(nowMs)) {
        try {
          const reminder = this.store.get(queued.id);
          if (!reminder || reminder.status !== 'active') continue;
          const effective = reminder.snoozed_until != null ? reminder.snoozed_until : reminder.next_due;
          if (effective > nowMs) continue;
          const firedDue = latestOccurrence(reminder, nowMs);
          const missed = nowMs - firedDue > MISSED_AFTER_MS;
          try { this.fire(reminder, { missed, firedDue }); } finally { this.store.markFired(reminder.id, firedDue); }
        } catch (e) {
          // One failing reminder must not stop the others or the timer.
        }
      }
    } finally {
      this._checking = false;
      this.arm();
    }
  }

  resume() { this.check(); }

  stop() {
    if (this.timer !== null) { this.clearTimer(this.timer); this.timer = null; }
    if (this._unsubscribe) { this._unsubscribe(); this._unsubscribe = null; }
  }
}

module.exports = { ReminderScheduler, MISSED_AFTER_MS };

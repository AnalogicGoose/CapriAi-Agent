'use strict';
// Fires due reminders from a single timer. Pure logic: clock and timers are injected.

const { nextDue } = require('./reminder-schedule');

const MISSED_AFTER_MS = 120000;
const MAX_WAIT_MS = 6 * 3600000;
const MAX_STEPS = 1000;

// Latest occurrence of the reminder that is <= nowMs, starting from its effective due time `due`
// (the stored next_due, or the snoozed time). A snoozed time is itself the occurrence.
// Interval schedules are computed arithmetically (no loop, so months asleep at 5 min are O(1)).
// Other kinds step nextDue forward, capped at MAX_STEPS (about 2.7 years of daily); if the cap is hit
// we return the last occurrence reached, and markFired's next occurrence may still be <= now, in which
// case the following check() fires again and converges rather than looping unboundedly here.
function latestOccurrence(reminder, nowMs) {
  const due = reminder.snoozed_until !== null && reminder.snoozed_until !== undefined ? reminder.snoozed_until : reminder.next_due;
  if (due >= nowMs || reminder.snoozed_until !== null && reminder.snoozed_until !== undefined) return due;
  const s = reminder.schedule;
  if (s.kind === 'interval') {
    const step = s.every_minutes * 60000;
    return due + Math.floor((nowMs - due) / step) * step;
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
    store.onChange(() => { if (!this._checking) this.arm(); });
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
      for (const reminder of this.store.due(nowMs)) {
        try {
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
}

module.exports = { ReminderScheduler, MISSED_AFTER_MS };

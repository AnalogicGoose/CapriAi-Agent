'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ReminderStore } = require('../src/main/reminders');
const { ReminderScheduler, MISSED_AFTER_MS } = require('../src/main/reminder-scheduler');

const HOUR = 3600000;
const DAY = 24 * HOUR;
const at = (d, h = 9, m = 0) => new Date(2026, 5, d, h, m).getTime();
const daily = { kind: 'daily', at: '09:00' };

function make(nowMs = at(1, 8)) {
  const clock = { t: nowMs };
  const store = new ReminderStore(':memory:', { now: () => new Date(clock.t) });
  const timers = [];
  const fired = [];
  const sched = new ReminderScheduler({
    store,
    now: () => new Date(clock.t),
    setTimer: (fn, ms) => { const h = { ms, cleared: false }; h.fn = () => { h.cleared = true; fn(); }; timers.push(h); return h; },
    clearTimer: h => { h.cleared = true; },
    fire: (reminder, info) => fired.push({ id: reminder.id, ...info }),
  });
  const live = () => timers.filter(t => !t.cleared);
  return { store, clock, sched, timers, fired, live };
}

test('arms one timer for the earliest reminder and re-arms after firing', () => {
  const { store, clock, sched, live, fired } = make();
  store.add({ text: 'late', schedule: { kind: 'daily', at: '10:00' } });
  store.add({ text: 'early', schedule: daily });
  sched.arm();
  assert.equal(live().length, 1);
  assert.equal(live()[0].ms, HOUR);
  clock.t = at(1, 9);
  live()[0].fn();
  assert.equal(fired.length, 1);
  assert.equal(fired[0].missed, false);
  assert.equal(fired[0].firedDue, at(1, 9));
  assert.equal(live().length, 1);
  assert.equal(live()[0].ms, HOUR);
  store.close();
});

test('after three days asleep, a daily reminder fires once as missed, then schedules tomorrow', () => {
  const { store, clock, sched, fired } = make();
  const r = store.add({ text: 'water', schedule: daily });
  clock.t = at(4, 12);
  sched.check();
  assert.equal(fired.length, 1);
  assert.equal(fired[0].missed, true);
  assert.equal(fired[0].firedDue, at(4, 9));
  assert.equal(store.get(r.id).next_due, at(5, 9));
  sched.check();
  assert.equal(fired.length, 1);
  store.close();
});

test('a clock jump forward of a week fires each reminder at most once', () => {
  const { store, clock, sched, fired } = make();
  store.add({ text: 'a', schedule: daily });
  store.add({ text: 'b', schedule: { kind: 'interval', every_minutes: 5, start: new Date(at(1, 8)).toISOString() } });
  store.add({ text: 'c', schedule: { kind: 'once', date: '2026-06-03', at: '10:00' } });
  clock.t += 7 * DAY;
  sched.check();
  sched.check();
  assert.deepEqual(fired.map(f => f.id).sort(), [1, 2, 3]);
  assert.ok(fired.filter(f => f.id !== 2).every(f => f.missed));
  const interval = fired.find(f => f.id === 2);
  assert.ok(clock.t - interval.firedDue < 5 * 60000 && interval.firedDue <= clock.t);
  assert.ok(store.get(2).next_due > clock.t);
  store.close();
});

test('a snoozed reminder fires at the snoozed time and a recent due is not missed', () => {
  const { store, clock, sched, fired } = make();
  const r = store.add({ text: 'a', schedule: daily });
  store.snooze(r.id, at(1, 9, 10));
  clock.t = at(1, 9, 11);
  sched.check();
  assert.equal(fired[0].firedDue, at(1, 9, 10));
  assert.equal(fired[0].missed, false);
  assert.ok(MISSED_AFTER_MS === 120000);
  assert.equal(store.get(r.id).next_due, at(2, 9));
  store.close();
});

test('a throwing fire does not stop other reminders or the timer', () => {
  const { store, clock } = make();
  store.add({ text: 'a', schedule: daily });
  store.add({ text: 'b', schedule: daily });
  const seen = [];
  const s2 = new ReminderScheduler({
    store, now: () => new Date(clock.t), setTimer: (fn, ms) => ({ fn, ms }), clearTimer() {},
    fire: r => { seen.push(r.id); if (r.id === 1) throw new Error('boom'); },
  });
  clock.t = at(1, 9);
  assert.doesNotThrow(() => s2.check());
  assert.deepEqual(seen, [1, 2]);
  assert.ok(s2.timer);
  store.close();
});

test('timer waits are capped at 6 hours and never negative', () => {
  const { store, clock, sched, live } = make();
  store.add({ text: 'far', schedule: { kind: 'once', date: '2026-06-20', at: '09:00' } });
  sched.arm();
  assert.equal(live()[0].ms, 6 * HOUR);
  store.close();
  const m = make();
  m.store.add({ text: 'x', schedule: daily });
  m.clock.t = at(1, 9, 30);
  m.sched.arm();
  assert.equal(m.live()[0].ms, 0);
  m.store.close();
});

test('no timer is armed when nothing is active', () => {
  const { store, sched, live } = make();
  sched.arm();
  assert.equal(live().length, 0);
  store.close();
});

test('adding, updating or cancelling re-arms', () => {
  const { store, sched, live, timers } = make();
  const r = store.add({ text: 'a', schedule: daily });
  assert.equal(live().length, 1);
  assert.equal(live()[0].ms, HOUR);
  store.update(r.id, { schedule: { kind: 'daily', at: '08:30' } });
  assert.equal(live().length, 1);
  assert.equal(live()[0].ms, HOUR / 2);
  store.cancel(r.id);
  assert.equal(live().length, 0);
  assert.ok(timers.length >= 2);
  store.close();
});

test('resume checks due reminders and re-arms', () => {
  const { store, clock, sched, fired, live } = make();
  store.add({ text: 'a', schedule: daily });
  clock.t = at(2, 9, 30);
  sched.resume();
  assert.equal(fired.length, 1);
  assert.equal(fired[0].missed, true);
  assert.equal(live().length, 1);
  store.close();
});

test('an old snooze on a repeating reminder fires once, then schedules the next future slot', () => {
  const { store, clock, sched, fired } = make();
  const r = store.add({ text: 'a', schedule: daily });
  store.snooze(r.id, at(1, 9, 10));
  clock.t = at(4, 12);
  sched.check();
  assert.equal(fired.length, 1);
  assert.equal(fired[0].firedDue, at(4, 9));
  assert.equal(store.get(r.id).next_due, at(5, 9));
  sched.check();
  assert.equal(fired.length, 1);
  store.close();
});

test('an old snooze on an interval reminder fires once', () => {
  const { store, clock, sched, fired } = make();
  const r = store.add({ text: 'a', schedule: { kind: 'interval', every_minutes: 60, start: new Date(at(1, 8)).toISOString() } });
  store.snooze(r.id, at(1, 9, 10));
  clock.t = at(4, 12, 30);
  sched.check();
  sched.check();
  assert.equal(fired.length, 1);
  assert.equal(fired[0].firedDue, at(4, 12));
  store.close();
});

test('stop clears the timer and unsubscribes from the store', () => {
  const { store, sched, live } = make();
  store.add({ text: 'a', schedule: daily });
  assert.equal(live().length, 1);
  sched.stop();
  assert.equal(live().length, 0);
  store.add({ text: 'b', schedule: daily });
  assert.equal(live().length, 0);
  store.close();
});

test('check skips a reminder cancelled earlier in the same loop', () => {
  const { store, clock } = make();
  clock.t = at(1, 9);
  store.add({ text: 'a', schedule: daily });
  store.add({ text: 'b', schedule: daily });
  const seen = [];
  new ReminderScheduler({
    store, now: () => new Date(clock.t), setTimer: () => ({}), clearTimer() {},
    fire: r => { seen.push(r.id); store.cancel(2); },
  }).check();
  assert.deepEqual(seen, [1]);
  store.close();
});

'use strict';
process.env.TZ = 'America/New_York';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { KINDS, validateSchedule, nextDue, describe } = require('../src/main/reminder-schedule');

const HOUR = 3600000;
const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

test('timezone is really America/New_York with DST transitions', () => {
  assert.equal(new Date(2026, 2, 7, 12).getTimezoneOffset(), 300);
  assert.equal(new Date(2026, 2, 9, 12).getTimezoneOffset(), 240);
  assert.equal(new Date(2026, 10, 2, 12).getTimezoneOffset(), 300);
});

test('KINDS lists exactly the supported kinds', () => {
  assert.deepEqual(KINDS, ['once', 'daily', 'weekdays', 'days', 'interval', 'monthly']);
});

test('daily 09:00 stays at 09:00 local across the March and November DST switches', () => {
  const s = validateSchedule({ kind: 'daily', at: '09:00' });
  const mar7 = nextDue(s, new Date(2026, 2, 6, 10, 0));
  const mar8 = nextDue(s, mar7);
  const mar9 = nextDue(s, mar8);
  assert.equal(fmt(mar7), '2026-03-07 09:00');
  assert.equal(fmt(mar8), '2026-03-08 09:00');
  assert.equal(fmt(mar9), '2026-03-09 09:00');
  assert.equal(mar8 - mar7, 23 * HOUR);
  const oct31 = nextDue(s, new Date(2026, 9, 30, 10, 0));
  const nov1 = nextDue(s, oct31);
  const nov2 = nextDue(s, nov1);
  assert.equal(fmt(nov1), '2026-11-01 09:00');
  assert.equal(fmt(nov2), '2026-11-02 09:00');
  assert.equal(nov1 - oct31, 25 * HOUR);
});

test('nextDue is strictly after the given instant', () => {
  const s = validateSchedule({ kind: 'daily', at: '09:00' });
  assert.equal(fmt(nextDue(s, new Date(2026, 5, 1, 9, 0))), '2026-06-02 09:00');
  assert.equal(fmt(nextDue(s, new Date(2026, 5, 1, 8, 59))), '2026-06-01 09:00');
});

test('weekdays skips Saturday and Sunday', () => {
  const s = validateSchedule({ kind: 'weekdays', at: '09:00' });
  const fri = new Date(2026, 10, 20, 10, 0); // Fri 2026-11-20
  assert.equal(fri.getDay(), 5);
  const next = nextDue(s, fri);
  assert.equal(fmt(next), '2026-11-23 09:00');
  assert.equal(next.getDay(), 1);
});

test('days [1,3] fires Monday and Wednesday', () => {
  const s = validateSchedule({ kind: 'days', days: [3, 1], at: '08:30' });
  let d = new Date(2026, 10, 22, 0, 0); // Sunday
  const got = [];
  for (let i = 0; i < 4; i++) { d = nextDue(s, d); got.push(fmt(d)); }
  assert.deepEqual(got, ['2026-11-23 08:30', '2026-11-25 08:30', '2026-11-30 08:30', '2026-12-02 08:30']);
});

test('interval 120 counts from start, not from now', () => {
  const start = new Date(2026, 10, 23, 1, 0).toISOString();
  const s = validateSchedule({ kind: 'interval', every_minutes: 120, start });
  assert.equal(fmt(nextDue(s, new Date(2026, 10, 23, 4, 30))), '2026-11-23 05:00');
  assert.equal(fmt(nextDue(s, new Date(2026, 10, 23, 5, 0))), '2026-11-23 07:00');
  assert.equal(fmt(nextDue(s, new Date(2026, 10, 22, 0, 0))), '2026-11-23 01:00');
  assert.equal(fmt(nextDue(s, new Date(2026, 10, 23, 1, 0))), '2026-11-23 03:00');
});

test('monthly 31 falls back to the month\'s last day and returns to the 31st', () => {
  const s = validateSchedule({ kind: 'monthly', day_of_month: 31, at: '10:00' });
  const jan = nextDue(s, new Date(2026, 0, 1));
  const feb = nextDue(s, jan);
  const mar = nextDue(s, feb);
  assert.equal(fmt(jan), '2026-01-31 10:00');
  assert.equal(fmt(feb), '2026-02-28 10:00');
  assert.equal(fmt(mar), '2026-03-31 10:00');
});

test('once in the past returns null', () => {
  const s = validateSchedule({ kind: 'once', date: '2026-01-05', at: '09:00' });
  assert.equal(nextDue(s, new Date(2026, 0, 5, 9, 0)), null);
  assert.equal(nextDue(s, new Date(2026, 5, 1)), null);
  assert.equal(fmt(nextDue(s, new Date(2026, 0, 4))), '2026-01-05 09:00');
  const t = new Date(2026, 11, 1, 12, 0);
  const viaStart = validateSchedule({ kind: 'once', start: t.toISOString() });
  assert.equal(nextDue(viaStart, new Date(2026, 11, 1, 11, 0)).getTime(), t.getTime());
  assert.equal(nextDue(viaStart, t), null);
});

test('validation rejects unknown kinds, 25:00, every_minutes 4, and day_of_month 0', () => {
  assert.throws(() => validateSchedule({ kind: 'yearly', at: '09:00' }), /kind/);
  assert.throws(() => validateSchedule({ kind: 'daily', at: '25:00' }), /at/);
  assert.throws(() => validateSchedule({ kind: 'daily' }), /at/);
  assert.throws(() => validateSchedule({ kind: 'interval', every_minutes: 4 }), /every_minutes/);
  assert.throws(() => validateSchedule({ kind: 'interval', every_minutes: 10081 }), /every_minutes/);
  assert.throws(() => validateSchedule({ kind: 'monthly', day_of_month: 0, at: '09:00' }), /day_of_month/);
  assert.throws(() => validateSchedule({ kind: 'monthly', day_of_month: 32, at: '09:00' }), /day_of_month/);
  assert.throws(() => validateSchedule({ kind: 'days', days: [], at: '09:00' }), /days/);
  assert.throws(() => validateSchedule({ kind: 'days', days: [7], at: '09:00' }), /days/);
  assert.throws(() => validateSchedule({ kind: 'once', at: '09:00' }), /date|start/);
  assert.throws(() => validateSchedule({ kind: 'once', date: '2026-02-30', at: '09:00' }), /date/);
  assert.throws(() => validateSchedule(null), /schedule/);
});

test('validation returns a normalized schedule', () => {
  const s = validateSchedule({ kind: 'days', days: [3, 1, 1], at: '09:00', junk: 1 });
  assert.deepEqual(s, { kind: 'days', days: [1, 3], at: '09:00' });
});

test('describe returns five languages', () => {
  const wk = validateSchedule({ kind: 'weekdays', at: '09:00' });
  assert.equal(describe(wk, 'en'), 'Weekdays at 09:00');
  const iv = validateSchedule({ kind: 'interval', every_minutes: 120, start: new Date(2026, 0, 1).toISOString() });
  assert.equal(describe(iv, 'es'), 'Cada 2 horas');
  const out = new Set();
  for (const lang of ['en', 'es', 'fr', 'pt', 'ru']) {
    for (const s of [wk, iv, { kind: 'daily', at: '07:05' }, { kind: 'days', days: [1, 3], at: '07:05' }, { kind: 'monthly', day_of_month: 5, at: '07:05' }, { kind: 'once', date: '2026-01-05', at: '09:00' }]) {
      const text = describe(s, lang);
      assert.ok(typeof text === 'string' && text.length > 0);
    }
    out.add(describe(wk, lang));
  }
  assert.equal(out.size, 5);
  assert.equal(describe(wk, 'zz'), 'Weekdays at 09:00');
});

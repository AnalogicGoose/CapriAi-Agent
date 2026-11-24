'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ReminderStore } = require('../src/main/reminders');
const { validateReminderAction, moveReminder, reminderRows } = require('../src/main/reminder-settings');

const at = (d, h = 9, m = 0) => new Date(2026, 5, d, h, m).getTime();
const make = () => new ReminderStore(':memory:', { now: () => new Date(at(1, 8)) });

test('settings actions validate reminder ids and times', () => {
  assert.equal(validateReminderAction('reminder-cancel', 3), 3);
  for (const bad of [1.5, '3', 0, -1, NaN, null, undefined]) assert.throws(() => validateReminderAction('reminder-cancel', bad), /id/);
  assert.deepEqual(validateReminderAction('reminder-move', { id: 2, at: '07:30' }), { id: 2, at: '07:30' });
  assert.deepEqual(validateReminderAction('reminder-move', { id: 2, at: '07:30', date: '2026-06-02' }), { id: 2, at: '07:30', date: '2026-06-02' });
  assert.throws(() => validateReminderAction('reminder-move', { id: 2, at: '25:00' }), /time/);
  assert.throws(() => validateReminderAction('reminder-move', { id: 2.5, at: '07:30' }), /id/);
  assert.throws(() => validateReminderAction('reminder-move', { id: 2, at: '07:30', date: '2026-02-30' }), /date/);
  assert.throws(() => validateReminderAction('reminder-move', { id: 2, at: '07:30', date: 'tomorrow' }), /date/);
  assert.throws(() => validateReminderAction('reminder-move', null), /reminder/i);
});

test('moving a once reminder changes its next due; moving a daily one changes its time of day', () => {
  const store = make();
  const once = store.add({ text: 'Call mum', schedule: { kind: 'once', date: '2026-06-01', at: '09:00' } });
  const moved = moveReminder(store, { id: once.id, at: '11:15', date: '2026-06-03' });
  assert.equal(moved.next_due, at(3, 11, 15));
  assert.deepEqual(moved.schedule, { kind: 'once', date: '2026-06-03', at: '11:15' });
  const sameDay = moveReminder(store, { id: once.id, at: '10:00' });
  assert.equal(sameDay.next_due, at(3, 10, 0));

  const daily = store.add({ text: 'Water', schedule: { kind: 'daily', at: '09:00' } });
  const d = moveReminder(store, { id: daily.id, at: '18:30', date: '2030-01-01' });
  assert.deepEqual(d.schedule, { kind: 'daily', at: '18:30' });
  assert.equal(d.next_due, at(1, 18, 30));

  const interval = store.add({ text: 'Stretch', schedule: { kind: 'interval', every_minutes: 60, start: new Date(at(1, 8)).toISOString() } });
  assert.throws(() => moveReminder(store, { id: interval.id, at: '10:00' }), /time of day/);
  assert.throws(() => moveReminder(store, { id: 999, at: '10:00' }), /not found/);
});

test('reminderRows lists active reminders with local next time and repeat label', () => {
  const store = make();
  const r = store.add({ text: '<b>Pills</b>', schedule: { kind: 'daily', at: '09:00' } });
  const gone = store.add({ text: 'Old', schedule: { kind: 'daily', at: '10:00' } });
  store.cancel(gone.id);
  assert.deepEqual(reminderRows(store, 'en'), [{ id: r.id, text: '<b>Pills</b>', next: '2026-06-01 09:00', repeat: 'Daily at 09:00' }]);
  assert.deepEqual(reminderRows(null, 'en'), []);
});

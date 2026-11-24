'use strict';
// Control room helpers for reminders: action validation (pure, no Electron), list rows, and moving a reminder.
const { summary } = require('./reminder-commands');

const AT_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = n => String(n).padStart(2, '0');

function checkId(id) {
  if (!Number.isInteger(id) || id < 1) throw Error('Invalid reminder id.');
  return id;
}

function checkDate(date) {
  const m = typeof date === 'string' && DATE_RE.exec(date);
  const d = m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!m || d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) throw Error('Invalid date: use YYYY-MM-DD.');
  return date;
}

function validateReminderAction(name, value) {
  if (name === 'reminder-cancel') return checkId(value);
  if (name === 'reminder-move') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid reminder move.');
    checkId(value.id);
    if (typeof value.at !== 'string' || !AT_RE.test(value.at)) throw Error('Invalid time: use HH:MM.');
    const out = { id: value.id, at: value.at };
    if (value.date !== undefined) out.date = checkDate(value.date);
    return out;
  }
  throw Error('Unknown action.');
}

const reminderRows = (store, lang) => (store ? store.list().map(row => summary(row, lang)) : []);

// Once: new date (kept if omitted) and time. Repeating with a time of day: only `at` changes. Interval has no time of day.
function moveReminder(store, { id, at, date }) {
  const row = store.get(id);
  if (!row || row.status !== 'active') throw Error(`Reminder ${id} not found`);
  const s = row.schedule;
  let schedule;
  if (s.kind === 'once') {
    let keep = s.date;
    if (!keep) { const d = new Date(s.start); keep = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
    schedule = { kind: 'once', date: date ?? keep, at };
  } else if (s.kind === 'interval') throw Error('This reminder repeats on an interval and has no time of day to move.');
  else schedule = { ...s, at };
  return store.update(id, { schedule });
}

module.exports = { validateReminderAction, reminderRows, moveReminder };

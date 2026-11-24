'use strict';

const { DatabaseSync } = require('node:sqlite');
const { validateSchedule, nextDue } = require('./reminder-schedule');

const MAX_TEXT = 200;
const CONTROL_RE = /\p{Cc}/u;

// Text is trimmed, must be 1..200 chars, and is REJECTED (not stripped) if it contains control characters.
function cleanText(value) {
  if (typeof value !== 'string') throw new Error('Invalid reminder: text must be a string');
  const text = value.trim();
  if (!text || text.length > MAX_TEXT) throw new Error(`Invalid reminder: text must be 1-${MAX_TEXT} characters`);
  if (CONTROL_RE.test(text)) throw new Error('Invalid reminder: text must not contain control characters');
  return text;
}

const toRow = row => (row ? { ...row, schedule: JSON.parse(row.schedule) } : null);
const EFFECTIVE = 'COALESCE(snoozed_until, next_due)';
const DAY_MS = 24 * 3600000;
const KEEP_ENDED_MS = 30 * DAY_MS;

// Schema versions (PRAGMA user_version):
//   0: the first reminders table.
//   1: pending_due (the fired occurrence still waiting for Done / Snooze / a dismiss, so it survives being away, a
//      lock or a restart) and ended_at (when it became done or cancelled, for the 30-day prune).
const SCHEMA_VERSION = 1;
function migrate(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version >= SCHEMA_VERSION) return;
  db.exec('BEGIN');
  try {
    const columns = new Set(db.prepare('PRAGMA table_info(reminders)').all().map(c => c.name));
    if (!columns.has('pending_due')) db.exec('ALTER TABLE reminders ADD COLUMN pending_due INTEGER');
    if (!columns.has('ended_at')) db.exec('ALTER TABLE reminders ADD COLUMN ended_at INTEGER');
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

class ReminderStore {
  constructor(file, { now = () => new Date() } = {}) {
    this.now = now;
    this._listeners = [];
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY,
        text TEXT NOT NULL,
        schedule TEXT NOT NULL,
        next_due INTEGER NOT NULL,
        fired_due INTEGER,
        snoozed_until INTEGER,
        created_at INTEGER NOT NULL,
        last_fired INTEGER,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','cancelled')),
        language TEXT NOT NULL DEFAULT 'en'
      );`);
    migrate(this.db);
  }

  // Registers fn to run after any mutation (add/update/cancel/snooze/markFired/complete).
  onChange(fn) {
    this._listeners.push(fn);
    return () => { this._listeners = this._listeners.filter(l => l !== fn); };
  }

  _changed() { for (const fn of [...this._listeners]) fn(); }

  // Validate and normalize; an interval without a start is anchored to the injected clock, once, here.
  _schedule(input) {
    const s = input && input.kind === 'interval' && input.start === undefined
      ? { ...input, start: this.now().toISOString() } : input;
    return validateSchedule(s);
  }

  _first(schedule) {
    const due = nextDue(schedule, this.now());
    if (!due) throw new Error('Invalid schedule: has no upcoming occurrence (is in the past)');
    return due.getTime();
  }

  add({ text, schedule, language } = {}) {
    const clean = cleanText(text);
    const normalized = this._schedule(schedule);
    const next = this._first(normalized);
    const info = this.db.prepare(
      'INSERT INTO reminders(text, schedule, next_due, created_at, language) VALUES(?, ?, ?, ?, ?)'
    ).run(clean, JSON.stringify(normalized), next, this.now().getTime(), typeof language === 'string' && language ? language : 'en');
    this._changed();
    return this.get(Number(info.lastInsertRowid));
  }

  get(id) {
    return toRow(this.db.prepare('SELECT * FROM reminders WHERE id = ?').get(id));
  }

  list({ includeInactive = false } = {}) {
    const where = includeInactive ? '' : "WHERE status = 'active'";
    return this.db.prepare(`SELECT * FROM reminders ${where} ORDER BY ${EFFECTIVE}, id`).all().map(toRow);
  }

  update(id, { text, schedule } = {}) {
    const current = this.get(id);
    if (!current) throw new Error(`Reminder ${id} not found`);
    const newText = text === undefined ? current.text : cleanText(text);
    let newSchedule = current.schedule;
    let next = current.next_due;
    let snoozed = current.snoozed_until;
    if (schedule !== undefined) {
      newSchedule = this._schedule(schedule);
      next = this._first(newSchedule);
      snoozed = null;
    }
    this.db.prepare('UPDATE reminders SET text = ?, schedule = ?, next_due = ?, snoozed_until = ? WHERE id = ?')
      .run(newText, JSON.stringify(newSchedule), next, snoozed, id);
    this._changed();
    return this.get(id);
  }

  cancel(id) {
    const changed = this.db.prepare("UPDATE reminders SET status = 'cancelled', pending_due = NULL, ended_at = ? WHERE id = ? AND status = 'active'")
      .run(this.now().getTime(), id).changes > 0;
    if (changed) this._changed();
    return changed;
  }

  due(at) {
    return this.db.prepare(`SELECT * FROM reminders WHERE status = 'active' AND ${EFFECTIVE} <= ? ORDER BY ${EFFECTIVE}, id`)
      .all(at).map(toRow);
  }

  // Records that the occurrence at `firedDue` fired; it stays pending (pending_due) until acknowledged. Only the latest
  // fired occurrence of a reminder is pending, so a reminder never has more than one notice waiting. Repeats continue from the schedule strictly after
  // `firedDue` (not after the stored next_due), so a snoozed copy never leaves a duplicate behind.
  markFired(id, firedDue) {
    const r = this.get(id);
    if (!r || r.status !== 'active') return r;
    const now = this.now().getTime();
    if (r.schedule.kind === 'once') {
      this.db.prepare("UPDATE reminders SET fired_due = ?, pending_due = ?, last_fired = ?, snoozed_until = NULL, status = 'done', ended_at = ? WHERE id = ?")
        .run(firedDue, firedDue, now, now, id);
    } else {
      const next = nextDue(r.schedule, new Date(firedDue));
      if (next) {
        this.db.prepare('UPDATE reminders SET fired_due = ?, pending_due = ?, last_fired = ?, snoozed_until = NULL, next_due = ? WHERE id = ?')
          .run(firedDue, firedDue, now, next.getTime(), id);
      } else {
        this.db.prepare("UPDATE reminders SET fired_due = ?, pending_due = ?, last_fired = ?, snoozed_until = NULL, status = 'done', ended_at = ? WHERE id = ?")
          .run(firedDue, firedDue, now, now, id);
      }
    }
    this._changed();
    return this.get(id);
  }

  complete(id, firedDue) {
    const r = this.get(id);
    if (!r) return null;
    if (r.schedule.kind === 'once') {
      this.db.prepare("UPDATE reminders SET status = 'done', snoozed_until = NULL, ended_at = ? WHERE id = ? AND status = 'active'").run(this.now().getTime(), id);
      this.db.prepare('UPDATE reminders SET pending_due = NULL WHERE id = ?').run(id);
    } else if (r.fired_due === firedDue) {
      this.db.prepare('UPDATE reminders SET fired_due = NULL, snoozed_until = NULL, pending_due = NULL WHERE id = ?').run(id);
    }
    this._changed();
    return this.get(id);
  }

  // With `firedDue`, a one-time reminder that just fired at that time (markFired made it 'done') is reopened for the
  // snooze; without it only active reminders can be snoozed.
  snooze(id, until, firedDue) {
    const r = this.get(id);
    const reopen = r && r.status === 'done' && r.schedule.kind === 'once' && firedDue !== undefined && r.fired_due === firedDue;
    const changed = this.db.prepare(`UPDATE reminders SET snoozed_until = ?, status = 'active', ended_at = NULL WHERE id = ? AND (status = 'active'${reopen ? " OR status = 'done'" : ''})`)
      .run(until, id).changes > 0;
    // The snoozed time fires again, so the occurrence it came from is acknowledged.
    if (changed && (firedDue === undefined || r.pending_due === firedDue)) this.db.prepare('UPDATE reminders SET pending_due = NULL WHERE id = ?').run(id);
    this._changed();
    return this.get(id);
  }

  // The user dismissed the card of the occurrence at `firedDue` (without Done / Snooze): it is no longer pending.
  acknowledge(id, firedDue) {
    const changed = this.db.prepare('UPDATE reminders SET pending_due = NULL WHERE id = ? AND pending_due = ?').run(id, firedDue).changes > 0;
    if (changed) this._changed();
    return changed;
  }

  // Fired occurrences not yet acknowledged (one per reminder: its latest), oldest first.
  pending() {
    return this.db.prepare("SELECT * FROM reminders WHERE pending_due IS NOT NULL AND status != 'cancelled' ORDER BY pending_due, id")
      .all().map(toRow);
  }

  // Deletes done / cancelled reminders that ended more than 30 days ago and wait for nothing. Returns the count.
  prune(keepMs = KEEP_ENDED_MS) {
    const cutoff = this.now().getTime() - keepMs;
    return Number(this.db.prepare(`DELETE FROM reminders WHERE status IN ('done','cancelled') AND pending_due IS NULL
      AND COALESCE(ended_at, last_fired, created_at) < ?`).run(cutoff).changes);
  }

  nextWake() {
    const row = this.db.prepare(`SELECT MIN(${EFFECTIVE}) AS t FROM reminders WHERE status = 'active'`).get();
    return row && row.t !== null ? row.t : null;
  }

  close() { this.db.close(); }
}

module.exports = { ReminderStore, SCHEMA_VERSION };

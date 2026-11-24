'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ReminderStore } = require('../src/main/reminders');

const at = (d, h = 9, m = 0) => new Date(2026, 5, d, h, m).getTime();
function make(nowMs = at(1, 8)) {
  const clock = { t: nowMs };
  const store = new ReminderStore(':memory:', { now: () => new Date(clock.t) });
  return { store, clock };
}
const daily = { kind: 'daily', at: '09:00' };

test('add validates text length and schedule, and stores the language', () => {
  const { store } = make();
  const r = store.add({ text: '  Drink water  ', schedule: daily, language: 'es' });
  assert.equal(r.text, 'Drink water');
  assert.equal(r.language, 'es');
  assert.equal(r.status, 'active');
  assert.equal(r.next_due, at(1));
  assert.equal(r.created_at, at(1, 8));
  assert.deepEqual(r.schedule, daily);
  assert.throws(() => store.add({ text: '   ', schedule: daily, language: 'en' }), /text/);
  assert.throws(() => store.add({ text: 'x'.repeat(201), schedule: daily, language: 'en' }), /text/);
  assert.throws(() => store.add({ text: 'a\nb', schedule: daily, language: 'en' }), /control/);
  assert.throws(() => store.add({ text: 'ok', schedule: { kind: 'daily', at: '25:00' }, language: 'en' }), /at/);
  assert.throws(() => store.add({ text: 'ok', schedule: { kind: 'once', date: '2026-05-01', at: '09:00' }, language: 'en' }), /past/);
  assert.equal(store.add({ text: 'x'.repeat(200), schedule: daily, language: 'en' }).text.length, 200);
  store.close();
});

test('interval start is anchored once at creation', () => {
  const { store, clock } = make();
  const r = store.add({ text: 'stretch', schedule: { kind: 'interval', every_minutes: 60 }, language: 'en' });
  assert.equal(r.schedule.start, new Date(at(1, 8)).toISOString());
  assert.equal(r.next_due, at(1, 9));
  clock.t = at(1, 9, 5);
  assert.equal(store.get(r.id).schedule.start, r.schedule.start);
  store.close();
});

test('markFired on a once reminder makes it done; on daily it advances next_due by one day', () => {
  const { store } = make();
  const once = store.add({ text: 'once', schedule: { kind: 'once', date: '2026-06-01', at: '09:00' }, language: 'en' });
  const rep = store.add({ text: 'daily', schedule: daily, language: 'en' });
  const a = store.markFired(once.id, at(1));
  assert.equal(a.status, 'done');
  assert.equal(a.fired_due, at(1));
  assert.equal(a.last_fired, at(1, 8));
  const b = store.markFired(rep.id, at(1));
  assert.equal(b.status, 'active');
  assert.equal(b.next_due, at(2));
  assert.equal(b.fired_due, at(1));
  assert.deepEqual(store.due(at(1, 23)).map(r => r.id), []);
  store.close();
});

test('due uses the effective time and list orders by it', () => {
  const { store } = make();
  const a = store.add({ text: 'a', schedule: { kind: 'daily', at: '10:00' }, language: 'en' });
  const b = store.add({ text: 'b', schedule: daily, language: 'en' });
  assert.deepEqual(store.list().map(r => r.id), [b.id, a.id]);
  assert.equal(store.nextWake(), at(1));
  store.snooze(b.id, at(1, 12));
  assert.deepEqual(store.list().map(r => r.id), [a.id, b.id]);
  assert.deepEqual(store.due(at(1, 10)).map(r => r.id), [a.id]);
  assert.equal(store.nextWake(), at(1, 10));
  store.close();
});

test('snooze longer than the gap to the next repeat fires once and the series continues without a duplicate', () => {
  const { store } = make();
  const r = store.add({ text: 'pill', schedule: daily, language: 'en' });
  store.snooze(r.id, at(2));
  assert.deepEqual(store.due(at(2)).map(x => x.id), [r.id]);
  assert.equal(store.due(at(2)).length, 1);
  assert.equal(store.due(at(1, 23)).length, 0);
  store.markFired(r.id, at(2));
  const after = store.get(r.id);
  assert.equal(after.snoozed_until, null);
  assert.equal(after.next_due, at(3));
  assert.equal(store.due(at(2, 23)).length, 0);
  store.close();
});

test('snooze after the series already advanced does not skip or duplicate', () => {
  const { store } = make();
  const r = store.add({ text: 'pill', schedule: daily, language: 'en' });
  store.markFired(r.id, at(1));
  store.snooze(r.id, at(1, 9, 30));
  assert.equal(store.due(at(1, 9, 30)).length, 1);
  store.markFired(r.id, at(1, 9, 30));
  assert.equal(store.get(r.id).next_due, at(2));
  store.close();
});

test('complete on a held card completes the fired instance, not the next one', () => {
  const { store } = make();
  const rep = store.add({ text: 'daily', schedule: daily, language: 'en' });
  store.markFired(rep.id, at(1));
  store.complete(rep.id, at(1));
  const after = store.get(rep.id);
  assert.equal(after.fired_due, null);
  assert.equal(after.next_due, at(2));
  assert.equal(after.status, 'active');
  store.markFired(rep.id, at(2));
  store.complete(rep.id, at(1));
  assert.equal(store.get(rep.id).fired_due, at(2));
  const once = store.add({ text: 'o', schedule: { kind: 'once', date: '2026-06-01', at: '09:00' }, language: 'en' });
  store.complete(once.id, at(1));
  assert.equal(store.get(once.id).status, 'done');
  store.close();
});

test('cancel ends a repeating series', () => {
  const { store } = make();
  const r = store.add({ text: 'daily', schedule: daily, language: 'en' });
  assert.equal(store.cancel(r.id), true);
  assert.equal(store.cancel(r.id), false);
  assert.equal(store.cancel(999), false);
  assert.equal(store.get(r.id).status, 'cancelled');
  assert.deepEqual(store.due(at(30)), []);
  assert.equal(store.nextWake(), null);
  assert.equal(store.list().length, 0);
  assert.equal(store.list({ includeInactive: true }).length, 1);
  store.close();
});

test('update changes text and re-validates schedule, recomputing next_due', () => {
  const { store } = make();
  const r = store.add({ text: 'a', schedule: daily, language: 'en' });
  const u = store.update(r.id, { text: 'b', schedule: { kind: 'daily', at: '10:30' } });
  assert.equal(u.text, 'b');
  assert.equal(u.next_due, at(1, 10, 30));
  assert.throws(() => store.update(r.id, { text: '' }), /text/);
  assert.throws(() => store.update(r.id, { schedule: { kind: 'nope' } }), /kind/);
  assert.throws(() => store.update(999, { text: 'x' }), /not found/);
  store.close();
});

test('retention: reminders survive a MemoryStore prune (no dependency on MemoryStore)', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/main/reminders'), 'utf8');
  assert.doesNotMatch(src, /memory/i);
  const { store, clock } = make();
  const r = store.add({ text: 'keep', schedule: daily, language: 'en' });
  clock.t += 400 * 86_400_000;
  assert.equal(store.get(r.id).text, 'keep');
  store.close();
});

const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { SCHEMA_VERSION } = require('../src/main/reminders');
const tempDb = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-reminders-')); return { dir, file: path.join(dir, 'reminders.sqlite') }; };

test('an existing version-0 reminders.sqlite is upgraded in place and keeps its rows', () => {
  const { dir, file } = tempDb();
  try {
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE reminders (id INTEGER PRIMARY KEY, text TEXT NOT NULL, schedule TEXT NOT NULL, next_due INTEGER NOT NULL,
      fired_due INTEGER, snoozed_until INTEGER, created_at INTEGER NOT NULL, last_fired INTEGER,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','cancelled')), language TEXT NOT NULL DEFAULT 'en');`);
    old.prepare('INSERT INTO reminders(text, schedule, next_due, created_at) VALUES(?, ?, ?, ?)').run('water', JSON.stringify(daily), at(1), at(1, 8));
    assert.equal(old.prepare('PRAGMA user_version').get().user_version, 0);
    old.close();
    const store = new ReminderStore(file, { now: () => new Date(at(1, 8)) });
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    const row = store.list()[0];
    assert.equal(row.text, 'water');
    assert.equal(row.pending_due, null);
    assert.equal(row.ended_at, null);
    store.close();
    // Opening again is a no-op.
    const again = new ReminderStore(file);
    assert.equal(again.list().length, 1);
    again.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a fired occurrence stays pending across a reopen until Done, Snooze or a dismiss', () => {
  const { dir, file } = tempDb();
  try {
    let t = at(1, 8);
    let store = new ReminderStore(file, { now: () => new Date(t) });
    const r = store.add({ text: 'water', schedule: daily });
    const once = store.add({ text: 'call', schedule: { kind: 'once', date: '2026-06-01', at: '09:30' } });
    t = at(1, 10);
    store.markFired(r.id, at(1));
    store.markFired(once.id, at(1, 9, 30));
    store.close();
    store = new ReminderStore(file, { now: () => new Date(t) });
    assert.deepEqual(store.pending().map(p => [p.id, p.pending_due]), [[r.id, at(1)], [once.id, at(1, 9, 30)]]);
    // Only the latest occurrence of a repeating reminder is pending.
    store.markFired(r.id, at(2));
    assert.deepEqual(store.pending().map(p => [p.id, p.pending_due]), [[once.id, at(1, 9, 30)], [r.id, at(2)]]);
    store.complete(r.id, at(2));
    store.snooze(once.id, at(1, 10, 30), at(1, 9, 30));
    assert.deepEqual(store.pending(), []);
    store.markFired(once.id, at(1, 10, 30));
    assert.equal(store.acknowledge(once.id, at(1, 10, 29)), false, 'another occurrence is not acknowledged');
    assert.equal(store.acknowledge(once.id, at(1, 10, 30)), true);
    assert.deepEqual(store.pending(), []);
    store.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('cancel clears pending; prune deletes only ended reminders older than 30 days', () => {
  const { store, clock } = make();
  const a = store.add({ text: 'a', schedule: daily });
  const b = store.add({ text: 'b', schedule: { kind: 'once', date: '2026-06-01', at: '09:30' } });
  const c = store.add({ text: 'c', schedule: daily });
  const d = store.add({ text: 'd', schedule: { kind: 'once', date: '2026-06-01', at: '09:40' } });
  clock.t = at(1, 10);
  store.markFired(a.id, at(1));
  store.cancel(a.id);
  assert.equal(store.get(a.id).pending_due, null);
  store.markFired(b.id, at(1, 9, 30));
  store.complete(b.id, at(1, 9, 30));
  store.markFired(d.id, at(1, 9, 40)); // done, but still waiting for the user
  clock.t = at(30, 10);
  assert.equal(store.prune(), 0, 'not 30 days yet');
  clock.t = at(1, 10) + 31 * 24 * 3600000;
  assert.equal(store.prune(), 2);
  assert.equal(store.get(a.id), null);
  assert.equal(store.get(b.id), null);
  assert.equal(store.get(c.id).status, 'active');
  assert.equal(store.get(d.id).status, 'done', 'a pending one is kept');
});

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

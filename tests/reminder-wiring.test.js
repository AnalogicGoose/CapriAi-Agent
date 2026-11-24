'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ReminderStore } = require('../src/main/reminders');
const { ReminderController, snoozeUntil, WINDOW_MS } = require('../src/main/reminder-controller');
const { routeReminderCommand } = require('../src/main/reminder-commands');
const { CodexTools } = require('../src/main/codex-tools');
const { DISPLAY_NAME } = require('../src/main/identity');

const at = (d, h = 9, m = 0) => new Date(2026, 10, d, h, m).getTime();
const OVERLAY = { id: 'overlay' };

function rig({ fullscreen = false, gaming = false, voiceOn = true, overlayAvailable = true, ready = true } = {}) {
  let clock = at(23, 9);
  const store = new ReminderStore(':memory:', { now: () => new Date(clock) });
  const state = { fullscreen, gaming, voiceOn, overlayAvailable };
  const sent = [], grants = [], windows = [];
  const controller = new ReminderController({ store, lang: () => 'en', state: () => ({ ...state }),
    send: payload => sent.push(payload), grant: text => { grants.push(text); return `grant-${grants.length}`; },
    openWindow: ms => windows.push(ms), isOverlay: sender => sender === OVERLAY, now: () => clock });
  if (ready) controller.setReady(true);
  return { store, state, sent, grants, windows, controller, tick: ms => { clock += ms; }, now: () => clock };
}
const fireOnce = (r, text = 'stretch', due = at(23, 9)) => {
  const row = r.store.add({ text, schedule: { kind: 'once', date: '2026-11-23', at: '09:05' } });
  r.controller.fire(row, { missed: false, firedDue: due });
  r.store.markFired(row.id, due);
  return row;
};

test('snooze tomorrow means 09:00 next local day', () => {
  assert.equal(snoozeUntil('tomorrow', new Date(2026, 10, 23, 22, 45).getTime()), at(24, 9));
  assert.equal(snoozeUntil('tomorrow', new Date(2026, 10, 30, 0, 10).getTime()), new Date(2026, 11, 1, 9, 0).getTime());
  assert.equal(snoozeUntil(10, at(23, 9)), at(23, 9, 10));
  for (const bad of [0, -5, NaN, Infinity, '10', null, undefined, 7 * 24 * 60 + 1, 'later']) assert.equal(snoozeUntil(bad, at(23)), null, String(bad));
  assert.equal(snoozeUntil(7 * 24 * 60, at(23)), at(30));
});

test('actions from a non-overlay sender are rejected', () => {
  const r = rig();
  const row = fireOnce(r);
  const card = r.sent.find(p => p.type === 'card');
  assert.equal(r.controller.ipcAction({ id: 'other' }, row.id, 'snooze', card.firedDue, 10).ok, false);
  assert.equal(r.store.get(row.id).status, 'done');
  r.controller.shown({ id: 'other' }, row.id, card.firedDue);
  assert.deepEqual(r.windows, []);
  // invalid arguments and cards it never sent are rejected too
  assert.equal(r.controller.ipcAction(OVERLAY, row.id, 'delete', card.firedDue).ok, false);
  assert.equal(r.controller.ipcAction(OVERLAY, row.id, 'snooze', card.firedDue, -1).ok, false);
  assert.equal(r.controller.ipcAction(OVERLAY, row.id, 'snooze', card.firedDue + 1, 10).ok, false);
  assert.equal(r.controller.ipcAction(OVERLAY, 999, 'done', card.firedDue).ok, false);
  const ok = r.controller.ipcAction(OVERLAY, row.id, 'snooze', card.firedDue, 10);
  assert.equal(ok.ok, true);
  assert.match(ok.text, /09:10/);
  const after = r.store.get(row.id);
  assert.equal(after.status, 'active');
  assert.equal(after.snoozed_until, at(23, 9, 10));
  // a card is acted on once
  assert.equal(r.controller.ipcAction(OVERLAY, row.id, 'done', card.firedDue).ok, false);
});

test('a reminder firing during fullscreen speaks with a grant and shows its card after fullscreen ends', () => {
  const r = rig({ fullscreen: true });
  const row = fireOnce(r);
  assert.deepEqual(r.sent.map(p => p.type), ['speak']);
  assert.equal(r.sent[0].line, 'Reminder, sweetheart: stretch');
  assert.equal(r.sent[0].grant, 'grant-1');
  assert.deepEqual(r.grants, [r.sent[0].line]);
  assert.ok(!/capri/i.test(r.sent[0].line));
  assert.deepEqual(r.windows, [], 'voice-only delivery opens no command window');
  r.controller.flush();
  assert.equal(r.sent.length, 1, 'still fullscreen: held');
  r.state.fullscreen = false;
  r.controller.flush();
  const card = r.sent[1];
  assert.equal(card.type, 'card');
  assert.equal(card.id, row.id);
  assert.equal(card.speak, undefined, 'already spoken');
  assert.deepEqual(card.actions.map(a => a.id), ['done', 'snooze10', 'snooze']);
  assert.ok(card.actions.every(a => a.label && !/capri/i.test(a.label)));
  assert.ok(card.snooze.every(a => a.label) && card.snooze.map(a => a.minutes).join() === '15,60,tomorrow');
  r.controller.flush();
  assert.equal(r.sent.length, 2, 'flushed once');
  r.controller.shown(OVERLAY, card.id, card.firedDue);
  assert.deepEqual(r.windows, [WINDOW_MS]);
});

test('voice-off fullscreen holds silently; gaming off flushes; more than five collapse into a summary card', () => {
  const r = rig({ gaming: true, voiceOn: false });
  for (let i = 0; i < 7; i++) fireOnce(r, `task ${i}`, at(23, 9) + i);
  assert.deepEqual(r.sent, []);
  assert.deepEqual(r.grants, []);
  r.state.gaming = false;
  r.controller.flush();
  assert.deepEqual(r.sent.map(p => p.type), ['card', 'card', 'card', 'card', 'more']);
  assert.match(r.sent[4].line, /3/);
});

test('normal delivery shows a speaking card; the window opens only when the card is shown', () => {
  const r = rig();
  const row = fireOnce(r);
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].type, 'card');
  assert.equal(r.sent[0].speak, true);
  assert.equal(r.sent[0].grant, 'grant-1');
  assert.deepEqual(r.windows, []);
  r.controller.shown(OVERLAY, row.id, r.sent[0].firedDue + 5); // not a card it sent
  assert.deepEqual(r.windows, []);
  r.controller.shown(OVERLAY, row.id, r.sent[0].firedDue);
  assert.deepEqual(r.windows, [WINDOW_MS]);
});

test('a renderer that is not ready holds the card and speaks it on flush', () => {
  const r = rig({ ready: false });
  fireOnce(r);
  assert.deepEqual(r.sent, []);
  r.controller.setReady(true);
  assert.equal(r.sent[0].type, 'card');
  assert.equal(r.sent[0].speak, true);
  r.controller.setReady(false);
});

test('voice done applies to the last shown card only within 30 s', () => {
  const r = rig();
  const daily = r.store.add({ text: 'water', schedule: { kind: 'daily', at: '09:00' } });
  r.tick(60000);
  r.controller.fire(daily, { missed: false, firedDue: at(23, 9) });
  r.store.markFired(daily.id, at(23, 9));
  const first = fireOnce(r, 'stretch', at(23, 9, 1));
  // nothing shown yet: no target
  assert.equal(r.controller.voice({ command: 'done' }), false);
  r.controller.shown(OVERLAY, daily.id, at(23, 9));
  r.controller.shown(OVERLAY, first.id, at(23, 9, 1));
  assert.equal(r.controller.voice({ command: 'next' }), false);
  r.tick(WINDOW_MS + 1);
  assert.equal(r.controller.voice({ command: 'done' }), false, 'window over');
  r.controller.shown(OVERLAY, daily.id, at(23, 9)); // shown again (e.g. re-sent): latest is the daily one
  assert.equal(r.controller.voice({ command: 'done' }), true);
  assert.equal(r.store.get(daily.id).fired_due, null, 'current occurrence completed');
  assert.equal(r.store.get(daily.id).status, 'active', 'series continues');
  const resolved = r.sent.at(-1);
  assert.equal(resolved.type, 'resolved');
  assert.equal(resolved.id, daily.id);
  assert.equal(r.controller.voice({ command: 'done' }), false, 'acted on once');
});

test('voice snooze defaults to 10 minutes and accepts tomorrow; invalid minutes are rejected', () => {
  const r = rig();
  const row = fireOnce(r);
  r.controller.shown(OVERLAY, row.id, at(23, 9));
  assert.equal(r.controller.voice({ command: 'snooze', minutes: 99999 }), true, 'handled, but rejected');
  assert.equal(r.store.get(row.id).status, 'done');
  assert.equal(r.controller.voice({ command: 'snooze', minutes: 'tomorrow' }), true);
  assert.equal(r.store.get(row.id).snoozed_until, at(24, 9));
  const other = fireOnce(r, 'tea', at(23, 9, 2));
  r.controller.shown(OVERLAY, other.id, at(23, 9, 2));
  assert.equal(r.controller.voice({ command: 'snooze' }), true);
  assert.equal(r.store.get(other.id).snoozed_until, r.now() + 10 * 60000);
});

test('/remind done on a repeating reminder that has not fired is honest', () => {
  const store = new ReminderStore(':memory:', { now: () => new Date(at(23, 8)) });
  store.add({ text: 'water', schedule: { kind: 'daily', at: '09:00' } });
  const reply = routeReminderCommand('/remind done 1', store, 'en');
  assert.match(reply.text, /nothing to complete/i);
  assert.ok(!/done, nice/i.test(reply.text));
  for (const lang of ['es', 'fr', 'pt', 'ru']) assert.notEqual(routeReminderCommand('/remind done 1', store, lang).text, reply.text);
  store.markFired(1, at(23, 9));
  assert.match(routeReminderCommand('/remind done 1', store, 'en').text, /water/);
});

test('the wake-word strip uses the display name', () => {
  const store = new ReminderStore(':memory:', { now: () => new Date(at(23, 8)) });
  assert.equal(routeReminderCommand(`hey ${DISPLAY_NAME}, what are my reminders?`, store, 'en').handled, true);
  assert.equal(routeReminderCommand(`${DISPLAY_NAME} what are my reminders`, store, 'en').handled, true);
});

test('capri_reminder update/cancel on a non-active reminder returns an error', async () => {
  const store = new ReminderStore(':memory:', { now: () => new Date(at(23, 8)) });
  const tools = new CodexTools({ settings: () => ({ lang: 'en' }), reminders: store });
  const row = store.add({ text: 'x', schedule: { kind: 'once', date: '2026-11-24', at: '10:00' } });
  store.cancel(row.id);
  const call = args => tools.run('capri_reminder', { operation: 'list', id: 0, text: '', schedule: '', requestEvidence: 'change reminder 1 to 11:00', ...args },
    { text: 'change reminder 1 to 11:00', check: () => {}, signal: new AbortController().signal });
  assert.match((await call({ operation: 'update', id: row.id, schedule: JSON.stringify({ kind: 'daily', at: '11:00' }) })).error, /active/);
  assert.match((await call({ operation: 'cancel', id: row.id })).error, /active/);
  assert.equal(store.get(row.id).status, 'cancelled');
});

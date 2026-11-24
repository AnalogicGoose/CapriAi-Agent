'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const uri = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const load = async () => (await import(uri(fs.readFileSync(path.join(__dirname, '../src/renderer/js/reminder-cards.js'), 'utf8')))).ReminderCards;

// A small panel with the real contract: say() replaces (onLeave 'replaced'), hide(reason) calls onLeave(reason).
class FakePanel {
  constructor() { this.current = null; this.accept = true; this.said = []; this.activity = ''; }
  get visible() { return Boolean(this.current); }
  say(msg) {
    if (!this.accept) return false;
    const cur = this.current; this.current = { ...msg }; this.said.push(this.current);
    cur?.onLeave?.('replaced');
    return true;
  }
  hide(reason) { const gone = this.current; this.current = null; gone?.onLeave?.(reason); }
  setActions(actions, onAction) { this.current.actions = actions; this.current.onAction = onAction; }
  setActivity(text) { this.activity = text; }
}

const card = (id, extra = {}) => ({ type: 'card', id, firedDue: 1000 + id, line: `Reminder, sweetheart: task ${id}`,
  actions: [{ id: 'done', label: 'Done' }, { id: 'snooze10', label: 'Snooze 10 min' }, { id: 'snooze', label: 'Snooze…' }],
  snooze: [{ minutes: 15, label: '15 min' }, { minutes: 60, label: '1 h' }, { minutes: 'tomorrow', label: 'Tomorrow 9:00' }],
  failed: 'Sorry, I couldn’t do that. Try again?', ...extra });

async function rig() {
  const ReminderCards = await load();
  const panel = new FakePanel(), timers = [], shown = [], actions = [], spoken = [];
  let blocked = false, reply = { ok: true, text: 'Done, nice work.' };
  const host = { reminderShown: (id, due) => shown.push([id, due]),
    reminderAction: async (...args) => { actions.push(args); return reply; } };
  const cards = new ReminderCards({ panel, host, blocked: () => blocked, speak: (line, grant) => spoken.push([line, grant]),
    setTimer: fn => { timers.push(fn); return timers.length; }, clearTimer: () => {} });
  const runTimers = () => { const due = timers.splice(0); due.forEach(fn => fn()); };
  return { cards, panel, shown, actions, spoken, runTimers,
    block: on => { blocked = on; }, reply: r => { reply = r; } };
}

test('cards wait while a chat, call or permission prompt has her attention', async () => {
  const r = await rig();
  r.block(true);
  r.cards.receive(card(1, { speak: true, grant: 'g1' }));
  assert.equal(r.panel.current, null);
  assert.deepEqual(r.spoken, [['Reminder, sweetheart: task 1', 'g1']], 'the voice line is not held');
  assert.deepEqual(r.shown, []);
  r.runTimers();
  assert.equal(r.panel.current, null, 'still blocked: retried later');
  r.block(false);
  r.runTimers();
  assert.equal(r.panel.current.reminder.id, 1);
  assert.equal(r.panel.current.kind, 'alert');
  assert.deepEqual(r.shown, [[1, 1001]]);
});

test('a displaced, cleared or timed-out card comes back and is reported shown again; dismissed it does not', async () => {
  const r = await rig();
  r.cards.receive(card(1));
  r.panel.say({ kind: 'alert', line: 'Permission needed' }); // displaces it
  assert.equal(r.panel.current.reminder, undefined);
  r.runTimers();
  assert.equal(r.panel.current.line, 'Permission needed', 'waits for an empty panel; no ping-pong');
  r.panel.hide('cleared');
  r.runTimers();
  assert.equal(r.panel.current.reminder.id, 1);
  assert.deepEqual(r.shown, [[1, 1001], [1, 1001]]);
  r.panel.hide('cleared'); // clearKind('alert') after a prompt is answered
  r.runTimers();
  assert.equal(r.panel.current.reminder.id, 1, 're-shown after clearKind');
  assert.equal(r.panel.current.hold, null, 'a reminder card has no timeout');
  r.panel.hide('timeout');
  r.runTimers();
  assert.equal(r.panel.current.reminder.id, 1, 'a timeout never drops it: shown again');
  r.panel.hide('user');
  await Promise.resolve(); await Promise.resolve();
  r.runTimers();
  assert.equal(r.panel.current, null, 'dismissed by the user: gone');
  assert.deepEqual(r.actions, [[1, 'dismiss', 1001]], 'main is told, so it is no longer pending');
  assert.equal(r.cards.queue.length, 0);
});

test('a permanent action error resolves the card as gone; a resolved message may carry no line', async () => {
  const r = await rig();
  r.cards.receive(card(1)); r.cards.receive(card(2));
  r.reply({ ok: false, gone: true, error: 'That reminder card is no longer open.' });
  await r.panel.current.onAction('done');
  assert.equal(r.panel.current.reminder.id, 2, 'card 1 is gone, not stuck on try again');
  r.cards.receive({ type: 'resolved', id: 2, firedDue: 1002 });
  r.runTimers();
  assert.equal(r.panel.current, null);
  assert.equal(r.cards.queue.length, 0);
});

test('a refused say keeps the card queued and retries', async () => {
  const r = await rig();
  r.panel.accept = false;
  r.cards.receive(card(1));
  assert.equal(r.cards.queue.length, 1);
  r.panel.accept = true;
  r.runTimers();
  assert.equal(r.panel.current.reminder.id, 1);
});

test('buttons act once; snooze opens its presets; a failed action keeps the card with a short line', async () => {
  const r = await rig();
  r.cards.receive(card(1)); r.cards.receive(card(2));
  r.reply({ ok: false, error: 'Reminder storage is unavailable.' });
  r.panel.current.onAction('snooze');
  assert.deepEqual(r.panel.current.actions.map(a => a.label), ['15 min', '1 h', 'Tomorrow 9:00']);
  await r.panel.current.onAction('s2');
  assert.deepEqual(r.actions.at(-1), [1, 'snooze', 1001, 'tomorrow']);
  assert.equal(r.panel.current.reminder.id, 1, 'kept after failure');
  assert.equal(r.panel.activity, 'Sorry, I couldn’t do that. Try again?');
  assert.deepEqual(r.panel.current.actions.map(a => a.id), ['done', 'snooze10', 'snooze'], 'back on its main buttons');
  r.reply({ ok: true, text: 'Done, nice work.' });
  await r.panel.current.onAction('done');
  assert.deepEqual(r.actions.at(-1), [1, 'done', 1001, undefined]);
  assert.equal(r.panel.current.reminder.id, 2, 'next card shows; card 1 is not re-queued');
  r.runTimers();
  assert.equal(r.panel.current.reminder.id, 2);
  r.reply({ ok: false, gone: true, text: 'That one already moved on to its next time, so there was nothing to mark done.' });
  await r.panel.current.onAction('done');
  assert.match(r.panel.current.line, /moved on/, 'superseded: honest line, card gone');
  r.runTimers();
  assert.equal(r.cards.queue.length, 0);
});

test('a voice reply resolves the open card and shows her acknowledgement', async () => {
  const r = await rig();
  r.cards.receive(card(1));
  r.cards.receive({ type: 'resolved', id: 1, firedDue: 1001, line: 'Okay, I’ll remind you again at 09:10.' });
  assert.match(r.panel.current.line, /09:10/);
  r.runTimers();
  assert.equal(r.cards.queue.length, 0);
  assert.equal(r.panel.current.reminder, undefined);
  // malformed messages are ignored
  r.cards.receive({ type: 'card', id: 'x', firedDue: 1, line: 'x', actions: [], snooze: [] });
  r.cards.receive({ type: 'card', id: 3, firedDue: 1, line: 'x'.repeat(401), actions: [], snooze: [] });
  assert.equal(r.cards.queue.length, 0);
});

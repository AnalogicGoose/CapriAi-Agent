'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CodexTools } = require('../src/main/codex-tools');
const { ReminderStore } = require('../src/main/reminders');
const { routeReminderCommand, REMINDER_INSTRUCTIONS } = require('../src/main/reminder-commands');

const NOW = new Date(2026, 10, 23, 9, 0);
const store = () => new ReminderStore(':memory:', { now: () => NOW });
const tools = (reminders, lang = 'en') => new CodexTools({ settings: () => ({ lang }), reminders });
const ctx = text => ({ text, check: () => {}, signal: new AbortController().signal });
const ONCE = JSON.stringify({ kind: 'once', date: '2026-11-24', at: '15:30' });
const call = (t, args, text) => t.run('stella_reminder', { operation: 'list', id: 0, text: '', schedule: '', requestEvidence: text, ...args }, ctx(text));

test('add through the tool returns the exact next local time and repeat label', async () => {
  const s = store();
  const t = tools(s, 'es');
  const result = await call(t, { operation: 'add', text: 'llamar a mamá', schedule: ONCE }, 'recuérdame llamar a mamá mañana a las 15:30');
  assert.deepEqual(result, { id: 1, text: 'llamar a mamá', next: '2026-11-24 15:30', repeat: 'Una vez el 2026-11-24 a las 15:30' });
  assert.equal(s.list().length, 1);
  const moved = await call(t, { operation: 'update', id: 1, schedule: JSON.stringify({ kind: 'daily', at: '08:05' }) }, 'cámbialo a cada día a las 8:05');
  assert.equal(moved.next, '2026-11-24 08:05');
  assert.equal(moved.repeat, 'Cada día a las 08:05');
  assert.deepEqual((await call(t, { operation: 'list' }, 'list')).reminders.map(r => r.id), [1]);
  assert.equal((await call(t, { operation: 'cancel', id: 1 }, 'cancel reminder 1')).cancelled, true);
  assert.equal(s.list().length, 0);
});

test('invalid schedule JSON returns a plain error, not a crash', async () => {
  const t = tools(store());
  const bad = await call(t, { operation: 'add', text: 'x', schedule: '{nope' }, 'remind me to x tomorrow');
  assert.match(bad.error, /schedule/i);
  const past = await call(t, { operation: 'add', text: 'x', schedule: JSON.stringify({ kind: 'once', date: '2020-01-01', at: '10:00' }) }, 'remind me to x');
  assert.match(past.error, /schedule/i);
  assert.match((await call(t, { operation: 'cancel', id: 99 }, 'cancel reminder 99')).error, /99/);
});

test('hypothetical or negated requests cannot create or cancel reminders', async () => {
  const s = store();
  const t = tools(s);
  await assert.rejects(call(t, { operation: 'add', text: 'x', schedule: ONCE }, "don't remind me to x"), /not to take/);
  await assert.rejects(call(t, { operation: 'add', text: 'x', schedule: ONCE }, 'what happens if you remind me to x?'));
  assert.equal(s.list().length, 0);
  // reading needs no action evidence
  assert.deepEqual((await call(t, { operation: 'list' }, 'what are my reminders?')).reminders, []);
});

test('stella_reminder is offered only with a store', () => {
  assert.ok(!tools(undefined).specs().some(row => row.name === 'stella_reminder'));
  assert.ok(tools(store()).specs().some(row => row.name === 'stella_reminder'));
  assert.ok(tools(store()).instructions().includes(REMINDER_INSTRUCTIONS));
  assert.ok(!tools(undefined).instructions().includes(REMINDER_INSTRUCTIONS));
});

test('offline list, cancel and done work without Codex in five languages', () => {
  const asks = { en: 'what are my reminders?', es: '¿qué recordatorios tengo?', fr: 'quels sont mes rappels', pt: 'quais são meus lembretes', ru: 'какие у меня напоминания' };
  for (const lang of Object.keys(asks)) {
    const s = store();
    assert.equal(routeReminderCommand(asks[lang], s, lang).handled, true);
    s.add({ text: 'tea', schedule: JSON.parse(ONCE) });
    s.add({ text: 'walk', schedule: { kind: 'daily', at: '18:00' } });
    const listed = routeReminderCommand(asks[lang], s, lang);
    assert.match(listed.text, /tea/); assert.match(listed.text, /2026-11-24 15:30/); assert.match(listed.text, /walk/);
    assert.equal(routeReminderCommand('/remind list', s, lang).text, listed.text);
    const done = routeReminderCommand('/remind done 1', s, lang);
    assert.match(done.text, /tea/); assert.equal(s.get(1).status, 'done');
    const cancelled = routeReminderCommand('/remind cancel 2', s, lang);
    assert.match(cancelled.text, /walk/); assert.equal(s.get(2).status, 'cancelled');
    assert.match(routeReminderCommand('/remind cancel 2', s, lang).text, /2/);
    assert.ok(!/stella/i.test(listed.text + done.text + cancelled.text));
  }
  const s = store();
  assert.equal(routeReminderCommand('open spotify', s, 'en'), null);
  assert.equal(routeReminderCommand('remind me to call mom', s, 'en'), null);
  assert.equal(routeReminderCommand("what's the weather", s, 'en'), null);
  assert.match(routeReminderCommand('/remind cancel', s, 'en').text, /\/remind/);
});

test('stella_reminder description and instruction stay within budget', () => {
  const spec = tools(store()).specs().find(row => row.name === 'stella_reminder');
  assert.ok(Buffer.byteLength(spec.description) <= 500, `${Buffer.byteLength(spec.description)} bytes`);
  assert.ok(Buffer.byteLength(REMINDER_INSTRUCTIONS) <= 200, `${Buffer.byteLength(REMINDER_INSTRUCTIONS)} bytes`);
});

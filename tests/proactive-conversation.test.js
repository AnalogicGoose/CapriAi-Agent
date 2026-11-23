'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ProactiveConversation, validate } = require('../src/main/proactive-conversation');
const { InitiativeTrial } = require('../src/main/initiative-trial');
const { DatabaseSync } = require('node:sqlite');
const { packConversation } = require('../src/main/conversation-context');
const { CHARACTER_VOICE, PERSONALITY_SUMMARY } = require('../src/main/personality');
const { registry } = require('../src/main/capabilities');
function fixture(t, options = {}) {
  let now = 1_000_000, state, cfg = { lang: 'en', privacy: { memoryEnabled: true } }, free = true;
  let calls = [], notifications = [], observed = 0, recalls = 0, count = 0;
  let infer = async () => JSON.stringify({ speak: true, message: `Fresh thought number ${++count}: what imaginary invention would you build?` });
  const journal = { conversationState(value) { if (value !== undefined) state = structuredClone(value); return state; },
    allowed: () => true, list: () => [{ id: 5, created_at: 10, status: 'open', next_step: 'ask_later', subject: 'code', question: 'Would a second pair of eyes help?' }] };
  const dependencies = { journal, settings: () => cfg, now: () => now, random: () => 0,
    observe: async () => { observed++; return { foreground: { app: 'Code', title: 'An untrusted window title' } }; },
    memories: () => { recalls++; return [{ id: 9, text: 'I like making games.' }]; },
    models: async () => ['qwen3.5:9b'], infer: async request => { calls.push(request); return infer(request); },
    canRun: () => free, notify: text => { notifications.push(text); return true; }, ...options };
  let engine = new ProactiveConversation(dependencies);
  t.after(() => engine.close());
  return { get engine() { return engine; }, calls, notifications,
    get observed() { return observed; }, get recalls() { return recalls; }, get state() { return state; },
    advance(ms = 5 * 60_000) { now += ms; }, config(value) { cfg = value; }, free(value) { free = value; },
    infer(value) { infer = value; }, restart() { engine.close(); engine = new ProactiveConversation(dependencies); } };
}
const source = request => JSON.parse(request.messages[1].content).selected.source;
test('quiet trial uses its own cadence, blocks delivery, and stays quiet after the deadline', async t => {
  const db = new DatabaseSync(':memory:');
  let now = 1_000_000, calls = 0, notified = 0, warmed = 0, changed = 0, available = true;
  const trial = new InitiativeTrial(db, () => now);
  const make = () => new ProactiveConversation({
    now: () => now, random: () => 0, trial,
    journal: { conversationState() {}, allowed: () => false },
    settings: () => ({ proactiveVoice: true, privacy: { contextForeground: false, contextEvents: false } }),
    interests: { pending: () => true, advance() { changed++; }, candidates: () => [], progress: () => [] },
    models: async () => ['qwen3.5:9b'],
    infer: async () => { calls++; return JSON.stringify({ speak: true, message: 'Would you design a miniature windmill?' }); },
    canRun: () => available, warmVoice() { warmed++; },
    notify() { notified++; return true; },
  });
  let engine = make();
  t.after(() => { engine.close(); db.close(); });
  assert.ok(trial.start());
  assert.equal(await engine.run(), false);
  now += 5 * 60_000;
  available = false;
  assert.equal(await engine.run(), false);
  assert.equal(trial.decisions()[0].outcome, 'blocked');
  available = true;
  engine.close();
  engine = make();
  now += 5 * 60_000;
  assert.equal(await engine.run(), false);
  const proposed = trial.decisions()[0];
  assert.equal(proposed.outcome, 'proposed');
  assert.equal(proposed.model_calls, 1);
  assert.match(proposed.reason, /conversation starter/);
  assert.equal(notified + warmed + changed, 0);
  assert.ok(trial.rate(proposed.id, 'bad-timing'));
  assert.equal(trial.extraDelay(), 5 * 60_000);
  now = trial.status().endsAt;
  assert.equal(trial.status().phase, 'review');
  assert.equal(await engine.run(), false);
  assert.equal(calls, 1);
  assert.ok(trial.resume());
  assert.equal(await engine.run(), true);
  assert.equal(notified, 1);
  assert.match(engine.explain('Why did you bring that up?').text, /conversation starter/);
});

test('switching to a quiet trial cancels a pending live check-in before it can deliver', async t => {
  const db = new DatabaseSync(':memory:');
  let now = 2_000_000, finish;
  const trial = new InitiativeTrial(db, () => now);
  const f = fixture(t, { trial, now: () => now });
  t.after(() => db.close());
  f.infer(() => new Promise(resolve => { finish = resolve; }));
  now += 5 * 60_000;
  const work = f.engine.run();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  trial.start();
  finish(JSON.stringify({ speak: true, message: 'A proposed check-in.' }));
  assert.equal(await work, false);
  assert.deepEqual(f.notifications, []);
});
test('waits 5–15 minutes, reserves each opportunity durably and has no restart burst', async t => {
  const f = fixture(t);
  assert.equal(f.engine.status().nextAt, 1_300_000);
  assert.equal(await f.engine.run(), false); assert.equal(f.calls.length, 0);
  f.advance(); assert.equal(await f.engine.run(), true);
  assert.ok(f.calls[0].messages[0].content.includes(CHARACTER_VOICE),
    'Spontaneous conversation must receive the same character voice as foreground chat.');
  assert.equal(registry().personality, PERSONALITY_SUMMARY);
  assert.equal(await f.engine.run(), false); assert.equal(f.calls.length, 1);
  const due = f.state.nextAt; f.restart(); assert.equal(f.engine.status().nextAt, due);
  f.advance(60 * 60_000); f.restart();
  assert.equal(await f.engine.run(), false);
  const slow = fixture(t, { random: () => 1 });
  assert.equal(slow.engine.status().nextAt, 1_900_000);
});
test('rotates activity, permitted memory, open inquiry and smalltalk', async t => {
  const f = fixture(t);
  // Distinct output is needed; topic-level deduplication is separate from text deduplication.
  const messages = ['Code is on screen. Building something interesting?', 'Still enjoying making games?',
    'Would you like a second pair of eyes, or just company?', 'Imagine a city where every door leads to a different season.'];
  f.infer(async () => JSON.stringify({ speak: true, message: messages.shift() }));
  for (let i = 0; i < 4; i++) { f.advance(); assert.equal(await f.engine.run(), true); }
  assert.deepEqual(f.calls.map(source), ['activity', 'memory', 'inquiry', 'smalltalk']);
  assert.equal(f.notifications.length, 4);
  assert.doesNotMatch(JSON.stringify(f.state), /Code|making games|eyes|city|untrusted window/i);
});
test('uses general curiosity with context and memory disabled without reading either source', async t => {
  const f = fixture(t, { journal: { conversationState: () => null, allowed: () => false, list: () => { throw Error('must not read'); } } });
  f.config({ privacy: { contextForeground: false, contextEvents: false, memoryEnabled: false } });
  f.advance(); assert.equal(await f.engine.run(), true);
  assert.equal(source(f.calls[0]), 'smalltalk');
  assert.equal(f.observed, 0); assert.equal(f.recalls, 0);
});
test('quiet topics stay out of proactive prompts and unsolicited replies', async t => {
  const f = fixture(t, { canBringUp: text => !/making games|black clover/i.test(text), quietTopics: () => ['anime'] });
  f.config({ privacy: { memoryEnabled: true, contextEvents: false } });
  f.infer(async () => JSON.stringify({ speak: true, message: 'Did you see Black Clover?' }));
  f.advance();
  assert.equal(await f.engine.run(), false);
  const request = JSON.parse(f.calls[0].messages.at(-1).content);
  assert.equal(request.selected.source, 'inquiry');
  assert.deepEqual(request.quietTopics, ['anime']);
  assert.deepEqual(f.notifications, []);
});
test('does not interrupt busy, hidden, gaming, disabled or unavailable sessions', async t => {
  const f = fixture(t); f.advance(); f.free(false);
  assert.equal(await f.engine.run(), false); f.free(true);
  for (const cfg of [{ gamingMode: true }, { visible: false }, { proactiveEnabled: false }, { agentEnabled: false }]) {
    f.config(cfg); assert.equal(await f.engine.run(), false);
  }
  assert.equal(f.calls.length, 0); assert.equal(f.observed, 0);
});
test('never reads disabled memory recall or window titles', async t => {
  const f = fixture(t); f.config({ privacy: { memoryEnabled: true, memoryRecall: false, contextTitles: false } });
  f.advance(); assert.equal(await f.engine.run(), true);
  assert.equal(f.recalls, 0);
  assert.equal(JSON.parse(f.calls[0].messages[1].content).selected.title, '');
});
test('interaction cancels late results and resets the next opportunity', async t => {
  const f = fixture(t); let finish;
  f.infer(() => new Promise(resolve => { finish = resolve; }));
  f.advance(); const work = f.engine.run(); await new Promise(resolve => setImmediate(resolve));
  f.advance(30_000); f.engine.touch();
  finish(JSON.stringify({ speak: true, message: 'This late result must never be shown.' }));
  assert.equal(await work, false); assert.equal(f.notifications.length, 0);
  assert.equal(f.engine.status().nextAt, 1_630_000);
});

test('source permission changes during collection or inference discard the pending conversation', async t => {
  for (const stage of ['collection', 'inference']) {
    let release;
    const f = fixture(t, stage === 'collection' ? { observe: () => new Promise(resolve => { release = resolve; }) } : {});
    if (stage === 'inference') f.infer(() => new Promise(resolve => { release = resolve; }));
    f.advance(); const work = f.engine.run(); await new Promise(resolve => setImmediate(resolve));
    f.config({ privacy: { contextForeground: false, memoryEnabled: false } });
    release(stage === 'collection' ? { foreground: { app: 'Code' } }
      : JSON.stringify({ speak: true, message: 'This uses a revoked source.' }));
    assert.equal(await work, false);
    assert.equal(f.notifications.length, 0);
    if (stage === 'collection') assert.equal(f.calls.length, 0);
  }
});
test('silence, malformed output and errors still wait a full new interval', async t => {
  for (const infer of [async () => '{broken', async () => JSON.stringify({ speak: false, message: '' }), async () => { throw Error('offline'); }]) {
    const f = fixture(t); f.infer(infer); f.advance();
    assert.equal(await f.engine.run(), false); assert.equal(await f.engine.run(), false);
    assert.equal(f.calls.length, 1); assert.equal(f.notifications.length, 0);
  }
});
test('suppresses repeated messages across restarts', async t => {
  const f = fixture(t);
  f.infer(async () => JSON.stringify({ speak: true, message: 'Have you made anything fun lately?' }));
  f.advance(); assert.equal(await f.engine.run(), true);
  f.restart(); f.advance(); assert.equal(await f.engine.run(), false);
  assert.equal(f.notifications.length, 1);
});
test('a fresh PC return can start an optional spoken check-in before the usual cadence', async t => {
  const deliveries = [];
  const f = fixture(t, { notify: (text, options) => { deliveries.push({ text, ...options }); } });
  f.config({ proactiveVoice: true, ttsEnabled: true });
  f.engine.observeIdle(0);
  assert.equal(await f.engine.run(), false);
  f.engine.observeIdle(300);
  f.engine.observeIdle(1);
  assert.equal(await f.engine.run(), true);
  const { selected } = JSON.parse(f.calls[0].messages.at(-1).content);
  assert.equal(selected.source, 'return');
  assert.equal(f.observed, 0); assert.equal(f.recalls, 0);
  assert.equal(deliveries[0].voiceUntil, 1_030_000);
  f.restart();
  f.engine.observeIdle(600); f.engine.observeIdle(0);
  assert.equal(await f.engine.run(), false);
  assert.equal(deliveries.length, 1);
});

test('disabled voice, busy state, and an expired PC return do not start an early check-in', async t => {
  const f = fixture(t);
  f.engine.observeIdle(400); f.engine.observeIdle(1);
  assert.equal(await f.engine.run(), false);
  f.config({ proactiveVoice: true });
  f.engine.touch();
  f.engine.observeIdle(400); f.engine.observeIdle(1);
  f.free(false);
  assert.equal(await f.engine.run(), false);
  f.advance(90_000); f.free(true);
  assert.equal(await f.engine.run(), false);
  assert.equal(f.calls.length, 0);
});

test('an ordinary companion remark can be spoken and mute leaves it as text', async t => {
  const deadlines = [];
  const f = fixture(t, { notify: (_text, { voiceUntil }) => { deadlines.push(voiceUntil); } });
  f.config({ proactiveVoice: true, ttsEnabled: true, privacy: { contextEvents: false } });
  f.advance();
  assert.equal(await f.engine.run(), true);
  assert.equal(source(f.calls[0]), 'inquiry');
  f.config({ proactiveVoice: true, ttsEnabled: true, muted: true, privacy: { contextEvents: false } });
  f.infer(async () => JSON.stringify({ speak: true, message: 'What would a musical staircase sound like?' }));
  f.advance();
  assert.equal(await f.engine.run(), true);
  assert.deepEqual(deadlines, [1_330_000, 0]);
});
test('validates generated messages and preserves an opening when packing its first reply', () => {
  for (const value of [{ speak: true, message: '' }, { speak: true, message: 'x'.repeat(321) },
    { speak: true, message: 'hi', tool: 'shell' }, { speak: 'true', message: 'hi' }]) assert.throws(() => validate(value));
  const messages = [{ role: 'system', content: 'Be helpful.' },
    { role: 'assistant', content: 'What kind of game would you like to build?' }, { role: 'user', content: 'A platformer!' }];
  assert.deepEqual(packConversation(messages), messages);
});

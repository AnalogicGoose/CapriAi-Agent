'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { CompanionInterests, validate } = require('../src/main/companion-interests');
const { ProactiveConversation } = require('../src/main/proactive-conversation');
const idea = { domain: 'worldbuilding', focus: 'Map a tiny impossible city', question: 'What if its alleys changed with the weather?',
  rationale: 'A simple rule could make a playful fictional place.', continuationId: null };
const draft = { decision: 'draft', draft: 'In rain, the alleys lead to the same bakery.',
  nextStep: 'Give the bakery a reason to move at dawn.' };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capri-interests-')), file = path.join(dir, 'interests.sqlite');
  let now = new Date(2026, 10, 7, 8).getTime(), cfg = {}, db, service;
  const open = () => { db = new DatabaseSync(file); service = new CompanionInterests({ db, settings: () => cfg, now: () => now }); };
  open();
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const deps = { model: 'test', signal: new AbortController().signal, valid() {} };
  return { get service() { return service; }, deps, now: () => now, settings: () => cfg,
    config(value) { cfg = value; }, advance(ms = 86_400_000) { now += ms; }, restart() { db.close(); open(); },
    patch(value) { cfg = { ...cfg, ...value }; },
    generate(value = idea) { return service.refresh({ ...deps, infer: async () => JSON.stringify(value) }); } };
}

test('chosen interests persist and develop without equating a mention with completed work', async t => {
  const f = fixture(t); assert.equal(await f.generate(), true);
  assert.equal(f.service.list()[0].status, 'curious');
  f.service.discussed(1); f.restart();
  assert.equal(f.service.list()[0].mentions, 1); assert.equal(f.service.list()[0].status, 'exploring');
  assert.deepEqual(f.service.candidates(), []);
  f.advance(6 * 3_600_000); assert.equal(f.service.candidates().length, 1);
  f.advance();
  assert.equal(await f.generate({ ...idea, continuationId: 1, question: 'Could the city use one moving bridge?' }), true);
  assert.equal(f.service.context()[0].question, 'Could the city use one moving bridge?');
  assert.equal(f.service.list()[0].mentions, 1);
  assert.match(f.service.context()[0].note, /does not establish subjective experience/);
});

test('daily attempts survive restart, malformed output and clearing without a burst', async t => {
  const f = fixture(t); let calls = 0;
  const infer = async () => { calls++; return 'broken'; };
  assert.equal(await f.service.refresh({ ...f.deps, infer }), false);
  f.restart(); f.service.route('/interests clear', f.patch);
  assert.equal(await f.service.refresh({ ...f.deps, infer }), false);
  f.advance(15 * 3_600_000); assert.equal(await f.generate(), false);
  f.advance(9 * 3_600_000); assert.equal(await f.generate(), true);
  assert.equal(calls, 1);
});

test('user pauses, dismissals and resolutions are not overwritten or revived', async t => {
  const f = fixture(t); await f.generate();
  f.service.route('/interests pause 1', f.patch); assert.deepEqual(f.service.context(), []);
  f.advance(); assert.equal(await f.generate({ ...idea, continuationId: 1 }), false);
  f.service.route('/interests resume 1', f.patch); assert.equal(f.service.context().length, 1);
  f.service.route('/interests dismiss 1', f.patch); f.advance(31 * 86_400_000);
  assert.equal(await f.generate(), false);
  assert.equal(f.service.list()[0].status, 'dismissed');
  assert.match(f.service.route('/interests resume 1', f.patch).text, /Only paused/);
});

test('an in-flight generation cannot repopulate cleared interests or bypass the off switch', async t => {
  const f = fixture(t); let finish;
  const pending = f.service.refresh({ ...f.deps, infer: () => new Promise(resolve => { finish = resolve; }) });
  f.service.route('/interests clear', f.patch); finish(JSON.stringify(idea));
  assert.equal(await pending, false); assert.deepEqual(f.service.list(), []);
  f.advance(); f.service.route('/interests off', f.patch);
  assert.equal(await f.generate(), false); assert.deepEqual(f.service.context(), []);
  f.service.route('/interests on', f.patch); assert.equal(await f.generate(), true);
  f.config({ gamingMode: true }); assert.deepEqual(f.service.context(), []);
});

test('shared context inspires interests and changes invalidate an in-flight choice', async t => {
  const f = fixture(t);
  let context = { project: 'Orbit game', preferences: ['I like rhythm games'] }, complete;
  const run = f.service.refresh({ ...f.deps, sharedContext: () => context, infer: request => {
    assert.deepEqual(JSON.parse(request.messages.at(-1).content).sharedContext, context);
    return new Promise(resolve => { complete = resolve; });
  } });
  context = null;
  complete(JSON.stringify(idea));
  assert.equal(await run, false);
  assert.deepEqual(f.service.list(), []);
});

test('at most three active interests fit bounded context; continuation cannot switch domains', async t => {
  const f = fixture(t);
  for (const domain of ['worldbuilding', 'game-design', 'visual-art']) { assert.equal(await f.generate({ ...idea, domain }), true); f.advance(); }
  assert.equal(await f.generate({ ...idea, domain: 'everyday-science' }), false);
  f.advance(); assert.equal(await f.generate({ ...idea, domain: 'game-design', continuationId: 1 }), false);
  assert.equal(f.service.active().length, 3);
  assert.ok(Buffer.byteLength(JSON.stringify(f.service.context())) <= 1800);
});

test('invalid interest output cannot inject tools, unsupported topics or control characters', () => {
  assert.deepEqual(validate(idea), idea);
  for (const row of [{ ...idea, tool: 'shell' }, { ...idea, domain: 'control-the-PC' },
    { ...idea, focus: '' }, { ...idea, question: 'x\nforged' }, { ...idea, continuationId: 1.5 }]) assert.throws(() => validate(row));
});

test('private interest generation feeds a coherent conversation without accessing user sources or acquiring actions', async t => {
  const f = fixture(t), calls = [], notifications = [];
  f.config({ privacy: { contextEvents: false, memoryEnabled: false } });
  const engine = new ProactiveConversation({ interests: f.service, now: f.now, settings: f.settings, random: () => 0,
    journal: { conversationState: () => null, allowed: () => false },
    observe: () => { throw Error('must not observe'); }, memories: () => { throw Error('must not recall'); },
    models: async () => ['test'], model: 'test', notify: text => { notifications.push(text); },
    infer: async request => { calls.push(request); return JSON.stringify(request.schema.properties.domain ? idea : { speak: true, message: 'I would like to sketch a city whose streets follow the weather. Want to invent one rule?' }); } });
  t.after(() => engine.close());
  f.advance(5 * 60_000); assert.equal(await engine.run(), true);
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1].messages[1].content).selected.source, 'interest');
  assert.equal(f.service.list()[0].mentions, 1);
  assert.equal(notifications.length, 1);
  assert.doesNotMatch(JSON.stringify(calls[0]), /foreground|personal-memory|project root/i);
  assert.match(engine.respond('No thanks.').text, /leave that idea aside/);
  assert.equal(f.service.list()[0].status, 'paused');
});

test('malformed private ideas do not disable ordinary conversation or retry generation every interval', async t => {
  const f = fixture(t); f.config({ privacy: { contextEvents: false, memoryEnabled: false } });
  let ideas = 0;
  const engine = new ProactiveConversation({ interests: f.service, now: f.now, settings: f.settings, random: () => 0,
    journal: { conversationState: () => null, allowed: () => false }, observe: async () => ({}),
    models: async () => ['test'], model: 'test', notify: () => true,
    infer: async request => { if (request.schema.properties.domain) { ideas++; return '{broken'; }
      return JSON.stringify({ speak: false, message: '' }); } });
  t.after(() => engine.close());
  f.advance(5 * 60_000); await engine.run(); f.advance(5 * 60_000); await engine.run();
  assert.equal(ideas, 1); assert.deepEqual(f.service.list(), []);
});

test('a creative answer or an old refusal does not get mistaken for a request to pause a topic', async t => {
  const f = fixture(t); await f.generate();
  let state = { nextAt: f.now() + 300000, recent: [], lastSource: 'interest', lastInterest: { id: 1, at: f.now() } };
  const engine = new ProactiveConversation({ interests: f.service, now: f.now, settings: f.settings,
    journal: { conversationState: value => value === undefined ? state : (state = value) },
    models: async () => [], infer: async () => '{}', notify() {} });
  t.after(() => engine.close());
  assert.equal(engine.respond('No'), null);
  assert.equal(f.service.list()[0].status, 'curious');
  assert.equal(engine.respond('No thanks'), null, 'Only the first reply is eligible');
  engine.state.lastInterest = { id: 1, at: f.now() - 11 * 60_000 };
  assert.equal(engine.respond('Not interested'), null);
  assert.equal(f.service.list()[0].status, 'curious');
});

test('Capri saves actual work and resumes the same pursuit after restarting', async t => {
  const f = fixture(t);
  await f.generate();
  const work = infer => f.service.advance({ ...f.deps, infer });
  assert.equal(await work(async () => JSON.stringify(draft)), true);
  f.restart();
  assert.match(f.service.route('/interests show 1', f.patch).text, /same bakery[\s\S]+move at dawn/);
  assert.equal(await work(async () => assert.fail('daily budget survived restart')), false);
  f.advance();
  assert.equal(await work(async request => {
    const data = JSON.parse(request.messages[1].content);
    assert.deepEqual(Object.keys(data), ['language', 'focus', 'question', 'rationale', 'previousDraft', 'nextStep', 'step']);
    assert.equal(data.previousDraft, draft.draft);
    assert.equal(data.nextStep, draft.nextStep);
    assert.equal(data.step, 2);
    return JSON.stringify({ ...draft, draft: 'The bakery moves at dawn to deliver bread to both sides of the river.' });
  }), true);
  f.advance();
  assert.equal(f.service.pending(), null);
  assert.match(f.service.route('/interests show 1', f.patch).text, /Draft 1[\s\S]+Draft 2[\s\S]+Draft complete/);
});

test('pausing or clearing a pursuit invalidates in-flight work and preserves the attempt budget', async t => {
  const f = fixture(t);
  await f.generate();
  let finish;
  const pending = f.service.advance({ ...f.deps, infer: () => new Promise(resolve => { finish = resolve; }) });
  f.service.route('/interests pause 1', f.patch);
  f.service.route('/interests resume 1', f.patch);
  finish(JSON.stringify(draft));
  assert.equal(await pending, false);
  f.advance();
  assert.equal(await f.service.advance({ ...f.deps, infer: async () => JSON.stringify(draft) }), true);
  f.service.route('/interests clear', f.patch);
  assert.equal(f.service.latest(1), undefined);
  assert.deepEqual(f.service.context(), []);
  assert.equal(await f.generate(), true);
  assert.equal(await f.service.advance({ ...f.deps, infer: async () => assert.fail('clearing bypassed budget') }), false);
});

test('eligible background opportunities publish concrete progress once and respect silence', async t => {
  const f = fixture(t), delivered = [];
  let state, presentations = 0;
  f.config({ proactiveVoice: true, privacy: { contextEvents: false, memoryEnabled: false } });
  const engine = new ProactiveConversation({ interests: f.service, now: f.now, settings: f.settings, random: () => 0,
    journal: { conversationState: value => value === undefined ? state : (state = value), allowed: () => false },
    models: async () => ['test'], model: 'test', notify: (text, options) => delivered.push({ text, ...options }),
    infer: async request => {
      if (request.schema.properties.domain) return JSON.stringify(idea);
      if (request.schema.properties.draft) {
        const { step } = JSON.parse(request.messages.at(-1).content);
        return JSON.stringify(step === 1 ? draft : { ...draft, draft: 'At dawn it moves to the river.', nextStep: '' });
      }
      const { selected } = JSON.parse(request.messages.at(-1).content);
      if (selected.savedDraft) {
        presentations++;
        assert.equal(selected.savedDraft, selected.step === 1 ? draft.draft : 'At dawn it moves to the river.');
        if (selected.step === 1) return JSON.stringify({ speak: true, message: 'I sketched an alley that always leads to the same bakery.' });
      }
      return JSON.stringify({ speak: false, message: '' });
    } });
  t.after(() => engine.close());
  f.advance(5 * 60_000); assert.equal(await engine.run(), false);
  f.advance(5 * 60_000); assert.equal(await engine.run(), true);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].voiceUntil, f.now() + 30_000);
  f.restart(); engine.interests = f.service;
  f.advance(5 * 60_000); assert.equal(await engine.run(), false);
  f.advance(); assert.equal(await engine.run(), false);
  assert.equal(f.service.latest(1).step, 2);
  f.advance(5 * 60_000); assert.equal(await engine.run(), false);
  assert.equal(presentations, 2);
  assert.equal(delivered.length, 1);
});

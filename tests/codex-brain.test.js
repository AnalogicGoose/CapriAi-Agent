'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { CodexClient } = require('../src/main/codex-client');
const { CodexBrain } = require('../src/main/codex-brain');
const { CHARACTER_VOICE } = require('../src/main/personality');
const { CodexTools } = require('../src/main/codex-tools');
const { RecentConversation } = require('../src/main/recent-conversation');
const { MemoryStore } = require('../src/main/memory');

function processMock() {
  const p = new EventEmitter();
  p.stdin = new PassThrough(); p.stdout = new PassThrough(); p.stderr = new PassThrough();
  p.kill = () => { p.killed = true; };
  p.stdin.on('data', bytes => {
    const m = JSON.parse(bytes.toString());
    if (m.id) p.stdout.write(JSON.stringify({ id: m.id, result: m.method === 'initialize' ? {} : { echoed: m.params } }) + '\n');
  });
  return p;
}
test('owned stdio client initializes, disables built-ins and closes its child', async () => {
  let spawned;
  const proc = processMock();
  const c = new CodexClient({ executable: 'codex', cwd: os.tmpdir(), spawnProcess: (...args) => { spawned = args; return proc; } });
  await c.start();
  assert.equal(spawned[2].shell, false); assert.equal(spawned[2].windowsHide, true);
  assert.ok(spawned[1].includes('features.shell_tool=false'));
  assert.ok(!spawned[1].includes('features.code_mode_host=false'));
  assert.deepEqual(await c.request('test', { n: 2 }), { echoed: { n: 2 } });
  c.close(); assert.equal(proc.killed, true); assert.equal(c.pending.size, 0);
});
test('malformed protocol fails pending requests without leaking logs', async () => {
  const proc = processMock(); const c = new CodexClient({ executable: 'codex', spawnProcess: () => proc });
  await c.start(); proc.stdout.write('not-json\n');
  assert.equal(c.closed, true); await assert.rejects(c.request('x', {}), /closed/);
});
test('system-mode CLI enables command, file/image and web capability without forcing configured connections off', async () => {
  const proc = processMock(); let args;
  const c = new CodexClient({ executable: 'codex', nativeTools: true, spawnProcess: (_exe, supplied) => { args = supplied; return proc; } });
  await c.start();
  assert.ok(args.includes('features.shell_tool=true')); assert.ok(args.includes('features.unified_exec=true'));
  assert.ok(args.includes('features.view_image=true')); assert.ok(args.includes('web_search="live"'));
  assert.ok(!args.includes('features.apps=false')); assert.ok(args.includes('features.hooks=false'));
  c.close();
});
function fixture(mode = 'reply', brainOptions = {}) {
  let client; let threadNumber = 0; const calls = []; const toolRuns = [];
  const tools = { specs: () => [], instructions: () => '', run: async (...args) => { toolRuns.push(args); return { completed: true }; }, cancel: () => {} };
  const factory = () => client = {
    start: async () => { calls.push(['initialize']); }, close() { calls.push(['close']); this.closed = true; }, respond(...args) { calls.push(['respond', ...args]); },
    async request(method, params) {
      calls.push([method, params]);
      if (method === 'account/read') return { account: { type: 'chatgpt' } };
      if (method === 'model/list') return { data: [{ id: 'test', model: 'test', isDefault: true }] };
      if (method === 'config/read') return { config: { mcp_servers: { existing: {} } } };
      if (method === 'thread/start') return { thread: { id: mode === 'warm' ? `thread-${++threadNumber}` : 'thread' } };
      if (method === 'thread/unsubscribe') return { status: 'unsubscribed' };
      if (method === 'turn/start') {
        if (mode === 'warm') {
          const { threadId } = params, turn = { id: 'turn', status: 'completed' };
          this.onNotification('turn/started', { threadId, turn });
          setImmediate(() => {
            this.onNotification('item/agentMessage/delta', { threadId: 'thread-older', turnId: turn.id, delta: 'Stale.' });
            this.onNotification('item/agentMessage/delta', { threadId, turnId: turn.id, delta: 'Hello' });
            this.onNotification('turn/completed', { threadId, turn });
          });
          return { turn };
        }
        this.onNotification('turn/started', { threadId: 'thread', turn: { id: 'turn' } });
        if (mode === 'wait') return { turn: { id: 'turn' } };
        setImmediate(async () => {
          if (mode === 'phased') {
            const context = { threadId: 'thread', turnId: 'turn' };
            for (const item of [
              { id: 'first', phase: 'partial_answer', text: '[[voice: curious]]\nI see it.' },
              { id: 'last', phase: 'final_answer', text: 'The value is 75.' },
            ]) {
              this.onNotification('item/agentMessage/delta', { ...context, itemId: item.id, delta: item.text });
              this.onNotification('item/completed', { ...context, item: { ...item, type: 'agentMessage' } });
            }
            this.onNotification('turn/completed', { ...context, turn: { id: 'turn', status: 'completed' } });
            return;
          }
          if (mode === 'verification') {
            const item = { id: 'test-command', type: 'commandExecution', command: 'npm test', cwd: path.join(os.tmpdir(), 'selected-project'), status: 'completed', exitCode: 0 };
            this.onNotification('item/completed', { threadId: 'old-thread', turnId: 'turn', item: { ...item, id: 'stale' } });
            this.onNotification('item/completed', { threadId: 'thread', turnId: 'turn', item });
            this.onNotification('item/completed', { threadId: 'thread', turnId: 'turn', item });
            this.onNotification('item/started', { threadId: 'thread', turnId: 'turn', item: { ...item, id: 'not-completed' } });
          }
          if (mode === 'approval' || mode === 'permission') {
            this.onNotification('item/started', { threadId: 'thread', turnId: 'turn', item: { id: 'command', type: 'commandExecution' } });
            await this.onRequest({ id: 90, method: mode === 'approval' ? 'item/commandExecution/requestApproval' : 'item/permissions/requestApproval',
              params: { threadId: 'thread', turnId: 'turn', itemId: 'command', command: 'echo safe', permissions: { fileSystem: { write: ['C:\\Requested'] } } } });
          }
          if (mode === 'native') {
            const context = { threadId: 'thread', turnId: 'turn' };
            const search = { id: 'ws', type: 'webSearch', query: 'blox fruits news', status: 'completed' };
            const launch = { id: 'cmd', type: 'commandExecution', command: 'Start-Process spotify', status: 'completed', exitCode: 0 };
            const failed = { id: 'bad', type: 'commandExecution', command: 'git status', status: 'failed', exitCode: 1 };
            for (const item of [search, launch, failed]) {
              this.onNotification('item/started', { ...context, item: { ...item, status: 'inProgress' } });
              this.onNotification('item/completed', { ...context, item });
            }
            this.onNotification('item/completed', { ...context, item: { id: 'never-started', type: 'webSearch' } });
          }
          if (mode === 'screen') await this.onRequest({ id: 33, method: 'item/tool/call', params: { threadId: 'thread', turnId: 'turn', callId: 'screen', tool: 'stella_screen', arguments: { displayId: '' } } });
          if (mode === 'tool' || mode === 'launch' || mode === 'music') {
            const request = { id: 30, method: 'item/tool/call', params: { threadId: 'thread', turnId: 'turn', callId: 'one', tool: 'stella_context', arguments: {} } };
            if (mode === 'launch') Object.assign(request.params, { tool: 'stella_desktop_step', arguments: { tool: 'open_app', query: 'Firefox', index: 0, browser: 'default' } });
            if (mode === 'music') Object.assign(request.params, { tool: 'stella_desktop_step', arguments: { tool: 'play_music', query: 'Last Christmas by Wham!', index: 0, browser: '' } });
            await this.onRequest(request); await this.onRequest({ ...request, id: 31 });
            if (mode === 'tool') await this.onRequest({ ...request, id: 32, params: { ...request.params, turnId: 'old' } });
          }
          const pieces = mode === 'delivery' ? ['[[vo', 'ice: com', 'forting]]\n', 'I’m right here.'] : ['Hello'];
          if (mode === 'delivery') {
            const item = { id: 'commentary', type: 'agentMessage', phase: 'commentary', text: 'Checking.' };
            this.onNotification('item/started', { threadId: 'thread', turnId: 'turn', item });
            this.onNotification('item/agentMessage/delta', { threadId: 'thread', turnId: 'turn', itemId: item.id, delta: item.text });
            this.onNotification('item/completed', { threadId: 'thread', turnId: 'turn', item });
          }
          for (const delta of pieces) this.onNotification('item/agentMessage/delta', { threadId: 'thread', turnId: 'turn', delta });
          this.onNotification('item/completed', { threadId: 'thread', turnId: 'turn', item: { type: 'agentMessage', text: pieces.join('') } });
          this.onNotification('turn/completed', { threadId: 'thread', turn: { id: 'turn', status: 'completed' } });
        });
        return { turn: { id: 'turn' } };
      }
    },
  };
  const brain = new CodexBrain({ settings: () => ({}), cwd: path.join(os.tmpdir(), 'stella-brain-unit'), tools, clientFactory: factory, locate: () => 'codex', ...brainOptions });
  return { brain, calls, toolRuns, client: () => client };
}
test('the AI\'s own built-in tools report activity for Stella (start, end, never the query or command)', async () => {
  const events = [];
  const f = fixture('native', { systemTools: () => true, activity: event => events.push(event) });
  assert.equal(await f.brain.chat('search blox fruits news and open spotify', () => {}), 'Hello');
  assert.deepEqual(events, [
    { tool: 'native_web_search', op: 'search', phase: 'start' }, { tool: 'native_web_search', op: 'search', phase: 'end', ok: true },
    { tool: 'native_command', op: 'launch', phase: 'start' }, { tool: 'native_command', op: 'launch', phase: 'end', ok: true },
    { tool: 'native_command', op: 'run', phase: 'start' }, { tool: 'native_command', op: 'run', phase: 'end', ok: false },
  ]);
  // A throwing listener never breaks the conversation.
  const g = fixture('native', { systemTools: () => true, activity: () => { throw Error('boom'); } });
  assert.equal(await g.brain.chat('search', () => {}), 'Hello');
});
test('warm foreground requests reuse the process, isolate threads and release the process in gaming mode', async () => {
  const f = fixture('warm');
  f.brain.warmIdleMs = 180000;
  let gamingMode = false;
  f.brain.settings = () => ({ gamingMode });
  f.brain.canKeepWarm = () => !gamingMode;
  try {
    await f.brain.chat('First');
    const proc = f.client(), deltas = [];
    assert.equal(proc.closed, undefined);
    assert.equal(await f.brain.chat('Second', text => deltas.push(text)), 'Hello');
    assert.equal(f.client(), proc);
    assert.deepEqual(deltas, ['Hello']);
    assert.equal(f.calls.filter(([method]) => method === 'initialize').length, 1);
    assert.deepEqual(f.calls.filter(([method]) => method === 'thread/unsubscribe').map(([, arg]) => arg.threadId), ['thread-1', 'thread-2']);
    gamingMode = true; f.brain.cancel();
    assert.equal(proc.closed, true);
    await assert.rejects(f.brain.chat('Third'), /Gaming mode/);
  } finally { f.brain.cancel(); }
});

test('the warm server closes at its idle deadline and on an unsupported thread release', async () => {
  const f = fixture('warm');
  f.brain.warmIdleMs = 15;
  try {
    await f.brain.chat('First');
    const proc = f.client();
    await new Promise(resolve => setTimeout(resolve, 35));
    assert.equal(proc.closed, true);
    const factory = f.brain.clientFactory;
    f.brain.clientFactory = options => {
      const client = factory(options), request = client.request.bind(client);
      client.request = async (method, params) => {
        if (method === 'thread/unsubscribe') throw Error('Unsupported method');
        return request(method, params);
      };
      return client;
    };
    assert.equal(await f.brain.chat('Second'), 'Hello');
    assert.notEqual(f.client(), proc);
    assert.equal(f.client().closed, true);
    assert.equal(f.brain.warmClient, null);
  } finally { f.brain.cancel(); }
});

test('brain streams, preserves history, isolates threads and disables inherited MCP servers', async () => {
  const f = fixture(); const deltas = [];
  assert.equal(await f.brain.chat('Hi', d => deltas.push(d)), 'Hello');
  assert.ok(f.calls.find(([method]) => method === 'thread/start')[1].baseInstructions.includes(CHARACTER_VOICE),
    'The shared character voice must reach the actual foreground Codex thread.');
  assert.deepEqual(deltas, ['Hello']); assert.equal(f.brain.history.length, 2);
  assert.equal(f.brain.lastStatus.verifiedInference, true); assert.equal(f.client().closed, true);
  const params = f.calls.find(c => c[0] === 'thread/start')[1];
  assert.equal(params.ephemeral, true); assert.equal(params.sandbox, 'read-only');
  assert.equal(params.config.mcp_servers.existing.enabled, false);
});

test('spoken delivery arrives before streamed text and stays out of replies and history', async () => {
  const { brain } = fixture('delivery');
  const stream = [];
  const answer = await brain.chat('Could you comfort me?', text => stream.push(text), undefined,
    { voice: true, onDelivery: style => stream.push({ style }) });
  assert.deepEqual(stream, [{ style: 'comforting' }, 'I’m right here.']);
  assert.equal(answer, 'I’m right here.');
  assert.equal(brain.history.at(-1).content, answer);
  const { readDeliveryPrefix } = require('../src/main/voice-delivery');
  assert.deepEqual(readDeliveryPrefix('[[voice: unsupported]] Hello', true), { style: 'neutral', text: 'Hello' });
  assert.deepEqual(readDeliveryPrefix('Hello'), { style: 'neutral', text: 'Hello' });
});

test('stable partial answers and their continuation are streamed in order and retained once', async () => {
  const { brain } = fixture('phased');
  const chunks = [];
  const answer = await brain.chat('Can you read it?', text => chunks.push(text), undefined, { voice: true, onDelivery: () => {} });
  assert.deepEqual(chunks, ['I see it.', '\n\nThe value is 75.']);
  assert.equal(answer, chunks.join(''));
});

test('opted-in voice chat survives a new brain and can be cleared', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'stella-recent-chat-'));
  const file = path.join(folder, 'chat.sqlite');
  let store;
  t.after(() => { store?.close(); fs.rmSync(folder, { recursive: true, force: true }); });
  const create = (enabled = true) => {
    const f = fixture();
    f.brain.settings = () => ({ rememberRecentChat: enabled });
    f.brain.recentConversation = (create = false) => store ||= create ? new RecentConversation(file) : undefined;
    return f;
  };
  await create(false).brain.chat('An unsaved conversation');
  assert.equal(fs.existsSync(file), false);
  const first = create();
  await first.brain.chat('Let’s talk about Black Clover. No manga spoilers.', undefined, undefined, { voice: true });
  await first.brain.chat('Private structured generation', undefined, undefined, { recordHistory: false });
  assert.equal(store.read().length, 2);
  store.close();
  store = new RecentConversation(file);
  const second = create();
  await second.brain.chat('Where were we?');
  const prompt = second.calls.find(([method]) => method === 'turn/start')[1].input[0].text;
  assert.match(prompt, /Black Clover\. No manga spoilers\./);
  assert.doesNotMatch(prompt, /An unsaved conversation|Private structured generation/);

  second.brain.reset();
  assert.deepEqual(store.read(), []);
  await second.brain.chat('Start over');
  assert.doesNotMatch(second.calls.filter(([method]) => method === 'turn/start').at(-1)[1].input[0].text, /Black Clover/);
});

test('recent conversation limits storage and expires whole exchanges', () => {
  let now = Date.now();
  const store = new RecentConversation(':memory:', () => now);
  try {
    for (let i = 0; i < 13; i++) store.append(`Question ${i}`, `Reply ${i}`);
    assert.equal(store.read().length, 24);
    assert.equal(store.read()[0].content, 'Question 1');
    store.append('A large reply', '旅'.repeat(10_000));
    assert.equal(store.read().at(-1).content, 'Reply 12');
    now += 7 * 86_400_000;
    assert.deepEqual(store.read(), []);
  } finally { store.close(); }
});

test('forgetting a named topic removes matching exchanges and preserves unrelated chat', () => {
  const store = new RecentConversation(':memory:');
  try {
    store.append('Let’s talk about Black Clover.', 'We can start with Asta.');
    store.append('I play table tennis.', 'How often do you practice?');
    assert.equal(store.forgetTopic('black clover'), 1);
    assert.equal(store.read().length, 2);
    assert.equal(store.read()[0].content, 'I play table tennis.');
  } finally { store.close(); }
});

test('requested native work uses the selected workspace and journals deduplicated completed command receipts only', async () => {
  const f = fixture('verification'), receipts = [], selected = path.join(os.tmpdir(), 'selected-project');
  f.brain.systemTools = () => true;
  f.brain.workspace = () => selected;
  f.brain.onOutcome = value => receipts.push(value);
  await f.brain.chat('Run the tests');
  assert.equal(f.calls.find(row => row[0] === 'thread/start')[1].cwd, selected);
  assert.deepEqual(receipts, [{ workspace: selected, cwd: selected, command: 'npm test', exitCode: 0 }]);
  f.brain.onOutcome = async () => { throw Error('Journal unavailable'); };
  assert.equal(await f.brain.chat('Run the tests again'), 'Hello');
});

test('a missing selected workspace fails before starting a Codex client', async () => {
  const f = fixture(); f.brain.systemTools = () => true;
  f.brain.workspace = () => { throw Error('Project folder unavailable'); };
  await assert.rejects(f.brain.chat('Inspect this project'), /folder unavailable/);
  assert.equal(f.client(), undefined); assert.equal(f.brain.busy, false);
});

test('large companion context stays valid JSON and retains project/goal records instead of slicing them', async () => {
  const f = fixture();
  f.brain.context = () => ({ externalCodexEvents: { sessions: [{ title: '旅'.repeat(20000) }] },
    currentProject: { root: 'C:\\Selected', notes: [{ kind: 'decision', text: 'Keep the original animations' }] },
    savedGoals: [{ text: 'Finish the project' }], recentConversation: [{ content: 'x'.repeat(20000) }],
    capabilities: { available: true } });
  await f.brain.chat('What is next?');
  const input = f.calls.find(row => row[0] === 'turn/start')[1].input[0].text;
  const raw = input.slice(input.indexOf('\n') + 1, input.indexOf('\n\n'));
  const data = JSON.parse(raw);
  assert.equal(data.currentProject.root, 'C:\\Selected');
  assert.equal(data.savedGoals[0].text, 'Finish the project');
  assert.ok(data.omittedContextFields.includes('externalCodexEvents'));
  assert.ok(Buffer.byteLength(raw) <= 16000);
});
test('tool requests execute once and reject stale turn IDs', async () => {
  const f = fixture('tool'); await f.brain.chat('What is open?');
  assert.equal(f.toolRuns.length, 1);
  const responses = f.calls.filter(c => c[0] === 'respond');
  assert.equal(responses.length, 3); assert.equal(responses[2][2].success, false);
});
test('cancel stops an in-flight turn and releases busy state', async () => {
  const f = fixture('wait'); const pending = f.brain.chat('Hi');
  await new Promise(resolve => setImmediate(resolve));
  f.brain.cancel(); await assert.rejects(pending, /stopped/);
  assert.equal(f.brain.busy, false); assert.equal(f.brain.history.length, 0);
  assert.ok(f.calls.findIndex(row => row[0] === 'turn/interrupt') < f.calls.findIndex(row => row[0] === 'close'));
});
test('failed client creation never leaves the brain busy', async () => {
  const f = fixture(); f.brain.locate = () => { throw Error('not found'); };
  await assert.rejects(f.brain.chat('Hi'), /not found/); assert.equal(f.brain.busy, false);
  assert.equal((await f.brain.status()).ok, false);
});
test('tool bridge rejects unknown, negated and non-requested mutations', async () => {
  const t = new CodexTools({ settings: () => ({ privacy: { memoryEnabled: true } }), state: () => ({ displays: [] }) });
  const ctx = text => ({ text, check() {}, signal: new AbortController().signal });
  await assert.rejects(t.run('shell', {}, ctx('hello')), /Unknown/);
  await assert.rejects(t.run('stella_memory_change', { changes: [{ kind: 'add', id: 0, text: 'fake' }] }, ctx('hello')), /explicit/);
  await assert.rejects(t.run('stella_settings_change', { patch: '{"muted":true}' }, ctx("don't mute")), /direct/);
});

test('contextual learning needs the current user’s words and the active learning setting', async t => {
  const store = new MemoryStore(':memory:');
  t.after(() => store.close());
  const cfg = { privacy: { memoryEnabled: true, memoryLearn: true } };
  const tools = new CodexTools({ settings: () => cfg, store: () => store });
  const action = detail => ({ facts: [{ kind: 'activity', detail }] });
  const context = text => ({ text, check() {} });
  assert.ok(tools.specs().some(row => row.name === 'stella_memory_learn'));
  assert.match(tools.memoryInstructions(), /ON/);
  assert.deepEqual(await tools.run('stella_memory_learn', action('table tennis'), context('table tennis, mostly.')),
    { saved: 1, confirmedFacts: ['I spend time on table tennis'] });
  const skipped = { saved: 0, confirmedFacts: [] };
  assert.deepEqual(await tools.run('stella_memory_learn', action('ice skating'), context('table tennis, mostly.')), skipped);
  assert.deepEqual(await tools.run('stella_memory_learn', action('curling'), context('Don’t save this. Curling.')), skipped);
  assert.deepEqual(await tools.run('stella_memory_learn', action('curling'), context('I used to play curling.')), skipped);
  assert.deepEqual(store.list().map(row => row.text), ['I spend time on table tennis']);
  cfg.privacy.memoryLearn = false;
  assert.equal(tools.specs().some(row => row.name === 'stella_memory_learn'), false);
  assert.match(tools.memoryInstructions(), /OFF/);
  await assert.rejects(tools.run('stella_memory_learn', action('curling'), context('curling, mostly.')), /learning is off/);
});

test('clear short answers save through foreground chat even when the model calls no tools', async t => {
  const store = new MemoryStore(':memory:');
  t.after(() => store.close());
  const f = fixture();
  const settings = () => ({ privacy: { memoryEnabled: true, memoryLearn: true } });
  f.brain.tools = new CodexTools({ settings, store: () => store });
  f.brain.history = [{ role: 'assistant', content: 'What are you working on?' }];
  await f.brain.chat('A small rhythm game.');
  f.brain.history = [{ role: 'assistant', content: '¿Qué anime te gusta?' }];
  await f.brain.chat('Black Clover.');
  const prompt = f.calls.filter(([method]) => method === 'turn/start').at(-1)[1].input[0].text;
  assert.match(prompt, /"automaticMemory":\{"confirmedFacts":\["I like Black Clover"\]\}/);
  f.brain.history = [{ role: 'assistant', content: 'What do you usually play today?' }];
  await f.brain.chat('Badminton.');
  assert.deepEqual(store.list().map(row => row.text), ['I like Black Clover', 'I’m working on A small rhythm game']);
});

test('automatic saves return a receipt even if the model tries a redundant manual update', async t => {
  const store = new MemoryStore(':memory:');
  t.after(() => store.close());
  const settings = () => ({ privacy: { memoryEnabled: true, memoryLearn: true } });
  const tools = new CodexTools({ settings, store: () => store });
  const text = 'I like Black Clover. Who is your favorite character?';
  tools.beginTurn(text);
  tools.learnConversationalAnswer(text, null, store.learn(text).facts);
  const context = { text, check() {} };
  const duplicate = [{ kind: 'add', id: 0, text: 'The user likes Black Clover.' }];
  const result = await tools.run('stella_memory_change', { changes: duplicate }, context);
  assert.equal(result.changed, false);
  assert.deepEqual(result.confirmedFacts, ['I like Black Clover']);
  assert.deepEqual(await tools.run('stella_memory_learn', { facts: [{ kind: 'interest', detail: 'Black Clover' }] }, context),
    { saved: 0, confirmedFacts: ['I like Black Clover'] });
  assert.equal(store.list().length, 1);
  await assert.rejects(tools.run('stella_memory_change', { changes: [{ kind: 'forget', id: 1, text: '' }] }, context), /explicit/);
});

test('memory lookup binds edits to this turn; questions cannot mutate records', async () => {
  let edits = 0;
  const store = { search: () => [{ id: 3, text: 'My name is Gabe.' }], applyChanges: () => edits++ };
  const tools = new CodexTools({ settings: () => ({ privacy: { memoryEnabled: true, memoryRecall: true, memoryConfirmChanges: false } }), store: () => store });
  const context = { text: 'forget memory 3', check() {}, signal: new AbortController().signal };
  const change = { changes: [{ kind: 'forget', id: 3, text: '' }] };
  await assert.rejects(tools.run('stella_memory_change', change, context), /Invalid memory/);
  await tools.run('stella_memory_lookup', { query: 'name' }, context);
  await tools.run('stella_memory_change', change, context);
  assert.equal(edits, 1);
  await assert.rejects(tools.run('stella_memory_change', change, { ...context, text: 'what do you remember about me?' }), /explicit/);
  tools.endTurn();
  await assert.rejects(tools.run('stella_memory_change', change, context), /Invalid memory/);
});
test('settings tool applies requested values through the existing policy', async () => {
  let patch;
  const tools = new CodexTools({ settings: () => ({}), state: () => ({ displays: [] }), patch: value => patch = value });
  const context = { text: 'mute your sound', check() {}, signal: new AbortController().signal };
  await tools.run('stella_settings_change', { patch: '{"muted":true}' }, context);
  assert.deepEqual(patch, { muted: true });
  await assert.rejects(tools.run('stella_settings_change', { patch: '{"codexExecutable":"anything"}' }, context), /control room/);
});

test('conversational actions use shared evidence and do not require setting command words', async () => {
  const patches = [];
  const tools = new CodexTools({ settings: () => ({}), state: () => ({ displays: [] }), patch: value => patches.push(value) });
  const apply = (text, patch, requestEvidence = text, history = []) =>
    tools.run('stella_settings_change', { patch: JSON.stringify(patch), requestEvidence }, { text, history, check() {} });
  assert.ok(tools.specs().find(tool => tool.name === 'stella_settings_change').inputSchema.required.includes('requestEvidence'));
  await apply('You can talk again.', { muted: false });
  await apply('Could we keep it quiet for a bit?', { muted: true });
  await apply('Ya puedes volver a hablar.', { muted: false });
  await apply('Could you give yourself a little less room on my screen?', { scale: 0.45 });
  await apply('Sure', { muted: false }, 'Sure', [{ role: 'assistant', content: 'Want me to unmute?' }]);
  assert.deepEqual(patches, [{ muted: false }, { muted: true }, { muted: false }, { scale: 0.45 }, { muted: false }]);
  for (const text of ['Are you able to talk again?', 'What if I say "you can talk again"?', '"You can talk again"',
    'The screen says you can talk again', 'I don’t want you to talk again', 'Sure']) {
    await assert.rejects(apply(text, { muted: false }));
  }
  await assert.rejects(apply('What time is it?', { muted: false }, 'You can talk again'), /current user/);
  await assert.rejects(apply('You can talk again.', { codexExecutable: 'other.exe' }), /control room/);
  assert.equal(patches.length, 5);
});

test('Codex app launch reaches the real local executor with a schema-required default browser placeholder', async () => {
  const { ActionAgent } = require('../src/main/action-agent');
  const { DesktopTools } = require('../src/main/desktop-tools');
  const opened = [], settings = () => ({ agentEnabled: true, desktopActions: true });
  const actions = new ActionAgent({ settings, idle: () => false,
    desktop: new DesktopTools({ shortcuts: () => [{ label: 'Firefox', file: 'C:\\Apps\\Firefox.lnk' }], executables: () => [],
      openPath: async file => { opened.push(file); return ''; }, native: { desktopApps: () => [{ name: 'firefox' }] } }),
    browser: { stop() {} }, web: {}, models: async () => assert.fail('Must not invoke the old planner'),
    infer: () => assert.fail('Must not invoke Qwen') });
  const f = fixture('launch'); f.brain.tools = new CodexTools({ settings, actions });
  await f.brain.chat('open firefox');
  assert.deepEqual(opened, ['C:\\Apps\\Firefox.lnk']);
  const response = f.calls.find(row => row[0] === 'respond')[2];
  assert.equal(response.success, true);
  assert.equal(JSON.parse(response.contentItems[0].text).observations[0].windowObserved, true);
});

test('failed dynamic tool calls show the actual local error and preserve argument-free diagnostics', async () => {
  const f = fixture('launch');
  f.brain.tools.run = async () => { throw Error('App discovery is unavailable.'); };
  const result = await f.brain.chat('open firefox');
  assert.match(result, /Local tool error: App discovery is unavailable/);
  assert.equal(f.brain.lastDiagnostics.completed, 0);
  assert.equal(f.brain.lastDiagnostics.errors[0].tool, 'stella_desktop_step');
  assert.doesNotMatch(JSON.stringify(f.brain.lastDiagnostics), /arguments|query/);
});

test('a failed look at the screen does not tack a local tool error onto the answer', async () => {
  const f = fixture('screen');
  f.brain.tools.run = async () => { throw Error('No other app window is in front to inspect; explain from what you know instead.'); };
  const result = await f.brain.chat('explain how to open settings in the Claude app');
  assert.equal(f.brain.lastDiagnostics.errors[0].tool, 'stella_screen');
  assert.doesNotMatch(result, /Local tool error/);
});

test('conversational song requests reach playback with the resolved track', async () => {
  const { ActionAgent } = require('../src/main/action-agent');
  const played = [], settings = () => ({ agentEnabled: true, desktopActions: true });
  const actions = new ActionAgent({ settings, idle: () => false, browser: { stop() {} },
    music: { async play(request) {
      played.push(request);
      return { type: 'music', playing: true, note: 'Playing Last Christmas.' };
    } } });
  const f = fixture('music');
  f.brain.tools = new CodexTools({ settings, actions, confirm: () => assert.fail('A clear playback request needs no confirmation') });
  for (const [message, history] of [
    ['Could you put on Last Christmas by Wham, please?', []],
    ['Last Christmas by Wham, please.', [{ role: 'assistant', content: 'Which song would you like me to play?' }]],
    ['Yeah, put that one on.', [{ role: 'assistant', content: 'How about Last Christmas by Wham?' }]],
    ['Yes!', [{ role: 'assistant', content: 'Want me to play Last Christmas by Wham?' }]],
    ['The Wham version.', [{ role: 'user', content: 'Play Last Christmas.' },
      { role: 'assistant', content: 'Which artist for “Last Christmas”?' }]],
  ]) {
    f.brain.history = history;
    await f.brain.chat(message);
    assert.equal(f.brain.lastDiagnostics.completed, 1);
    assert.equal(f.brain.lastDiagnostics.errors.length, 0);
  }
  assert.equal(played.length, 5);
  for (const request of played) assert.deepEqual(request, { title: 'Last Christmas', artist: 'Wham!', browser: 'default' });
});

test('a music tool call still needs a grounded song and playback intent', async () => {
  const actions = { run: () => assert.fail('Playback was not authorized') };
  const tools = new CodexTools({ settings: () => ({ agentEnabled: true, desktopActions: true }),
    actions, confirm: async () => false });
  const call = (text, history = []) => tools.run('stella_desktop_step',
    { tool: 'play_music', query: 'Last Christmas', index: 0, browser: '' },
    { text, history, signal: new AbortController().signal, check() {} });
  assert.deepEqual(await call('I usually play Last Christmas every year.'), { completed: false, reason: 'User cancelled.' });
  assert.deepEqual(await call('Last Christmas.', [{ role: 'assistant', content: 'Which song do you play every year?' }]),
    { completed: false, reason: 'User cancelled.' });
  await assert.rejects(call('Play it.'), /Which song/);
  await assert.rejects(call('Do not play Last Christmas.'), /does not request/);
  await assert.rejects(call("Please don't put Last Christmas on."), /does not request/);
  await assert.rejects(call('Could you put on Last Christmas on Spotify?'), /does not request/);
});

test('foreground system mode preserves native tools and handles scoped approvals, while restricted sessions reject them', async () => {
  for (const accept of [true, false]) {
    const f = fixture('approval'); f.brain.systemTools = () => true; f.brain.workspace = 'C:\\Users\\Gabriel';
    let reviewed = false; f.brain.approve = async (message, ctx) => { reviewed = true; assert.equal(ctx.item.type, 'commandExecution'); return accept; };
    await f.brain.chat('Work on the requested file');
    assert.equal(reviewed, true);
    const thread = f.calls.find(row => row[0] === 'thread/start')[1];
    assert.equal(thread.sandbox, 'workspace-write'); assert.equal(thread.cwd, 'C:\\Users\\Gabriel'); assert.equal(thread.config.mcp_servers, undefined);
    assert.equal(f.calls.find(row => row[0] === 'respond')[2].decision, accept ? 'accept' : 'decline');
  }
  const denied = fixture('approval'); await assert.rejects(denied.brain.chat('hello'), /tool outside/);
});
test('expanded filesystem permissions are reviewed and granted only for the current turn', async () => {
  const f = fixture('permission'); f.brain.systemTools = () => true; f.brain.approve = async () => true;
  await f.brain.chat('Update my requested file outside the workspace');
  const response = f.calls.find(row => row[0] === 'respond')[2];
  assert.deepEqual(response.permissions, { fileSystem: { write: ['C:\\Requested'] } });
  assert.equal(response.scope, 'turn'); assert.equal(response.strictAutoReview, true);
});
test('screen tools transmit actual image content and live personality data, not a text-only screenshot claim', async () => {
  const f = fixture('screen'); f.brain.context = () => ({ presentation: { mood: 'playful' } });
  f.brain.tools.run = async () => ({ image: 'data:image/jpeg;base64,YQ==', snapshotId: 'fresh-frame', width: 100, height: 50 });
  await f.brain.chat('What is on my screen?');
  const response = f.calls.find(row => row[0] === 'respond')[2];
  assert.deepEqual(response.contentItems[1], { type: 'inputImage', imageUrl: 'data:image/jpeg;base64,YQ==' });
  assert.doesNotMatch(response.contentItems[0].text, /base64/);
  assert.match(f.calls.find(row => row[0] === 'turn/start')[1].input[0].text, /playful/);
});

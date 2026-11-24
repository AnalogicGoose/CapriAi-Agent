'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const W = require('../src/main/walkthrough');
const { Walkthrough, POLL_MS, RING_MARGIN, SETTLE_MS, RESOLVE_TIMEOUT_MS, MAX_REPLANS, PAUSE_LIMIT_MS, NEW_WINDOW_GRACE_MS } = W;

const box = (x, y, width, height) => ({ x, y, width, height });
const flush = async () => { for (let i = 0; i < 6; i += 1) await new Promise(resolve => setImmediate(resolve)); };
const name = n => ({ type: 'name', name: n });
const step = (n, say, action = 'click', more = {}) => ({ target: name(n), say, action, ...more });
const SENTINEL = -31337;

function fixture({ steps, cardBounds = null, replan, title = 'Save a file' } = {}) {
  const s = {
    now: 0, timers: new Map(), nextId: 1,
    pointer: { down: false, x: SENTINEL, y: SENTINEL }, reads: 0,
    fg: { id: 5, pid: 9, app: 'editor', ...box(0, 0, 800, 600) },
    found: new Map([['Save', box(100, 100, 60, 20)], ['Open', box(300, 100, 60, 20)], ['Name', box(100, 300, 200, 24)], ['List', box(100, 400, 200, 100)]]),
    resolves: [], spoken: [], renders: [], ends: [], replans: [], states: [],
  };
  const targets = {
    resolve: async target => {
      s.resolves.push(target.name);
      const bounds = s.found.get(target.name);
      return bounds ? { ok: true, bounds, window: { id: s.fg.id } } : { ok: false, reason: 'not-found' };
    },
  };
  const walk = new Walkthrough({
    plan: { title, steps: steps || [step('Save', 'Click Save'), step('Open', 'Now click Open')] },
    targets,
    render: (marks, card) => { s.renders.push({ marks, card }); return Promise.resolve({ cardBounds: card ? cardBounds : null }); },
    speak: (text, opts) => { s.spoken.push(text); assert.deepEqual(opts, { purpose: 'guide' }); },
    pointer: () => { s.reads += 1; return { ...s.pointer }; },
    foreground: () => (s.fg ? { ...s.fg } : null),
    replan: replan || (async args => { s.replans.push(args); return null; }),
    lines: kind => `line:${kind}`,
    now: () => s.now,
    setTimer: (fn, ms) => { const id = s.nextId++; s.timers.set(id, { fn, at: s.now + ms }); return id; },
    clearTimer: id => { s.timers.delete(id); },
    onEnd: info => s.ends.push(info),
    ownPid: 77,
  });
  const advance = async ms => {
    const end = s.now + ms;
    await flush();
    for (;;) {
      let next = null;
      for (const [id, t] of s.timers) if (t.at <= end && (!next || t.at < next.t.at)) next = { id, t };
      if (!next) break;
      s.timers.delete(next.id);
      s.now = next.t.at;
      next.t.fn();
      await flush();
      s.states.push(walk.state);
    }
    s.now = end;
    await flush();
  };
  // The first read of a step only learns whether the button was already held, so idle one tick before pressing.
  const press = async (x, y) => { s.pointer = { down: false, x, y }; await advance(POLL_MS); s.pointer = { down: true, x, y }; await advance(POLL_MS); };
  const release = async (x, y) => { s.pointer = { down: false, x, y }; await advance(POLL_MS); };
  const click = async (x, y) => { await press(x, y); await release(x, y); };
  const start = async () => { walk.start(); await flush(); };
  return { walk, s, advance, click, press, release, start };
}

test('exports the timing constants', () => {
  assert.deepEqual({ POLL_MS, RING_MARGIN, SETTLE_MS, RESOLVE_TIMEOUT_MS, MAX_REPLANS, PAUSE_LIMIT_MS, NEW_WINDOW_GRACE_MS },
    { POLL_MS: 33, RING_MARGIN: 8, SETTLE_MS: 400, RESOLVE_TIMEOUT_MS: 3000, MAX_REPLANS: 2, PAUSE_LIMIT_MS: 60000, NEW_WINDOW_GRACE_MS: 2000 });
});

test('click inside the ring advances after SETTLE_MS and speaks the next line', async () => {
  const f = fixture();
  await f.start();
  assert.equal(f.walk.state, 'waiting');
  assert.equal(f.walk.index, 0);
  assert.deepEqual(f.s.spoken, ['Click Save']);
  const first = f.s.renders.at(-1);
  assert.ok(first.marks.some(m => m.kind === 'ring' && m.bounds.x === 100 && m.bounds.width === 60));
  assert.ok(first.marks.some(m => m.kind === 'number' && m.text === '1'));
  assert.deepEqual(first.card, { kind: 'steps', title: 'Save a file', items: ['Click Save'], buttons: [{ id: 'next' }, { id: 'stop' }] });

  await f.click(110, 110);
  assert.equal(f.walk.index, 1);
  assert.notEqual(f.walk.state, 'waiting');
  const resolved = f.s.resolves.length;
  await f.advance(SETTLE_MS - 2 * POLL_MS);
  assert.equal(f.s.resolves.length, resolved, 'waits for the UI to settle before resolving');
  assert.deepEqual(f.s.spoken, ['Click Save']);
  await f.advance(2 * POLL_MS);
  assert.equal(f.walk.state, 'waiting');
  assert.deepEqual(f.s.spoken, ['Click Save', 'Now click Open']);
  assert.ok(f.s.renders.at(-1).marks.some(m => m.kind === 'number' && m.text === '2'));

  // The ring grows by RING_MARGIN: a click just outside the box still counts.
  await f.click(300 - RING_MARGIN, 100 - RING_MARGIN);
  assert.equal(f.walk.state, 'ended');
  assert.deepEqual(f.s.ends, [{ reason: 'done' }]);
  assert.equal(f.s.spoken.at(-1), 'line:done');
  assert.deepEqual(f.s.renders.at(-1), { marks: [], card: null });
  assert.equal(f.s.timers.size, 0);
});

test("click on the card's Next advances and never pauses", async () => {
  const f = fixture({ cardBounds: box(600, 500, 180, 80) });
  await f.start();
  await f.click(650, 560);
  await f.advance(500);
  assert.equal(f.walk.state, 'waiting');
  assert.equal(f.walk.index, 0);
  f.walk.cardAction('next');
  await f.advance(SETTLE_MS);
  assert.equal(f.walk.index, 1);
  assert.equal(f.walk.state, 'waiting');
  assert.ok(!f.s.states.includes('paused'));
  // A press on the card released elsewhere is not a pause either.
  await f.press(650, 560);
  await f.release(10, 10);
  assert.equal(f.walk.state, 'waiting');
  f.walk.cardAction('stop');
  assert.deepEqual(f.s.ends, [{ reason: 'stopped' }]);
});

test('click elsewhere pauses; continue resumes and re-resolves the target', async () => {
  const f = fixture();
  await f.start();
  await f.click(500, 500);
  assert.equal(f.walk.state, 'paused');
  assert.ok(f.s.renders.at(-1).marks.length === 0 && f.s.renders.at(-1).card, 'the ring hides, the card stays');
  const reads = f.s.reads;
  await f.advance(1000);
  assert.equal(f.s.reads, reads, 'no polling while paused');
  f.s.found.set('Save', box(120, 140, 60, 20));
  const resolved = f.s.resolves.length;
  f.walk.command('continue');
  await f.advance(0);
  assert.equal(f.walk.state, 'waiting');
  assert.equal(f.walk.index, 0);
  assert.equal(f.s.resolves.length, resolved + 1);
  assert.ok(f.s.renders.at(-1).marks.some(m => m.kind === 'ring' && m.bounds.y === 140));
  // The old ring position no longer counts; the new one does.
  await f.click(110, 110);
  assert.equal(f.walk.state, 'paused');
  f.walk.resume();
  await f.advance(0);
  await f.click(130, 150);
  assert.equal(f.walk.index, 1);
});

test('clicking into one of her own windows does not pause', async () => {
  const f = fixture();
  await f.start();
  f.s.fg = { id: 90, pid: 77, ...box(900, 0, 300, 400) };
  await f.click(950, 50);
  await f.advance(500);
  assert.equal(f.walk.state, 'waiting');
});

test('type/scroll/look steps wait for next by voice or card, not for clicks', async () => {
  const f = fixture({ steps: [step('Name', 'Type a name', 'type'), step('List', 'Scroll the list', 'scroll'), step('Save', 'Look here', 'look')] });
  await f.start();
  assert.equal(f.walk.state, 'waiting');
  await f.advance(1000);
  assert.equal(f.s.reads, 0, 'no pointer polling outside click steps');
  f.s.pointer = { down: true, x: 110, y: 310 };
  await f.advance(100);
  f.s.pointer = { down: false, x: 110, y: 310 };
  await f.advance(100);
  assert.equal(f.walk.index, 0);
  assert.equal(f.walk.state, 'waiting');
  f.walk.command('next');
  await f.advance(SETTLE_MS);
  assert.equal(f.walk.index, 1);
  f.walk.cardAction('next');
  await f.advance(SETTLE_MS);
  assert.equal(f.walk.index, 2);
  assert.deepEqual(f.s.spoken, ['Type a name', 'Scroll the list', 'Look here']);
  f.walk.command('next');
  await f.advance(SETTLE_MS);
  assert.deepEqual(f.s.ends, [{ reason: 'done' }]);
  assert.equal(f.s.reads, 0);
});

test('back returns to the previous step and repeat re-speaks the line without moving', async () => {
  const f = fixture({ steps: [step('Name', 'One', 'look'), step('List', 'Two', 'look'), step('Save', 'Three', 'look')] });
  await f.start();
  f.walk.command('next');
  await f.advance(SETTLE_MS);
  assert.equal(f.walk.index, 1);
  f.walk.command('repeat');
  await f.advance(0);
  assert.equal(f.walk.index, 1);
  assert.equal(f.walk.state, 'waiting');
  assert.deepEqual(f.s.spoken, ['One', 'Two', 'Two']);
  f.walk.command('back');
  await f.advance(SETTLE_MS);
  assert.equal(f.walk.index, 0);
  assert.equal(f.walk.state, 'waiting');
  assert.deepEqual(f.s.spoken, ['One', 'Two', 'Two', 'One']);
  f.walk.command('back');
  await f.advance(SETTLE_MS);
  assert.equal(f.walk.index, 0, 'back stops at the first step');
});

test('a dialog from the same app is expected; another app pauses; 60 s paused ends the walkthrough', async () => {
  const f = fixture();
  await f.start();
  f.s.fg = { id: 6, pid: 9, ...box(200, 200, 300, 200) };
  await f.advance(1000);
  assert.equal(f.walk.state, 'waiting');
  f.s.fg = { id: 7, pid: 33, app: 'chat', ...box(0, 0, 500, 500) };
  await f.advance(1000);
  assert.equal(f.walk.state, 'paused');
  await f.advance(PAUSE_LIMIT_MS - 1500);
  assert.equal(f.walk.state, 'paused');
  await f.advance(1000);
  assert.equal(f.walk.state, 'ended');
  assert.deepEqual(f.s.ends, [{ reason: 'paused-too-long' }]);
  assert.equal(f.s.spoken.at(-1), 'line:paused-too-long');
  assert.equal(f.s.timers.size, 0);
});

test('the expected window coming back resumes a window pause', async () => {
  const f = fixture();
  await f.start();
  f.s.fg = { id: 7, pid: 33, app: 'chat', ...box(0, 0, 500, 500) };
  await f.advance(500);
  assert.equal(f.walk.state, 'paused');
  const resolved = f.s.resolves.length;
  f.s.fg = { id: 5, pid: 9, app: 'editor', ...box(0, 0, 800, 600) };
  await f.advance(500);
  assert.equal(f.walk.state, 'waiting');
  assert.equal(f.s.resolves.length, resolved + 1);
});

test("her own windows never pause, and a new window right after the step's click or of expectApp is expected", async () => {
  const f = fixture({ steps: [step('Save', 'Click Save', 'click', { expectApp: 'Viewer' }), step('Open', 'Open it', 'look'), step('Name', 'Name it', 'look')] });
  await f.start();
  f.s.fg = { id: 90, pid: 77, ...box(900, 0, 300, 400) };
  await f.advance(1000);
  assert.equal(f.walk.state, 'waiting');
  f.s.fg = { id: 5, pid: 9, app: 'editor', ...box(0, 0, 800, 600) };
  await f.click(110, 110);
  // Within the grace period any window is expected, even another app's.
  f.s.fg = { id: 8, pid: 40, app: 'browser', ...box(0, 0, 800, 600) };
  await f.advance(NEW_WINDOW_GRACE_MS - 500);
  assert.notEqual(f.walk.state, 'paused');
  // After it, the app the clicked step named is expected too.
  f.s.fg = { id: 11, pid: 41, app: 'viewer.exe', ...box(0, 0, 800, 600) };
  await f.advance(2000);
  assert.equal(f.walk.state, 'waiting');
  assert.equal(f.walk.index, 1);
  f.s.fg = { id: 12, pid: 42, app: 'mail', ...box(0, 0, 800, 600) };
  await f.advance(500);
  assert.equal(f.walk.state, 'paused');
});

test('missing target re-plans at most twice, then ends with lost', async () => {
  const replans = [];
  const f = fixture({
    steps: [step('Save', 'Click Save', 'look'), step('Gone', 'Click Gone')],
    replan: async args => { replans.push(args); return { title: 'x', steps: [step(`Gone${replans.length}`, `Try ${replans.length}`)] }; },
  });
  await f.start();
  f.walk.command('next');
  await f.advance(SETTLE_MS + RESOLVE_TIMEOUT_MS - 600);
  assert.equal(replans.length, 0);
  assert.equal(f.walk.state, 'resolving');
  const tries = f.s.resolves.filter(n => n === 'Gone').length;
  assert.ok(tries >= 4 && tries <= 6, `retries about every 500 ms (got ${tries})`);
  await f.advance(1000);
  assert.equal(replans.length, 1);
  assert.deepEqual(replans[0], { request: 'Save a file', done: [step('Save', 'Click Save', 'look')], missing: name('Gone') });
  assert.equal(f.walk.index, 1);
  await f.advance(RESOLVE_TIMEOUT_MS + 500);
  assert.equal(replans.length, 2);
  assert.deepEqual(replans[1].missing, name('Gone1'));
  await f.advance(RESOLVE_TIMEOUT_MS + 500);
  assert.equal(replans.length, MAX_REPLANS);
  assert.equal(f.walk.state, 'ended');
  assert.deepEqual(f.s.ends, [{ reason: 'lost' }]);
  assert.equal(f.s.spoken.at(-1), 'line:lost');
});

test('a successful re-plan replaces the remaining steps; a failed one ends with lost', async () => {
  const f = fixture({
    steps: [step('Save', 'Click Save', 'look'), step('Gone', 'Click Gone'), step('Gone', 'Again')],
    replan: async () => ({ title: 'x', steps: [step('Open', 'Open instead', 'look')] }),
  });
  await f.start();
  f.walk.command('next');
  await f.advance(SETTLE_MS + RESOLVE_TIMEOUT_MS + 500);
  assert.equal(f.walk.state, 'waiting');
  assert.equal(f.walk.index, 1);
  assert.equal(f.s.spoken.at(-1), 'Open instead');
  f.walk.command('next');
  await f.advance(SETTLE_MS);
  assert.deepEqual(f.s.ends, [{ reason: 'done' }], 'the old remaining steps are gone');

  for (const replan of [async () => null, async () => { throw Error('offline'); }, async () => ({ title: 'x', steps: [] })]) {
    const g = fixture({ steps: [step('Gone', 'Click Gone')], replan });
    await g.start();
    await g.advance(RESOLVE_TIMEOUT_MS + 500);
    assert.deepEqual(g.s.ends, [{ reason: 'lost' }]);
  }
});

test('pointer polling stops when the step is not a waiting click step', async () => {
  const f = fixture();
  await f.start();
  await f.advance(10 * POLL_MS);
  assert.ok(f.s.reads >= 9);
  f.walk.command('stop');
  const reads = f.s.reads;
  await f.advance(5000);
  assert.equal(f.s.reads, reads);
  assert.equal(f.walk.state, 'ended');
  assert.deepEqual(f.s.ends, [{ reason: 'stopped' }]);
  assert.equal(f.s.timers.size, 0);
  f.walk.command('stop');
  assert.equal(f.s.ends.length, 1, 'onEnd fires once');
  // Settling after a click does not poll either.
  const g = fixture();
  await g.start();
  await g.click(110, 110);
  const settled = g.s.reads;
  await g.advance(SETTLE_MS - 2 * POLL_MS);
  assert.equal(g.s.reads, settled);
});

test('a question pauses and resume continues the current step', async () => {
  const f = fixture();
  await f.start();
  f.walk.question();
  assert.equal(f.walk.state, 'paused');
  const reads = f.s.reads;
  await f.advance(1000);
  assert.equal(f.s.reads, reads);
  f.walk.resume();
  await f.advance(0);
  assert.equal(f.walk.state, 'waiting');
  assert.equal(f.walk.index, 0);
});

function ownData(obj, seen = new Set()) {
  const found = [];
  const visit = v => {
    if (typeof v === 'function' || v === null || typeof v !== 'object') { if (typeof v === 'number') found.push(v); return; }
    if (seen.has(v)) return;
    seen.add(v);
    for (const x of v instanceof Map ? [...v.keys(), ...v.values()] : Object.values(v)) visit(x);
  };
  for (const [, v] of Object.entries(obj)) if (typeof v !== 'function') visit(v);
  return found;
}

test('pointer positions are never kept', async () => {
  const f = fixture();
  await f.start();
  await f.press(SENTINEL, SENTINEL);
  assert.ok(!ownData(f.walk).includes(SENTINEL), 'not kept while pressed');
  await f.release(SENTINEL, SENTINEL);
  assert.equal(f.walk.state, 'paused');
  f.walk.command('stop');
  await f.advance(100);
  assert.equal(f.walk.state, 'ended');
  assert.ok(!ownData(f.walk).includes(SENTINEL));
});

test('a button already held when the step begins is not a click', async () => {
  const f = fixture();
  f.s.pointer = { down: true, x: 110, y: 110 };
  await f.start();
  await f.advance(POLL_MS * 3);
  f.s.pointer = { down: false, x: 110, y: 110 };
  await f.advance(POLL_MS);
  assert.equal(f.walk.index, 0);
  assert.equal(f.walk.state, 'waiting');
});

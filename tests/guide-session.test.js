'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { GuideSession } = require('../src/main/guide-session');
const { CodexTools } = require('../src/main/codex-tools');
const { ScreenAccess } = require('../src/main/screen-access');

const box = (x, y, width, height) => ({ x, y, width, height });
const flush = () => new Promise(resolve => setImmediate(resolve));
const ctx = { check() {}, signal: undefined };

function fixture({ allowed = () => true, keep, render, yieldFocus } = {}) {
  const state = { now: 0, win: { id: 5, pid: 9, ...box(0, 0, 800, 600) }, found: new Map(), reasons: new Map(),
    resolves: [], scenes: [], renders: [], clears: 0, interval: null };
  const targets = {
    resolve: async (target, c) => {
      c?.check?.();
      state.resolves.push(target);
      const key = target.type === 'text' ? target.text : target.id;
      const bounds = state.found.get(key);
      return bounds ? { ok: true, bounds, window: state.win } : { ok: false, reason: state.reasons.get(key) || 'not-found' };
    },
  };
  const layer = {
    render: render || (map => { state.renders.push(map); return Promise.resolve(); }),
    clear: () => { state.clears += 1; },
  };
  const layout = scene => { state.scenes.push(scene); return new Map([[1, { marks: scene.marks, cards: scene.cards }]]); };
  const session = new GuideSession({ targets, layer, layout, allowed, ...(keep ? { keep } : {}), ownPid: 77, yieldFocus,
    foreground: () => state.win, now: () => state.now,
    setInterval: (fn, ms) => { state.interval = { fn, ms }; return 'timer'; },
    clearInterval: token => { if (token === 'timer') state.interval = null; } });
  const tick = async (ms = 250) => {
    for (let t = 0; t < ms; t += 250) {
      state.now += 250;
      state.interval?.fn();
      await flush(); await flush();
    }
  };
  const scene = () => state.scenes.at(-1);
  return { session, state, tick, scene };
}
// Tool-format marks: every field present, empty values mean "none" (see the capri_draw description).
const tgt = (type, value, extra = {}) => ({ type, id: type === 'control' ? value : '', text: type === 'text' ? value : '', nth: 0,
  snapshotId: '', x: 0, y: 0, width: 0, height: 0, ...extra });
const mark = (id, kind, target, more = {}) => ({ id, kind, target, to: [], text: '', ...more });

test('draws resolved marks and reports unresolved ones without guessing', async () => {
  const f = fixture();
  f.state.found.set('Save', box(100, 100, 60, 20));
  f.state.reasons.set('Many', 'ambiguous');
  const result = await f.session.draw({ clear: false, cards: [], marks: [
    mark('a', 'ring', tgt('text', 'Save'), { text: 'Saves your work' }),
    mark('b', 'label', tgt('control', 'c9')),
    mark('c', 'arrow', tgt('text', 'Save'), { to: [tgt('text', 'Gone')] }),
    mark('d', 'underline', tgt('text', 'Many')),
  ] }, ctx);
  assert.deepEqual(result, { drawn: 1, failed: [{ id: 'b', reason: 'not-found' }, { id: 'c', reason: 'not-found' }, { id: 'd', reason: 'ambiguous' }] });
  assert.deepEqual(f.scene().marks, [{ id: 'a', kind: 'ring', bounds: box(100, 100, 60, 20), text: 'Saves your work' }]);
  assert.deepEqual(f.scene().window, box(0, 0, 800, 600));
  assert.equal(f.state.renders.length, 1);
  assert.equal(f.state.resolves[0].nth, undefined, 'nth 0 means no nth');
  assert.equal(f.state.interval.ms, 250);
});

test('an arrow draws only when both ends resolve, and keeps its destination', async () => {
  const f = fixture();
  f.state.found.set('From', box(10, 10, 20, 20)); f.state.found.set('To', box(300, 300, 20, 20));
  const result = await f.session.draw({ marks: [mark('a', 'arrow', tgt('text', 'From'), { to: [tgt('text', 'To')] })], cards: [], clear: false }, ctx);
  assert.equal(result.drawn, 1);
  assert.deepEqual(f.scene().marks[0].toBounds, box(300, 300, 20, 20));
});

test('invalid drawings are rejected before anything resolves or draws', async () => {
  const f = fixture();
  await assert.rejects(f.session.draw({ marks: [mark('a', 'blink', tgt('text', 'Save'))], cards: [], clear: false }, ctx), /marks\[0\]\.kind/);
  assert.equal(f.state.resolves.length, 0);
  assert.equal(f.state.renders.length, 0);
});

test('replacing a mark id keeps the others', async () => {
  const f = fixture();
  f.state.found.set('One', box(10, 10, 10, 10)); f.state.found.set('Two', box(50, 50, 10, 10)); f.state.found.set('Three', box(90, 90, 10, 10));
  await f.session.draw({ marks: [mark('a', 'ring', tgt('text', 'One')), mark('b', 'ring', tgt('text', 'Two'))], cards: [], clear: false }, ctx);
  await f.session.draw({ marks: [mark('a', 'label', tgt('text', 'Three'), { text: 'Moved' })], cards: [], clear: false }, ctx);
  assert.deepEqual(f.scene().marks.map(m => [m.id, m.kind, m.text]), [['a', 'label', 'Moved'], ['b', 'ring', undefined]]);
  // Within one call the later mark with the same id wins.
  const result = await f.session.draw({ marks: [mark('b', 'ring', tgt('text', 'One')), mark('b', 'number', tgt('text', 'Three'))], cards: [], clear: false }, ctx);
  assert.equal(result.drawn, 1);
  assert.deepEqual(f.scene().marks.filter(m => m.id === 'b'), [{ id: 'b', kind: 'number', bounds: box(90, 90, 10, 10) }]);
  // clear:true starts a fresh drawing.
  await f.session.draw({ marks: [mark('z', 'ring', tgt('text', 'Two'))], cards: [{ kind: 'note', title: '', text: 'Hi', items: [], columns: [], rows: [] }], clear: true }, ctx);
  assert.deepEqual(f.scene().marks.map(m => m.id), ['z']);
  assert.equal(f.scene().cards.length, 1);
});

test('clears when the foreground window changes', async () => {
  const f = fixture();
  f.state.found.set('Save', box(100, 100, 60, 20));
  await f.session.draw({ marks: [mark('a', 'ring', tgt('text', 'Save'))], cards: [], clear: false }, ctx);
  await f.tick();
  assert.equal(f.state.clears, 0);
  f.state.win = { ...f.state.win, id: 6 };
  await f.tick();
  assert.equal(f.state.clears, 1);
  assert.equal(f.state.interval, null);
  assert.equal(f.session.active, false);
});

test('hides while the window moves and re-places after 500 ms of stillness', async () => {
  const f = fixture();
  f.state.found.set('Save', box(100, 100, 60, 20));
  f.state.found.set('c1', box(10, 10, 10, 10));
  await f.session.draw({ marks: [mark('a', 'ring', tgt('text', 'Save')), mark('b', 'ring', tgt('control', 'c1'))], cards: [], clear: false }, ctx);
  f.state.win = { ...f.state.win, x: 40, y: 30 };
  await f.tick();
  assert.equal(f.state.renders.at(-1).size, 0, 'hidden while moving');
  f.state.win = { ...f.state.win, x: 50, y: 30 };
  await f.tick(250);
  await f.tick(250);
  assert.equal(f.state.renders.length, 2, 'still hidden 250 ms after the last move');
  // Moved by (50, 30) without resizing: text is read again where it now is; a control's
  // cached geometry moves with its window.
  f.state.found.set('Save', box(150, 130, 60, 20));
  const before = f.state.resolves.length;
  await f.tick(250);
  assert.equal(f.state.renders.length, 3);
  assert.deepEqual(f.scene().marks.map(m => m.bounds), [box(150, 130, 60, 20), box(60, 40, 10, 10)]);
  assert.deepEqual(f.state.resolves.slice(before).map(t => t.type), ['text']);
  assert.deepEqual(f.scene().window, box(50, 30, 800, 600));
  assert.equal(f.state.clears, 0);
  // After a resize, cached geometry can't be trusted and unfound text is dropped, never guessed; nothing left clears.
  f.state.win = { ...f.state.win, width: 900 };
  f.state.found.delete('Save');
  await f.tick(1000);
  assert.equal(f.state.clears, 1);
  assert.equal(f.session.active, false);
});

test('clears after two minutes idle', async () => {
  const f = fixture();
  f.state.found.set('Save', box(100, 100, 60, 20));
  await f.session.draw({ marks: [mark('a', 'ring', tgt('text', 'Save'))], cards: [], clear: false }, ctx);
  await f.tick(60000);
  f.session.touch();
  await f.tick(119750);
  assert.equal(f.state.clears, 0);
  await f.tick(250);
  assert.equal(f.state.clears, 1);
  assert.equal(f.state.interval, null);
});

test('refuses to draw when screen awareness is off, or in Gaming mode outside a voice session', async () => {
  // Same expression main.js uses: ScreenAccess.enabled() over agentConfig, which lifts Gaming mode for a voice session.
  let cfg = { screenAwareness: false, gamingMode: false }, voice = false;
  const screenAccess = new ScreenAccess({ settings: () => voice ? { ...cfg, gamingMode: false } : cfg });
  // keep: main's rule for a drawing already shown (only screen awareness itself; Gaming mode on clears it in main).
  const f = fixture({ allowed: () => screenAccess.enabled(), keep: () => cfg.screenAwareness !== false });
  f.state.found.set('Save', box(100, 100, 60, 20));
  const args = () => ({ marks: [mark('a', 'ring', tgt('text', 'Save'))], cards: [], clear: false });
  await assert.rejects(f.session.draw(args(), ctx), /screen awareness/i);
  cfg = { screenAwareness: true, gamingMode: true };
  await assert.rejects(f.session.draw(args(), ctx), /screen awareness/i);
  assert.equal(f.state.resolves.length, 0);
  assert.equal(f.state.renders.length, 0);
  voice = true;
  assert.equal((await f.session.draw(args(), ctx)).drawn, 1);
  // The voice session that asked for it ends (still in Gaming mode): the drawing stays until its own lifetime ends.
  voice = false;
  await f.tick();
  assert.equal(f.state.clears, 0, 'a drawing survives the end of the voice session');
  assert.equal(f.session.active, true);
  await assert.rejects(f.session.draw(args(), ctx), /screen awareness/i, 'but no new drawing starts without the lift');
  // Turning screen awareness off clears it on the next check.
  cfg = { screenAwareness: false, gamingMode: true };
  await f.tick();
  assert.equal(f.state.clears, 1);
});

test('a rejected render is logged once and never thrown into timers', async t => {
  const errors = t.mock.method(console, 'error', () => {});
  const f = fixture({ render: () => Promise.reject(Error('window replaced')) });
  f.state.found.set('Save', box(100, 100, 60, 20));
  await f.session.draw({ marks: [mark('a', 'ring', tgt('text', 'Save'))], cards: [], clear: false }, ctx);
  await flush();
  assert.equal(errors.mock.callCount(), 1);
  f.state.win = { ...f.state.win, x: 10 };
  await f.tick();
  await flush();
  assert.equal(errors.mock.callCount(), 2);
  assert.match(String(errors.mock.calls[0].arguments[0]), /guide/i);
});

test('tool descriptions for capri_draw stay within budget', async () => {
  const calls = [];
  const guide = { draw: async (args, c) => { calls.push([args, c]); return { drawn: 1, failed: [] }; } };
  let enabled = true;
  const tools = new CodexTools({ settings: () => ({}), guide, screen: { enabled: () => enabled } });
  const spec = tools.specs().find(row => row.name === 'capri_draw');
  assert.ok(spec);
  assert.ok(Buffer.byteLength(spec.description) <= 450, `${Buffer.byteLength(spec.description)} bytes`);
  assert.deepEqual(spec.inputSchema.required, ['marks', 'cards', 'clear']);
  const walk = schema => {
    if (schema.type === 'object') { assert.deepEqual(schema.required, Object.keys(schema.properties)); Object.values(schema.properties).forEach(walk); }
    if (schema.type === 'array') walk(schema.items);
  };
  walk(spec.inputSchema);
  enabled = false;
  assert.equal(tools.specs().some(row => row.name === 'capri_draw'), false);
  assert.equal(new CodexTools({ settings: () => ({}), screen: { enabled: () => true } }).specs().some(row => row.name === 'capri_draw'), false);

  const check = () => {}, signal = new AbortController().signal;
  const args = { marks: [], cards: [], clear: true };
  assert.deepEqual(await tools.execute('capri_draw', args, { check, signal }), { drawn: 1, failed: [] });
  assert.equal(calls[0][0], args);
  assert.equal(calls[0][1].check, check);
  assert.equal(calls[0][1].signal, signal);
  await assert.rejects(tools.execute('capri_draw', { marks: [], cards: [] }, { check, signal }), /Invalid Capri tool arguments/);
});

test('a draw right after typing in her own window yields focus, then draws on the window behind', async () => {
  const yields = [];
  const f = fixture({ yieldFocus: async () => { yields.push(1); f.state.win = { id: 5, pid: 9, ...box(0, 0, 800, 600) }; } });
  f.state.win = { id: 99, pid: 77, ...box(10, 10, 300, 400) };
  f.state.found.set('Save', box(100, 100, 60, 20));
  const result = await f.session.draw({ marks: [mark('a', 'ring', tgt('text', 'Save'))], cards: [], clear: false }, ctx);
  assert.equal(yields.length, 1);
  assert.equal(result.drawn, 1);
  assert.deepEqual(f.scene().window, box(0, 0, 800, 600));
  // Still her own window (or nothing) after yielding: fail plainly, draw nothing.
  const g = fixture({ yieldFocus: async () => {} });
  g.state.win = { id: 99, pid: 77, ...box(10, 10, 300, 400) };
  await assert.rejects(g.session.draw({ marks: [mark('a', 'ring', tgt('text', 'Save'))], cards: [], clear: false }, ctx), /foreground window/);
  assert.equal(g.state.resolves.length, 0);
});

test('her own window in front keeps the drawing; another external window clears it', async () => {
  const f = fixture();
  f.state.found.set('Save', box(100, 100, 60, 20));
  await f.session.draw({ marks: [mark('a', 'ring', tgt('text', 'Save'))], cards: [], clear: false }, ctx);
  const annotated = f.state.win;
  f.state.win = { id: 99, pid: 77, ...box(10, 10, 300, 400) }; // her chat panel, overlay or the guide layer
  await f.tick(1000);
  assert.equal(f.state.clears, 0);
  assert.equal(f.session.active, true);
  assert.equal(f.state.renders.length, 1, 'not hidden either');
  f.state.win = annotated;
  await f.tick();
  assert.equal(f.state.clears, 0);
  f.state.win = { id: 6, pid: 10, ...box(0, 0, 800, 600) };
  await f.tick();
  assert.equal(f.state.clears, 1);
});

test('a native error in the lifetime check clears the drawing instead of throwing into the timer', async t => {
  t.mock.method(console, 'error', () => {});
  const f = fixture();
  f.state.found.set('Save', box(100, 100, 60, 20));
  await f.session.draw({ marks: [mark('a', 'ring', tgt('text', 'Save'))], cards: [], clear: false }, ctx);
  f.session.foreground = () => { throw Error('native call failed'); };
  assert.doesNotThrow(() => f.state.interval.fn());
  assert.equal(f.state.clears, 1);
  assert.equal(f.session.active, false);
});

test('user-facing errors use the display name', async () => {
  const { DISPLAY_NAME } = require('../src/main/identity');
  const f = fixture({ allowed: () => false });
  await assert.rejects(f.session.draw({ marks: [], cards: [], clear: false }, ctx), err => err.message.includes(DISPLAY_NAME));
});

test('main never clears a drawing just because a new request arrives', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/main/main.js'), 'utf8');
  const reasons = [...src.matchAll(/guide\.clear\('([^']+)'\)/g)].map(m => m[1]).sort();
  assert.deepEqual([...new Set(reasons)], ['locked', 'paused', 'quit'], 'lifetime: lock/suspend, Gaming mode or screen awareness off, quit');
});

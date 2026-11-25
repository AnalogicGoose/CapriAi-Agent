'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CodexTools } = require('../src/main/codex-tools');
const { WalkthroughController, walkthroughCommand } = require('../src/main/walkthrough-controller');
const { WALKTHROUGH_SCHEMA } = require('../src/main/guide-schema');
const { guideLine, guideButton, KINDS } = require('../src/main/guide-lines');
const { WATCH_MS, PAUSE_LIMIT_MS, RESOLVE_TIMEOUT_MS } = require('../src/main/walkthrough');
const { ExclusiveFullscreenGate, QUNS_RUNNING_D3D_FULL_SCREEN } = require('../src/main/exclusive-fullscreen');
const { GuideSession } = require('../src/main/guide-session');

const box = (x, y, width, height) => ({ x, y, width, height });
const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise(resolve => setImmediate(resolve)); };
// Tool format: every field present, "" / 0 mean none.
const target = (name, more = {}) => ({ type: 'name', id: '', text: '', nth: 0, snapshotId: '', x: 0, y: 0, width: 0, height: 0, name, role: '', ...more });
const toolStep = (name, say, action = 'click') => ({ target: target(name), say, action, expectApp: '' });
const PLAN = { title: 'Change the refresh rate', steps: [toolStep('Display', 'Open Display'), toolStep('Advanced display', 'Now Advanced display')] };
const SHOT = 'data:image/jpeg;base64,AAAA';

function fixture({ lang = 'en', busy = () => false, infer = async () => null, snapshot, found = true, displays, dipToScreen, extra = {} } = {}) {
  const s = {
    now: 0, timers: new Map(), nextId: 1, spoken: [], renders: [], interactive: [], cleared: [], rows: 0,
    fg: { id: 5, pid: 9, ...box(0, 0, 800, 600) }, pointer: { down: false, x: -5000, y: -5000 }, cursor: { x: -5000, y: -5000 },
    hover: null, infers: [], snapshots: 0, active: [],
  };
  const setTimer = (fn, ms) => { const id = s.nextId++; s.timers.set(id, { fn, at: s.now + ms }); return id; };
  const ctl = new WalkthroughController({
    targets: { resolve: async () => (found ? { ok: true, bounds: box(100, 100, 60, 20), window: { ...s.fg } } : { ok: false, reason: 'not-found' }) },
    layer: { render: async scene => { s.renders.push(scene); }, setCardInteractive: (id, on) => s.interactive.push([id, on]) },
    displays: displays || (() => [{ id: 1, bounds: box(0, 0, 1920, 1080) }]),
    screenToDip: r => ({ ...r }), dipToScreen: dipToScreen || (r => ({ ...r })),
    cursor: () => ({ ...s.cursor }), foreground: () => (s.fg ? { ...s.fg } : null), pointer: () => ({ ...s.pointer }),
    processRows: () => { s.rows += 1; return [{ id: 9, name: 'systemsettings' }, { id: 12, name: 'chrome' }]; },
    speak: text => s.spoken.push(text), lang: () => lang,
    snapshot: snapshot || (async () => { s.snapshots += 1; return { image: SHOT, snapshotId: 'snap-1', width: 1600, height: 900 }; }),
    infer: async request => { s.infers.push(request); return infer(request); },
    busy, guide: { clear: reason => s.cleared.push(reason) }, ownPid: 77, onActive: on => s.active.push(on),
    now: () => s.now, setTimer, clearTimer: id => { s.timers.delete(id); },
    sleep: async ms => { s.now += ms; },
    every: fn => { s.hover = fn; return 'hover'; }, stopEvery: () => { s.hover = null; },
    ...extra,
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
    }
    s.now = end;
    await flush();
  };
  return { ctl, s, advance };
}

const tools = ctl => new CodexTools({ settings: () => ({}), guide: { draw: async () => ({}) }, screen: { enabled: () => true }, walkthroughs: ctl });
const ctx = (text = 'how do I change the refresh rate?') => ({ text, check: () => {}, signal: new AbortController().signal });

test('the tool starts one walkthrough and refuses a second', async () => {
  const f = fixture();
  const t = tools(f.ctl);
  const spec = t.specs().find(row => row.name === 'capri_walkthrough');
  assert.ok(spec);
  assert.ok(Buffer.byteLength(spec.description) <= 500, `${Buffer.byteLength(spec.description)} bytes`);
  assert.equal(spec.inputSchema, WALKTHROUGH_SCHEMA);
  const walk = schema => {
    if (schema.type === 'object') { assert.deepEqual(schema.required, Object.keys(schema.properties)); Object.values(schema.properties).forEach(walk); }
    if (schema.type === 'array') walk(schema.items);
  };
  walk(WALKTHROUGH_SCHEMA);
  assert.match(t.instructions(), /capri_walkthrough/);
  assert.ok(Buffer.byteLength(require('../src/main/personality').WALKTHROUGH_INSTRUCTIONS) <= 300);
  // Not offered without the controller, or while screen awareness is off.
  assert.equal(new CodexTools({ settings: () => ({}), screen: { enabled: () => true } }).specs().some(row => row.name === 'capri_walkthrough'), false);
  assert.doesNotMatch(new CodexTools({ settings: () => ({}), screen: { enabled: () => true } }).instructions(), /capri_walkthrough/);
  assert.equal(new CodexTools({ settings: () => ({}), screen: { enabled: () => false }, walkthroughs: f.ctl }).specs().some(row => row.name === 'capri_walkthrough'), false);

  assert.deepEqual(await t.execute('capri_walkthrough', PLAN, ctx()), { started: true, steps: 2 });
  await f.advance(0);
  assert.equal(f.ctl.active, true);
  assert.deepEqual(f.s.cleared, ['walkthrough']); // an explain drawing gives the layer to the walkthrough
  assert.equal(f.ctl.current.request, 'how do I change the refresh rate?');
  assert.equal(f.ctl.current.state, 'waiting');
  assert.deepEqual(f.s.spoken, ['Open Display']);
  await assert.rejects(t.execute('capri_walkthrough', PLAN, ctx()), /A walkthrough is already running\./);
  await assert.rejects(t.execute('capri_draw', { marks: [], cards: [], clear: true }, ctx()), /walkthrough/i);
  await assert.rejects(t.execute('capri_walkthrough', { title: 'x' }, ctx()), /Invalid Capri tool arguments/);

  // The card carries localized buttons, and its native bounds come back to the walkthrough.
  const scene = f.s.renders.at(-1).get(1);
  assert.deepEqual(scene.cards[0].buttons, [{ id: 'next', label: guideButton('next', 'en') }, { id: 'stop', label: guideButton('stop', 'en') }]);
  const card = scene.cards[0].box;
  assert.deepEqual(f.ctl.current.cardBox, card);

  // Only while the cursor is over the card is its window clickable.
  f.s.cursor = { x: card.x + 5, y: card.y + 5 };
  f.s.hover();
  f.s.hover();
  f.s.cursor = { x: card.x - 50, y: card.y + 5 };
  f.s.hover();
  assert.deepEqual(f.s.interactive, [[1, true], [1, false]]);
  f.s.cursor = { x: card.x + 5, y: card.y + 5 };
  f.s.hover();
  f.ctl.stop();
  assert.equal(f.ctl.active, false);
  assert.equal(f.s.hover, null);
  assert.deepEqual(f.s.interactive.at(-1), [1, false]);
  assert.deepEqual(await t.execute('capri_walkthrough', PLAN, ctx()), { started: true, steps: 2 });
});

test('render maps the card box from its display to native pixels', async () => {
  const displays = () => [{ id: 1, bounds: box(0, 0, 1920, 1080) }, { id: 2, bounds: box(1920, 0, 1280, 1024) }];
  const f = fixture({ displays, dipToScreen: r => ({ x: r.x * 1.5, y: r.y * 1.5, width: r.width * 1.5, height: r.height * 1.5 }) });
  f.s.fg = { id: 5, pid: 9, ...box(1940, 20, 600, 400) };
  const out = await f.ctl.render([], { kind: 'steps', title: 'T', items: ['Click it'], buttons: [{ id: 'next' }, { id: 'stop' }] }, { window: { ...f.s.fg } });
  const rel = f.s.renders.at(-1).get(2).cards[0].box;
  assert.deepEqual(out.cardBounds, { x: (rel.x + 1920) * 1.5, y: rel.y * 1.5, width: rel.width * 1.5, height: rel.height * 1.5 });
  assert.deepEqual(await f.ctl.render([], null), { cardBounds: null });
});

test('walkthrough reports its target and clears at the end', async () => {
  const focus = [];
  const f = fixture({ extra: { focus: e => focus.push(e) } });
  const mark = { id: 'm1', kind: 'ring', bounds: box(100, 100, 60, 20) };
  await f.ctl.render([mark], { kind: 'steps', title: 'T', items: ['Click'], buttons: [] }, { window: { ...f.s.fg } });
  assert.deepEqual(focus.at(-1), { displayId: 1, rect: box(100, 100, 60, 20) });
  await f.ctl.render([], { kind: 'steps', title: 'T', items: ['Click'], buttons: [] }, { window: { ...f.s.fg } });
  assert.equal(focus.at(-1).displayId, 1);
  assert.equal(focus.at(-1).rect.width, f.s.renders.at(-1).get(1).cards[0].box.width);
  const t = tools(f.ctl);
  await t.execute('capri_walkthrough', PLAN, ctx());
  await f.advance(0);
  f.ctl.stop();
  await f.advance(0);
  assert.equal(focus.at(-1), null);
  const g = fixture({ extra: { focus: () => { throw Error('x'); } } });
  await assert.doesNotReject(g.ctl.render([mark], null));
  await g.ctl.render([mark], null);
  assert.equal(g.s.renders.length, 2, 'rendering continues after a throwing focus');
});

test('a render finishing after the walkthrough ended sends no stale focus', async () => {
  const focus = [];
  let release;
  const f = fixture({ extra: { focus: e => focus.push(e) } });
  const t = tools(f.ctl);
  await t.execute('capri_walkthrough', PLAN, ctx());
  await f.advance(0);
  const real = f.ctl.layer.render;
  f.ctl.layer.render = () => { f.ctl.layer.render = real; return new Promise(resolve => { release = resolve; }); }; // only this one render hangs
  const late = f.ctl.render([{ id: 'm', kind: 'ring', bounds: box(100, 100, 60, 20) }], null);
  f.ctl.stop();
  await f.advance(0);
  const before = focus.length;
  assert.equal(focus.at(-1), null);
  release();
  await late;
  assert.equal(focus.length, before, 'the late render must not send focus');
});

test('replacing a walkthrough does not clear focus; the new target takes over', async () => {
  const focus = [];
  const f = fixture({ extra: { focus: e => focus.push(e) } });
  const t = tools(f.ctl);
  await t.execute('capri_walkthrough', PLAN, ctx());
  await f.advance(0);
  assert.ok(focus.length > 0 && !focus.includes(null));
  f.ctl.awaiting = true;
  await t.execute('capri_walkthrough', PLAN, ctx());
  await f.advance(0);
  assert.ok(!focus.includes(null));
  assert.ok(focus.at(-1)?.rect);
});

test('appName comes from the process table, cached per pid', () => {
  const f = fixture();
  assert.equal(f.ctl.appName({ id: 1, pid: 12 }), 'chrome');
  assert.equal(f.ctl.appName({ id: 2, pid: 12 }), 'chrome');
  assert.equal(f.ctl.appName({ id: 3, pid: 9 }), 'systemsettings');
  assert.equal(f.ctl.appName({ id: 4, pid: 9 }), 'systemsettings');
  assert.equal(f.s.rows, 2);
  assert.equal(f.ctl.appName({ id: 5, pid: 404 }), null);
});

test('re-plan sends one image and validates the reply; invalid replies count as a failed re-plan', async () => {
  let busyCalls = 0;
  const good = { title: 'Refresh rate', steps: [toolStep('Advanced display', 'Try Advanced display here', 'click')] };
  good.steps[0].target.nth = 0;
  const f = fixture({ lang: 'es', busy: () => ++busyCalls <= 3, infer: async () => JSON.stringify(good) });
  const done = [{ target: { type: 'name', name: 'Display' }, say: 'Open Display', action: 'click' }];
  const plan = await f.ctl.replan({ request: 'cambia la tasa de refresco', done, missing: { type: 'name', name: 'Advanced display' } });
  assert.equal(f.s.now, 750); // waited for the chat turn, polling every 250 ms
  assert.deepEqual(plan, { title: 'Refresh rate', steps: [{ target: { type: 'name', name: 'Advanced display' }, say: 'Try Advanced display here', action: 'click' }] });
  assert.equal(f.s.infers.length, 1);
  const request = f.s.infers[0];
  assert.equal(request.schema, WALKTHROUGH_SCHEMA);
  assert.deepEqual(request.images, [SHOT]);
  assert.equal(request.messages[0].role, 'system');
  assert.equal(request.messages[1].role, 'user');
  assert.deepEqual({ ...request.messages[1].content, snapshot: undefined },
    { request: 'cambia la tasa de refresco', done, missing: { type: 'name', name: 'Advanced display' }, language: 'es', snapshot: undefined });

  for (const reply of ['not json', JSON.stringify({ title: 'x', steps: [] }), JSON.stringify({ title: 'x', steps: [{ target: { type: 'pixel' }, say: 'a', action: 'click' }] })]) {
    const g = fixture({ infer: async () => reply });
    assert.equal(await g.ctl.replan({ request: 'r', done: [], missing: { type: 'name', name: 'x' } }), null, reply);
  }
  const failing = fixture({ infer: async () => { throw Error('Gaming mode is on.'); } });
  assert.equal(await failing.ctl.replan({ request: 'r', done: [], missing: {} }), null);
  const noScreen = fixture({ snapshot: async () => { throw Error('Screen awareness is paused.'); } });
  assert.equal(await noScreen.ctl.replan({ request: 'r', done: [], missing: {} }), null);
  assert.equal(noScreen.s.infers.length, 0);
  const stuck = fixture({ busy: () => true });
  assert.equal(await stuck.ctl.replan({ request: 'r', done: [], missing: {} }), null);
  assert.equal(stuck.s.now, 10000);
  assert.equal(stuck.s.infers.length, 0);
  assert.equal(stuck.s.snapshots, 0);

  // Wired: an unfound target asks for one re-plan, and the new steps run.
  const w = fixture({ infer: async () => JSON.stringify(good) });
  let calls = 0;
  w.ctl.targets = { resolve: async t => (t.name === 'Advanced display' || ++calls > 99
    ? { ok: true, bounds: box(100, 100, 60, 20), window: { ...w.s.fg } } : { ok: false, reason: 'not-found' }) };
  w.ctl.start(PLAN, { request: 'refresh rate' });
  await w.advance(RESOLVE_TIMEOUT_MS + 600);
  assert.equal(w.s.infers.length, 1);
  assert.equal(w.ctl.current.state, 'waiting');
  assert.equal(w.ctl.current.step.say, 'Try Advanced display here');
});

test('a question pauses and the answer resumes; a new task or stop ends it', async () => {
  const f = fixture({ lang: 'es' });
  f.ctl.start(PLAN, { request: 'tasa de refresco' });
  await f.advance(0);
  assert.equal(f.ctl.current.state, 'waiting');
  const w = f.ctl.current;
  assert.equal(f.ctl.route('¿y eso para qué sirve?'), null); // goes on to Codex
  assert.equal(w.state, 'paused');
  await f.advance(PAUSE_LIMIT_MS * 2); // a question pause never times out
  assert.equal(w.state, 'paused');
  f.ctl.answered();
  await f.advance(0);
  assert.equal(w.state, 'waiting');
  f.ctl.answered(); // no pending question: nothing happens
  assert.equal(w.state, 'waiting');

  // Local commands are handled without Codex.
  const next = f.ctl.route('siguiente');
  assert.equal(next.handled, true);
  await f.advance(1000);
  assert.equal(w.index, 1);

  // Any other request also only pauses it and goes on to Codex; the answer resumes it.
  assert.equal(f.ctl.route('abre spotify y pon música relajante'), null);
  assert.equal(w.state, 'paused');
  f.ctl.answered();
  await f.advance(0);
  assert.equal(w.state, 'waiting');
  f.ctl.stop();
  assert.equal(f.ctl.active, false);
  assert.equal(f.ctl.route('¿qué hora es?'), null); // nothing running: untouched

  f.ctl.start(PLAN, {});
  await f.advance(0);
  const stopped = f.ctl.route('Para.');
  assert.equal(stopped.handled, true);
  assert.equal(typeof stopped.text, 'string');
  assert.equal(f.ctl.active, false);

  // A walkthrough paused for a question is replaced when Codex starts a new one for it.
  f.ctl.start(PLAN, {});
  await f.advance(0);
  f.ctl.route('what does that do?');
  assert.deepEqual(f.ctl.start(PLAN, { request: 'again' }), { started: true, steps: 2 });
  assert.equal(f.ctl.current.request, 'again');

  assert.deepEqual(['next', 'siguiente', 'Suivant !', 'próximo', 'далее', 'back', 'atrás', 'repeat', 'repite', 'stop', 'continue', 'continúa', 'hey capri, next']
    .map(walkthroughCommand), ['next', 'next', 'next', 'next', 'next', 'back', 'back', 'repeat', 'repeat', 'stop', 'continue', 'continue', 'next']);
  assert.equal(walkthroughCommand('next time remind me'), null);
});

test('every walkthrough ending speaks a guideLine in the user\'s language', async () => {
  for (const lang of ['es', 'en']) {
    // done: the card's Next on the last step
    const done = fixture({ lang });
    done.ctl.start({ title: 'One', steps: [toolStep('Display', 'Open Display')] }, {});
    await done.advance(0);
    done.ctl.cardAction(1, 'next');
    await done.advance(0);
    assert.equal(done.s.spoken.at(-1), guideLine('done', lang));
    assert.equal(done.ctl.active, false);
    assert.equal(done.s.hover, null);

    // lost: the target never appears and the re-plan reply is invalid
    const lost = fixture({ lang, found: false, infer: async () => '{"title":"x"}' });
    lost.ctl.start(PLAN, {});
    await lost.advance(RESOLVE_TIMEOUT_MS + 1000);
    assert.equal(lost.s.spoken.at(-1), guideLine('lost', lang));
    assert.equal(lost.ctl.active, false);

    // paused-too-long: another app came to the front and never left
    const paused = fixture({ lang });
    paused.ctl.start(PLAN, {});
    await paused.advance(0);
    paused.s.fg = { id: 44, pid: 12, ...box(0, 0, 500, 500) };
    await paused.advance(WATCH_MS * 2);
    assert.equal(paused.ctl.current.state, 'paused');
    await paused.advance(PAUSE_LIMIT_MS + 1000);
    assert.equal(paused.s.spoken.at(-1), guideLine('paused-too-long', lang));
    assert.equal(paused.ctl.active, false);
  }
  assert.notEqual(guideLine('done', 'es'), guideLine('done', 'en'));
  for (const kind of KINDS) for (const lang of ['en', 'es', 'fr', 'pt', 'ru']) assert.ok(guideLine(kind, lang).length > 0, `${kind}/${lang}`);
  assert.equal(guideLine('done', 'xx'), guideLine('done', 'en'));
  assert.ok(KINDS.includes('exclusive-fullscreen'));
  for (const lang of ['en', 'es', 'fr', 'pt', 'ru']) {
    assert.ok(!/capri/i.test(guideLine('paused', lang)), `paused/${lang} has no literal name`);
    assert.ok(guideButton('continue', lang) && guideButton('continue', lang) !== 'continue', `continue/${lang}`);
  }
  assert.notEqual(guideLine('paused', 'es'), guideLine('paused', 'en'));
});

test('combined new tool descriptions stay under 1500 bytes', () => {
  const t = tools(fixture().ctl);
  t.reminders = { list: () => [] };
  const specs = t.specs();
  const names = ['capri_draw', 'capri_walkthrough', 'capri_reminder'];
  const total = specs.filter(row => names.includes(row.name)).reduce((sum, row) => sum + Buffer.byteLength(row.description), 0);
  assert.ok(specs.some(row => row.name === 'capri_draw') && specs.some(row => row.name === 'capri_walkthrough') && specs.some(row => row.name === 'capri_reminder'));
  assert.ok(total < 1500, `${total} bytes`);
});

test('in-task remarks pause and resume; polite commands work; only a stop command ends it', async () => {
  const f = fixture();
  f.ctl.start(PLAN, {});
  await f.advance(0);
  const w = f.ctl.current;
  for (const remark of ['I can\'t find it', 'no lo veo', 'I clicked it', 'thanks', 'open spotify', 'je ne le vois pas']) {
    assert.equal(f.ctl.route(remark), null, remark);
    assert.equal(w.state, 'paused', remark);
    f.ctl.answered();
    await f.advance(0);
    assert.equal(w.state, 'waiting', remark);
    assert.equal(f.ctl.current, w, remark);
  }
  // A remark while paused for another window must not resume it when answered.
  f.s.fg = { id: 44, pid: 12, ...box(0, 0, 500, 500) };
  await f.advance(WATCH_MS * 2);
  assert.equal(w.pauseCause, 'window');
  f.ctl.route('where did it go');
  f.ctl.answered();
  await f.advance(0);
  assert.equal(w.state, 'paused');
  assert.equal(w.pauseCause, 'window');
  f.s.fg = { id: 5, pid: 9, ...box(0, 0, 800, 600) };
  await f.advance(WATCH_MS * 2);
  assert.equal(w.state, 'waiting');

  assert.deepEqual(['next please', 'Next step, please!', 'siguiente por favor', 'el siguiente paso', 'por favor, siguiente',
    'suivant s\'il te plaît', 'Suivant, s’il vous plaît', 'próximo, por favor', 'дальше, пожалуйста', 'следующий шаг',
    'go back please', 'repite por favor', 'stop please', 'para, por favor', 'arrête s\'il te plaît', 'стоп пожалуйста']
    .map(walkthroughCommand), ['next', 'next', 'next', 'next', 'next', 'next', 'next', 'next', 'next', 'next',
    'back', 'repeat', 'stop', 'stop', 'stop', 'stop']);
  for (const remark of ['I can\'t find it', 'no lo veo', 'I clicked it', 'please', 'next time remind me']) assert.equal(walkthroughCommand(remark), null, remark);

  assert.equal(f.ctl.route('siguiente por favor').handled, true);
  await f.advance(1000);
  assert.equal(w.index, 1);
  assert.equal(f.ctl.route('Stop, please.').handled, true);
  assert.equal(f.ctl.active, false);
});

test('a rejected replacement plan leaves the paused walkthrough in place', async () => {
  const f = fixture();
  f.ctl.start(PLAN, {});
  await f.advance(0);
  const w = f.ctl.current;
  f.ctl.route('how do I do the other thing?');
  assert.throws(() => f.ctl.start({ title: 'bad', steps: [] }, {}), /steps/);
  assert.equal(f.ctl.current, w);
  f.ctl.allowed = () => false;
  assert.throws(() => f.ctl.start(PLAN, {}), /Screen awareness/);
  assert.equal(f.ctl.current, w);
  f.ctl.answered();
  await f.advance(0);
  assert.equal(w.state, 'waiting');
});

test('chat:stop for the turn that started it leaves the walkthrough running; any other stop ends it', async () => {
  const f = fixture();
  const t = tools(f.ctl);
  assert.deepEqual(await t.execute('capri_walkthrough', PLAN, { ...ctx(), turn: 41 }), { started: true, steps: 2 });
  await f.advance(0);
  f.ctl.chatStopped(41);
  assert.equal(f.ctl.active, true);
  f.ctl.chatStopped(42);
  assert.equal(f.ctl.active, false);
  f.ctl.start(PLAN, { turn: 50 });
  f.ctl.chatStopped(undefined);
  assert.equal(f.ctl.active, false);
});

test('the decision brain follows agentConfig, so a voice session lifts Gaming mode for re-plans', () => {
  // Re-plans call decisionBrain.chat, which refuses while settings().gamingMode; main gives it agentConfig.
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /const agentConfig = \(\) => voiceSession \? \{ \.\.\.config\.load\(\), gamingMode: false \}/);
  assert.match(main, /const decisionBrain = new CodexBrain\(\{ settings: agentConfig,/);
});

test('personal:route results resume a question pause unless the request goes on to chat', async () => {
  const f = fixture();
  f.ctl.start(PLAN, {});
  await f.advance(0);
  f.ctl.route('why?');
  assert.deepEqual(f.ctl.afterRoute({ handled: false }), { handled: false });
  assert.equal(f.ctl.current.state, 'paused');
  f.ctl.afterRoute({ handled: false }, true); // commands-only chat: no chat:send follows
  await f.advance(0);
  assert.equal(f.ctl.current.state, 'waiting');
  f.ctl.route('why?');
  f.ctl.afterRoute({ handled: true, text: 'local' });
  await f.advance(0);
  assert.equal(f.ctl.current.state, 'waiting');
});

test('the card carries the listening flag while commands listening is open, and a replacement keeps listening on', async () => {
  const f = fixture();
  const cardOf = scene => [...scene.values()].flatMap(v => v.cards || [])[0];
  f.ctl.start(PLAN, {});
  await f.advance(0);
  assert.deepEqual(f.s.active, [true]);
  assert.equal(cardOf(f.s.renders.at(-1)).listening, undefined);
  f.ctl.setListening(true); await flush();
  assert.equal(cardOf(f.s.renders.at(-1)).listening, true, 'mic badge while the commands microphone is open');
  await f.advance(WATCH_MS * 2);
  assert.equal(cardOf(f.s.renders.at(-1)).listening, true, 'later redraws keep it');
  f.ctl.setListening(false); await flush();
  assert.equal(cardOf(f.s.renders.at(-1)).listening, undefined, 'dropped when listening stops');
  f.ctl.setListening(true);

  // A request during the walkthrough becomes a new walkthrough: listening must not flap off and on.
  f.ctl.route('what does that do?');
  f.ctl.start(PLAN, { request: 'again' });
  await f.advance(0);
  assert.deepEqual(f.s.active, [true, true], 'no onActive(false) during the replacement');
  assert.equal(cardOf(f.s.renders.at(-1)).listening, true);
  f.ctl.stop();
  assert.deepEqual(f.s.active, [true, true, false]);
  assert.equal(f.ctl.voiceCommand('next'), false, 'no walkthrough, no command');
});

test('body reactions are requested only when the overlay is visible and never in fullscreen', async () => {
  const view = { visible: true, fullscreen: false };
  const body = [];
  const f = fixture({ extra: {
    body: action => { body.push(action); return Promise.reject(Error('Capri’s body is unavailable.')); },
    bodyAllowed: () => view.visible && !view.fullscreen,
  } });
  f.ctl.start(PLAN, {});
  await f.advance(0);
  assert.deepEqual(body, ['come'], 'she comes over when the walkthrough starts');
  await f.advance(WATCH_MS * 2);
  f.ctl.voiceCommand('repeat');
  assert.deepEqual(body, ['come'], 'redraws of the same step are not a step change');
  f.ctl.cardAction(1, 'next');
  await f.advance(5000);
  assert.deepEqual(body, ['come', 'come'], 'and again on the next step; a rejected body action is ignored');
  view.fullscreen = true;
  f.ctl.voiceCommand('back');
  await f.advance(5000);
  assert.deepEqual(body, ['come', 'come'], 'nothing in fullscreen');
  view.fullscreen = false; view.visible = false;
  f.ctl.voiceCommand('next');
  await f.advance(5000);
  assert.deepEqual(body, ['come', 'come'], 'nothing while her overlay is hidden');
  view.visible = true;
  f.ctl.cardAction(1, 'next');
  await f.advance(0);
  assert.equal(f.ctl.active, false);
  assert.equal(f.s.spoken.at(-1), guideLine('done', 'en'), 'the walkthrough ends normally');
  assert.deepEqual(body, ['come', 'come', 'mood'], 'a mood reaction at the end');

  // A throwing body function never breaks a walkthrough either.
  const g = fixture({ extra: { body: () => { throw Error('gone'); }, bodyAllowed: () => true } });
  assert.deepEqual(g.ctl.start(PLAN, {}), { started: true, steps: 2 });
  await g.advance(0);
  assert.equal(g.ctl.current.state, 'waiting');
  g.ctl.stop();
  assert.equal(g.ctl.active, false);
});

test('the guide layer stays up in fullscreen while a requested walkthrough runs and closes at the end', async () => {
  const body = [];
  const gate = new ExclusiveFullscreenGate({ fullscreen: () => true, exclusive: () => false, speak: () => assert.fail('no notice for borderless') });
  const f = fixture({ extra: { gate, body: action => { body.push(action); return Promise.resolve(); }, bodyAllowed: () => false } });
  const drawn = scene => [...scene.values()].some(v => (v.marks || []).length || (v.cards || []).length);
  assert.deepEqual(f.ctl.start(PLAN, {}), { started: true, steps: 2 });
  await f.advance(0);
  assert.ok(drawn(f.s.renders.at(-1)), 'the ring and card are drawn over the borderless game');
  await f.advance(WATCH_MS * 4);
  assert.ok(drawn(f.s.renders.at(-1)), 'and stay up while it runs');
  f.ctl.cardAction(1, 'next');
  await f.advance(5000);
  f.ctl.cardAction(1, 'next');
  await f.advance(0);
  assert.equal(f.ctl.active, false);
  assert.equal(drawn(f.s.renders.at(-1)), false, 'the layer is cleared at the end');
  assert.deepEqual(body, [], 'her body stays hidden in fullscreen');
});

test('exclusive fullscreen refuses with one spoken suggestion per session', async () => {
  const state = { fullscreen: true, exclusive: true, probes: 0 };
  const spoken = [];
  const gate = new ExclusiveFullscreenGate({ fullscreen: () => state.fullscreen,
    exclusive: () => { state.probes += 1; return state.exclusive; }, speak: text => spoken.push(text), lang: () => 'es' });
  const f = fixture({ lang: 'es', extra: { gate } });
  assert.throws(() => f.ctl.start(PLAN, {}), /exclusive fullscreen/i);
  assert.equal(f.ctl.active, false);
  assert.equal(f.s.renders.length, 0, 'nothing is drawn');
  assert.deepEqual(spoken, [guideLine('exclusive-fullscreen', 'es')]);
  assert.throws(() => f.ctl.start(PLAN, {}), /do not suggest borderless again/i);
  assert.deepEqual(spoken, [guideLine('exclusive-fullscreen', 'es')], 'said once per game session');

  // The plain guide (capri_draw) is refused the same way, without speaking again.
  const session = new GuideSession({ targets: {}, layer: { render: async () => assert.fail('no drawing') }, layout: () => new Map(),
    foreground: () => ({ id: 1, pid: 9, ...box(0, 0, 800, 600) }), gate });
  await assert.rejects(session.draw({ clear: false, marks: [], cards: [] }), /exclusive fullscreen/i);
  assert.equal(spoken.length, 1);

  // Fullscreen ended: a new game session may hear it once more.
  state.fullscreen = false; gate.onFullscreen(false);
  const probes = state.probes;
  assert.deepEqual(f.ctl.start(PLAN, {}), { started: true, steps: 2 }, 'outside fullscreen nothing is probed or refused');
  assert.equal(state.probes, probes);
  f.ctl.stop();
  state.fullscreen = true; gate.onFullscreen(true);
  assert.throws(() => f.ctl.start(PLAN, {}), /exclusive fullscreen/i);
  assert.equal(spoken.length, 2);

  // Borderless (or a probe that fails) starts normally.
  state.exclusive = false;
  assert.deepEqual(f.ctl.start(PLAN, {}), { started: true, steps: 2 });
  f.ctl.stop();
  const broken = new ExclusiveFullscreenGate({ fullscreen: () => true, exclusive: () => { throw Error('no shell32'); }, speak: () => assert.fail() });
  assert.doesNotThrow(() => broken.check());
  assert.equal(QUNS_RUNNING_D3D_FULL_SCREEN, 3);
  for (const lang of ['en', 'es', 'fr', 'pt', 'ru']) {
    assert.match(guideLine('exclusive-fullscreen', lang), /borderless|sin bordes|sans bordure|sem bordas|без рамки/i, lang);
    assert.doesNotMatch(guideLine('exclusive-fullscreen', lang), /Capri/);
  }
});

test('"done" during a walkthrough means Next unless a reminder card takes it (voice and typed)', async () => {
  let reminderOpen = false;
  const f = fixture({ extra: { reminderWindow: () => reminderOpen } });
  f.ctl.start(PLAN, {});
  await f.advance(0);
  assert.equal(walkthroughCommand('listo'), null, 'not a walkthrough command by itself');
  assert.equal(walkthroughCommand('I did it', { doneIsNext: true }), 'next');
  // Voice: a reminder card in its window takes "done"; otherwise it is Next.
  let asked = 0;
  assert.equal(f.ctl.voiceCommand('done', () => { asked++; return true; }), true);
  assert.equal(f.ctl.current.index, 0, 'the reminder took it');
  assert.equal(f.ctl.voiceCommand('done', () => { asked++; return false; }), true);
  await f.advance(5000);
  assert.equal(f.ctl.current.index, 1, '"done" moved to the next step');
  assert.equal(asked, 2);
  assert.equal(f.ctl.voiceCommand('snooze', () => false), false, 'snooze never steers a walkthrough');
  // Typed.
  reminderOpen = true;
  assert.equal(f.ctl.route('done'), null, 'with a reminder card waiting, typed "done" is not a walkthrough command');
  f.ctl.answered();
  reminderOpen = false;
  const typed = f.ctl.route('listo');
  assert.equal(typed.handled, true);
  await f.advance(5000);
  assert.equal(f.ctl.active, false, 'the last step was done');
  // No walkthrough: "done" still goes to the reminder only.
  assert.equal(f.ctl.voiceCommand('done', () => false), false);
});

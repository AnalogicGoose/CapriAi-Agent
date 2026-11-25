'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '../src/renderer/js', name), 'utf8');
const uri = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('settings queue retains rapid saves, preserves order and recovers after a failed preference', async () => {
  const { SettingsQueue } = await import(uri(source('settings-queue.js')));
  const first = deferred(), started = [], saved = [], errors = [], busy = [];
  const queue = new SettingsQueue({ onResult: value => saved.push(value), onError: error => errors.push(error.message), onBusy: value => busy.push(value) });
  const jobs = [queue.run(async () => { started.push(1); return first.promise; }),
    queue.run(async () => { started.push(2); throw Error('Could not save'); }),
    queue.run(async () => { started.push(3); return 'last preference'; })];
  await tick(); assert.deepEqual(started, [1]); assert.equal(queue.pending, 3);
  first.resolve('first preference'); await Promise.all(jobs);
  assert.deepEqual(started, [1, 2, 3]); assert.deepEqual(saved, ['first preference', 'last preference']);
  assert.deepEqual(errors, ['Could not save']); assert.equal(queue.pending, 0); assert.equal(busy.at(-1), false);
});

const SECTIONS = ['sound', 'memory', 'reminders', 'behavior', 'codex', 'app'];
const DEEPERS = { sound: ['voice-files'], behavior: ['initiative'], codex: ['codex-advanced'], app: ['app-more'] };

// Loads settings.js against a fake page; returns the handlers, the remote state and what was saved.
async function controlRoom(config = {}) {
  const handlers = {}, saves = [], changes = [], actions = []; let renders = 0;
  const node = () => ({ textContent: '', dataset: {}, addEventListener() {}, setAttribute() {},
    classList: { toggle() {}, add() {}, remove() {} } });
  const notice = node(), statusbar = node(), status = node(), close = node();
  const remote = { value: { config: { volume: .7, scale: .6, visible: true, langSetting: 'auto', gamingMode: false, privacy: { retentionDays: 90, memoryEnabled: true },
    ttsEngine: 'qwen', ttsDevice: 'cpu', ttsPython: '', ttsModel: '', ttsReference: '', ttsReferenceText: '', codexExecutable: '', codexModel: '', codexEffort: 'medium',
    wakeWordEnabled: true, ...config }, runtime: { version: '0.4.0', currentSource: true, build: 'test', root: 'C:\\Capri' },
    displays: [{ id: 1, width: 1920, height: 1080 }], integration: { lastSeen: null }, reminders: [{ id: 3, text: 'Stretch', next: '2026-11-25 18:30', repeat: 'daily', movable: true }],
    initiative: { phase: 'live' }, project: null, startup: false } };
  const content = { dataset: {}, scrollTop: 0, offsetWidth: 380, classList: node().classList,
    contains: el => Boolean(el?.inside),
    set innerHTML(value) { this.markup = value; renders++; }, get innerHTML() { return this.markup; },
    querySelector() { return null; },
    querySelectorAll() { return [{ inside: true, type: 'text', dataset: { key: 'ttsPython' }, value: '',
      focus() { document.activeElement = this; }, setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; } }]; } };
  global.document = { activeElement: null, documentElement: { dataset: {} }, body: { setAttribute() {}, removeAttribute() {} },
    querySelector: selector => ({ '#content': content, '#notice': notice, '.statusbar': statusbar, '#status': status, '#close': close })[selector],
    querySelectorAll: () => [], addEventListener: (event, handler) => { handlers[event] = handler; } };
  global.window = { settingsHost: { state: async () => remote.value, onUpdate() {}, action: async (name, value) => { actions.push([name, value]); return { state: remote.value }; },
    patch: patch => { const job = deferred(); changes.push(patch); saves.push(job); return job.promise.then(() => {
      remote.value = { ...remote.value, config: { ...remote.value.config, ...patch } }; return remote.value;
    }); } } };
  const schema = uri(source('settings-schema.js'));
  await import(uri(source('settings.js').replace("'./settings-queue.js'", `'${uri(source('settings-queue.js'))}'`).replace("'./settings-schema.js'", `'${schema}'`) + `\n//${Math.random()}`));
  await tick();
  const click = attrs => handlers.click({ target: { closest: selector => { const name = selector.match(/^\[data-([a-z-]+)/)?.[1];
    return name && attrs[name] !== undefined ? { dataset: { [name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]: attrs[name] } } : null; } } });
  return { handlers, saves, changes, actions, content, status, notice, click, remote, get renders() { return renders; } };
}

test('quick controls and every section render', async () => {
  const room = await controlRoom();
  const html = () => room.content.innerHTML;
  assert.match(html(), /data-action-switch="gaming"/);
  for (const size of ['S', 'M', 'L']) assert.match(html(), new RegExp(`data-segment="scale"[^>]*>${size}<`));
  assert.match(html(), /data-action="visibility"[^>]*>Put away</);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/renderer/settings.html'), 'utf8'), /data-action="quit"/);
  for (const section of SECTIONS) {
    room.click({ section });
    assert.match(html(), new RegExp(`data-section="${section}" aria-expanded="true"`), section);
    assert.doesNotMatch(html(), /undefined|\[object|NaN/, section);
    for (const deeper of DEEPERS[section] || []) {
      room.click({ deeper });
      assert.match(html(), /data-back/, deeper);
      assert.doesNotMatch(html(), /undefined|\[object|NaN/, deeper);
      room.click({ back: '' });
      assert.doesNotMatch(html(), /data-back/);
    }
  }
  room.click({ section: 'reminders' });
  assert.match(html(), /Stretch/); assert.match(html(), /data-reminder-cancel="3"/);
  room.click({ section: 'reminders' });
  assert.doesNotMatch(html(), /aria-expanded="true"/, 'a second click folds the section');
  assert.equal(room.status.textContent, 'Here with you');
});

test('gaming pause keeps resume and quit', async () => {
  const room = await controlRoom({ gamingMode: true });
  assert.match(room.content.innerHTML, /data-action-switch="gaming"[^>]*checked/);
  assert.equal(room.status.textContent, 'Taking a break');
});

test('rapid controls persist and saving preserves an edited field and scroll', async () => {
  const room = await controlRoom();
  const { handlers, saves, changes, actions, content, notice } = room;
  room.click({ section: 'sound' });
  const before = room.renders;
  handlers.change({ target: { dataset: { key: 'volume' }, type: 'range', value: '20' } });
  handlers.change({ target: { dataset: { key: 'wakeWordEnabled' }, type: 'checkbox', checked: false } });
  await tick(); assert.equal(changes.length, 1);
  saves[0].resolve(); await tick(); assert.equal(changes.length, 2); assert.equal(room.renders, before, 'Do not flash intermediate settings while later changes are pending');
  saves[1].resolve(); await tick();
  assert.deepEqual(changes, [{ volume: .2 }, { wakeWordEnabled: false }]); assert.equal(room.remote.value.config.wakeWordEnabled, false);
  handlers.change({ target: { dataset: { key: 'privacy.retentionDays' }, type: 'select-one', value: '365' } });
  handlers.change({ target: { dataset: { key: 'displayId' }, type: 'select-one', value: '' } });
  await tick(); saves[2].resolve(); await tick(); saves[3].resolve(); await tick();
  assert.deepEqual(changes.slice(2), [{ privacy: { retentionDays: 365 } }, { displayId: null }]);
  document.activeElement = { inside: true, type: 'text', dataset: { key: 'ttsPython' }, value: 'C:\\Voice\\python.exe', selectionStart: 4, selectionEnd: 9 };
  content.scrollTop = 210;
  handlers.change({ target: { dataset: { key: 'volume' }, type: 'range', value: '40' } });
  await tick(); saves[4].resolve(); await tick();
  assert.equal(document.activeElement.value, 'C:\\Voice\\python.exe'); assert.equal(document.activeElement.selectionStart, 4);
  assert.equal(document.activeElement.selectionEnd, 9); assert.equal(content.scrollTop, 210);
  assert.equal(notice.textContent, 'Saved.');
  handlers.change({ target: { dataset: { key: 'volume' }, type: 'range', value: '60' } });
  const startup = { dataset: { actionSwitch: 'startup' }, type: 'checkbox', checked: true };
  handlers.change({ target: startup }); startup.checked = false; handlers.change({ target: startup });
  await tick(); assert.equal(actions.length, 0);
  saves[5].resolve(); await tick();
  assert.deepEqual(actions, [['startup', true], ['startup', false]], 'Queued switches capture each value when clicked');
});

test('size and mute save from their controls', async () => {
  const room = await controlRoom();
  room.click({ segment: 'scale' });
  assert.equal(room.changes.length, 0, 'a segment click needs its value');
  room.handlers.click({ target: { closest: selector => selector === '[data-segment]' ? { dataset: { segment: 'scale', value: '0.8' } } : null } });
  room.handlers.click({ target: { closest: selector => selector === '[data-toggle]' ? { dataset: { toggle: 'muted' } } : null } });
  await tick(); room.saves[0].resolve(); await tick(); room.saves[1].resolve(); await tick();
  assert.deepEqual(room.changes, [{ scale: 0.8 }, { muted: true }]);
});

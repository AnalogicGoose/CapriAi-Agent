'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { settingsPatch } = require('../src/main/settings-policy');
const uri = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const load = () => import(uri(fs.readFileSync(path.join(__dirname, '../src/renderer/js/settings-schema.js'), 'utf8')));

const allRows = ({ QUICK, SECTIONS }) => [...QUICK, ...SECTIONS.flatMap(section => section.rows)];
const state = (config = {}, extra = {}) => ({
  config: { volume: .7, muted: false, ttsEnabled: true, scale: .6, visible: true, gamingMode: false, ttsEngine: 'qwen',
    langSetting: 'auto', ...config, privacy: { memoryEnabled: true, retentionDays: 90, ...config.privacy } },
  reminders: [], runtime: { version: '0.4.0', currentSource: true, build: 'test', root: 'C:\\Capri' },
  integration: { lastSeen: null }, displays: [], project: null, initiative: { phase: 'live' }, startup: false, ...extra,
});
const sample = row => !row || row.control === 'switch' ? true : row.parse ? row.parse('') : row.options ? row.options[0][0]
  : row.key === 'volume' ? .5 : '';

test('every key is accepted by the settings policy', async () => {
  const { KEYS_USED, QUICK, SECTIONS } = await load();
  assert.ok(KEYS_USED.length > 30);
  const rows = allRows({ QUICK, SECTIONS });
  for (const key of KEYS_USED) {
    if (key.startsWith('privacy.')) {
      const name = key.slice(8), row = rows.find(r => r.key === key) || rows.flatMap(r => r.toggles || []).find(t => t.key === key);
      const value = row?.options ? row.options[0][0] : true;
      assert.doesNotThrow(() => settingsPatch({ privacy: { [name]: value } }), key);
    } else {
      const row = rows.find(r => r.key === key);
      assert.doesNotThrow(() => settingsPatch({ [key]: sample(row) }), key);
    }
  }
});

test('every action is allowed', async () => {
  const { ACTIONS_USED } = await load();
  const source = fs.readFileSync(path.join(__dirname, '../src/main/settings-window.js'), 'utf8');
  const allowed = JSON.parse(source.match(/if \(!(\[[^\]]+\])\.includes\(name\)\)/)[1].replace(/'/g, '"'));
  for (const action of ACTIONS_USED) assert.ok(allowed.includes(action), action);
  for (const action of ['gaming', 'visibility', 'quit']) assert.ok(ACTIONS_USED.includes(action), action);
});

test('dead settings are not rendered', async () => {
  const { KEYS_USED } = await load();
  for (const key of ['possess', 'surpriseAnimations', 'cursorInteractions']) assert.ok(!KEYS_USED.includes(key), key);
  for (const key of ['windowTracking', 'dailyRoutine']) assert.ok(KEYS_USED.includes(key), key);
  assert.equal(KEYS_USED.filter(key => key === 'proactiveEnabled').length, 1);
});

test('quick controls are gaming, size and desktop', async () => {
  const { QUICK } = await load();
  assert.deepEqual(QUICK.map(row => row.id), ['gaming', 'size', 'desktop']);
  const size = QUICK[1];
  assert.equal(size.key, 'scale'); assert.deepEqual(size.options.map(([v]) => v), [0.45, 0.6, 0.8]);
  assert.deepEqual(size.options.map(([, label]) => label), ['S', 'M', 'L']);
  const desktop = QUICK[2].buttons[0];
  assert.equal(QUICK[2].label, 'Desktop'); assert.equal(desktop.action, 'visibility');
  assert.equal(desktop.label(state()), 'Put away'); assert.equal(desktop.label(state({ visible: false })), 'Bring back');
  assert.equal(desktop.value(state({ visible: false })), true);
  assert.equal(QUICK[0].get(state({ gamingMode: true })), true);
});

test('sections are in order', async () => {
  const { SECTIONS } = await load();
  assert.deepEqual(SECTIONS.map(s => s.id), ['sound', 'memory', 'reminders', 'behavior', 'codex', 'app']);
});

test('memory sub-rows hide when memory is off', async () => {
  const { SECTIONS } = await load();
  const rows = SECTIONS.find(s => s.id === 'memory').rows;
  for (const key of ['privacy.memoryLearn', 'privacy.memoryConfirmChanges', 'privacy.memoryCandidates', 'privacy.memoryRecall', 'privacy.retentionDays']) {
    const row = rows.find(r => r.key === key);
    assert.ok(row, key);
    assert.equal(row.visible(state({ privacy: { memoryEnabled: false } })), false, key);
    assert.equal(row.visible(state({ privacy: { memoryEnabled: true } })), true, key);
  }
});

test('voice engine rows follow the engine', async () => {
  const { SECTIONS } = await load();
  const rows = SECTIONS.find(s => s.id === 'sound').rows;
  const model = rows.find(r => r.key === 'ttsModel'), device = rows.find(r => r.key === 'ttsDevice');
  assert.equal(model.deeper, 'voice-files'); assert.equal(device.deeper, 'voice-files');
  assert.equal(model.visible(state({ ttsEngine: 'qwen' })), true); assert.equal(device.visible(state({ ttsEngine: 'qwen' })), false);
  assert.equal(model.visible(state({ ttsEngine: 'f5' })), false); assert.equal(device.visible(state({ ttsEngine: 'f5' })), true);
});

test('summaries', async () => {
  const { SECTIONS } = await load();
  const summary = (id, s) => SECTIONS.find(x => x.id === id).summary(s);
  assert.equal(summary('sound', state({ volume: .7, ttsEnabled: true })), '70% · voice on');
  assert.equal(summary('sound', state({ volume: .7, ttsEnabled: false })), '70% · voice off');
  assert.equal(summary('sound', state({ muted: true })), 'Muted');
  assert.equal(summary('memory', state()), 'On'); assert.equal(summary('memory', state({ privacy: { memoryEnabled: false } })), 'Off');
  assert.equal(summary('reminders', state({}, { reminders: [{}, {}] })), '2 upcoming');
  assert.equal(summary('reminders', state()), 'None');
  assert.equal(summary('codex', state()), 'Waiting'); assert.equal(summary('codex', state({}, { integration: { lastSeen: 1 } })), 'Connected');
  assert.equal(summary('app', state()), 'v0.4.0');
  assert.equal(summary('app', state({}, { runtime: { version: '0.4.0', currentSource: false } })), 'Restart ready');
});

test('she can see is one compact row of seven toggles', async () => {
  const { SECTIONS } = await load();
  const row = SECTIONS.find(s => s.id === 'behavior').rows.find(r => r.control === 'toggles');
  assert.deepEqual(row.toggles.map(t => t.label), ['App', 'Titles', 'Processes', 'Activity', 'Time', 'Power', 'Performance']);
  assert.deepEqual(row.toggles.map(t => t.key), ['privacy.contextForeground', 'privacy.contextTitles', 'privacy.contextProcesses',
    'privacy.contextEvents', 'privacy.contextTime', 'privacy.contextPower', 'privacy.contextPerformance']);
});

test('no explanation paragraphs', async () => {
  const { QUICK, SECTIONS } = await load();
  const texts = [...SECTIONS.map(s => s.label), ...allRows({ QUICK, SECTIONS }).flatMap(r => [typeof r.label === 'string' ? r.label : r.label(state()), r.tip || ''])];
  for (const row of allRows({ QUICK, SECTIONS })) if (row.tip) assert.ok(row.tip.length <= 90, `${row.id}: ${row.tip}`);
  for (const text of texts) assert.doesNotMatch(text, /choom|ghost|biochip|Capri/i, text);
});

test('every rendered row has a unique id', async () => {
  const { QUICK, SECTIONS } = await load();
  const ids = allRows({ QUICK, SECTIONS }).map(r => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

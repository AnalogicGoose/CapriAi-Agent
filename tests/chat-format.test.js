'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const uri = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const { withRichText } = require('./helpers/rich-text-source');
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

async function loadPanel({ reduced = true } = {}) {
  const rich = uri(read('src/renderer/js/rich-text.js'));
  const code = read('src/renderer/js/panel.js')
    .replace("import { clamp, ease, reducedMotion } from './util.js';", `const clamp=x=>x,ease=x=>x,reducedMotion={matches:${reduced}};`)
    .replace("'./rich-text.js'", `'${rich}'`);
  return (await import(uri(code))).Panel;
}

// A tiny DOM node that records every text it ever showed.
function fakeDocument() {
  const doc = {
    createElement(tag) {
      return { tag, children: [], attrs: {}, listeners: {}, ownerDocument: doc,
        appendChild(child) { this.children.push(child); return child; },
        setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, fn) { this.listeners[t] = fn; },
        set textContent(v) { this.children = v ? [doc.createTextNode(v)] : []; },
        get textContent() { return this.children.map(c => c.textContent).join(''); },
        replaceChildren(...n) { this.children = n; } };
    },
    createTextNode(value) { return { value, textContent: value }; },
  };
  return doc;
}
function recordingLine(doc) {
  const line = doc.createElement('p'), shown = [];
  const desc = Object.getOwnPropertyDescriptor(line, 'textContent');
  Object.defineProperty(line, 'textContent', { get: desc.get, set(v) { shown.push(v); desc.set.call(line, v); } });
  line.classList = { toggle() {}, add() {}, remove() {} };
  line.shown = shown;
  return line;
}
const find = (el, tag) => el.tag === tag ? el : (el.children || []).map(c => find(c, tag)).find(Boolean);

test('reply renders bold and link', async () => {
  const Panel = await loadPanel(), doc = fakeDocument(), panel = Object.create(Panel.prototype);
  panel.reply = doc.createElement('div');
  panel.richText(panel.reply, 'Try **cacio e pepe**: https://a.com/x');
  assert.equal(find(panel.reply, 'strong').textContent, 'cacio e pepe');
  assert.equal(find(panel.reply, 'a').attrs.href, 'https://a.com/x');
});

test('decode never shows raw markers', async () => {
  const Panel = await loadPanel({ reduced: false }), doc = fakeDocument(), panel = Object.create(Panel.prototype);
  panel.line = recordingLine(doc);
  const timers = []; const realSet = global.setInterval, realClear = global.clearInterval;
  global.setInterval = fn => { timers.push(fn); return timers.length; }; global.clearInterval = () => {};
  try {
    panel.decode('**Hi** there', 'chat');
    for (let i = 0; i < 20; i++) timers.forEach(fn => fn());
  } finally { global.setInterval = realSet; global.clearInterval = realClear; }
  for (const text of panel.line.shown) assert.doesNotMatch(text, /\*/, `shown mid-decode: ${text}`);
  assert.equal(find(panel.line, 'strong').textContent, 'Hi');
});

test('stream never shows raw markers and formats when done', async () => {
  const Panel = await loadPanel(), doc = fakeDocument(), panel = Object.create(Panel.prototype);
  panel.line = recordingLine(doc); panel.current = { chat: {} }; panel.place = () => {};
  panel.stream('Try **cac');
  panel.stream('Try **cacio** [here](https://a.c');
  for (const text of panel.line.shown) assert.doesNotMatch(text, /[*[\]]/, `streamed: ${text}`);
  panel.stream('Try **cacio** [here](https://a.com/)', { done: true });
  assert.equal(find(panel.line, 'strong').textContent, 'cacio');
  assert.equal(find(panel.line, 'a').attrs.href, 'https://a.com/');
});

test('failed link shows note', async () => {
  const Panel = await loadPanel(), panel = Object.create(Panel.prototype);
  panel.note = { hidden: true, replaceChildren(...nodes) { this.text = nodes.join(''); } };
  panel.place = () => {};
  panel.onOpenLink = async () => ({ ok: false, error: 'Couldn’t open that link.' });
  await panel.openLink('http://a.com');
  assert.equal(panel.note.text, 'Couldn’t open that link.'); assert.equal(panel.note.hidden, false);
  clearTimeout(panel.noteTimer);
});

test('no portrait', () => {
  assert.doesNotMatch(read('src/renderer/index.html'), /panel__face/);
  assert.doesNotMatch(read('src/renderer/js/panel.js'), /Portrait/);
});

test('speech gets the original text so main can drop code blocks', async () => {
  const source = withRichText(read('src/renderer/js/speech-output.js'));
  const { SpeechPlayer } = await import(uri(source));
  const old = { window: global.window, document: global.document, cancelAnimationFrame: global.cancelAnimationFrame };
  global.window = global.document = { addEventListener() {} }; global.cancelAnimationFrame = () => {};
  try {
    const sent = [];
    const player = new SpeechPlayer({ host: { ttsCancel() {}, ttsSpeak: async request => { sent.push(request.text); return { ok: false, error: 'cancelled' }; } }, voice: { ensure() {} } });
    player.configure({ ttsEnabled: true });
    const text = ['Run:', '```py', 'x = 1', '```', 'ok'].join(String.fromCharCode(10));
    await player.speak(text);
    assert.deepEqual(sent, [text]);
    const { spokenText } = require('../src/main/tts');
    assert.doesNotMatch(spokenText(sent[0]), /x = 1/);
  } finally { Object.assign(global, old); }
});

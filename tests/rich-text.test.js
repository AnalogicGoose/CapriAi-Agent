'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const uri = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const load = () => import(uri(fs.readFileSync(path.join(__dirname, '../src/renderer/js/rich-text.js'), 'utf8')));
const inlines = (parse, text) => { const blocks = parse(text); assert.equal(blocks.length, 1); assert.equal(blocks[0].type, 'p'); return blocks[0].inlines; };
const links = blocks => blocks.flatMap(b => b.type === 'p' ? b.inlines : b.items.flat()).filter(i => i.type === 'link');

// Minimal DOM: records every element created so tests can prove no HTML is parsed.
function fakeDocument() {
  const created = [];
  const doc = {
    created,
    createElement(tag) {
      const el = { tag, children: [], attrs: {}, listeners: {}, ownerDocument: doc,
        appendChild(child) { this.children.push(child); return child; },
        setAttribute(key, value) { this.attrs[key] = String(value); },
        addEventListener(type, fn) { this.listeners[type] = fn; },
        set textContent(value) { this.children = value ? [doc.createTextNode(value)] : []; },
        get textContent() { return this.children.map(c => c.textContent ?? c.value).join(''); },
        replaceChildren(...nodes) { this.children = nodes; } };
      created.push(tag); return el;
    },
    createTextNode(value) { return { value, textContent: value }; },
  };
  return doc;
}
const find = (el, tag) => el.tag === tag ? el : (el.children || []).map(c => find(c, tag)).find(Boolean);

test('bold italic code', async () => {
  const { parseRichText } = await load();
  assert.deepEqual(inlines(parseRichText, 'a **b** *c* _d_ `e`'), [
    { type: 'text', text: 'a ' }, { type: 'b', text: 'b' }, { type: 'text', text: ' ' }, { type: 'i', text: 'c' },
    { type: 'text', text: ' ' }, { type: 'i', text: 'd' }, { type: 'text', text: ' ' }, { type: 'code', text: 'e' }]);
});

test('unmatched markers stay literal', async () => {
  const { parseRichText } = await load();
  assert.deepEqual(inlines(parseRichText, '2 * 3 and **open'), [{ type: 'text', text: '2 * 3 and **open' }]);
  assert.deepEqual(inlines(parseRichText, 'snake_case_name'), [{ type: 'text', text: 'snake_case_name' }]);
});

test('markdown link', async () => {
  const { parseRichText } = await load();
  assert.deepEqual(inlines(parseRichText, '[Recipe](https://seriouseats.com/x)'),
    [{ type: 'link', text: 'Recipe', href: 'https://seriouseats.com/x' }]);
});

test('bare url trims trailing punctuation', async () => {
  const { parseRichText } = await load();
  assert.deepEqual(inlines(parseRichText, '(see https://a.com/x).'), [
    { type: 'text', text: '(see ' }, { type: 'link', text: 'https://a.com/x', href: 'https://a.com/x' }, { type: 'text', text: ').' }]);
  const wiki = links(parseRichText('https://en.wikipedia.org/wiki/Foo_(bar).'));
  assert.equal(wiki[0].href, 'https://en.wikipedia.org/wiki/Foo_(bar)');
});

test('non-https links are text', async () => {
  const { parseRichText } = await load();
  for (const text of ['[x](javascript:alert(1))', 'http://a.com', '[f](file:///C:/x)'])
    assert.deepEqual(links(parseRichText(text)), [], text);
  assert.equal(parseRichText('[x](javascript:alert(1))')[0].inlines.map(i => i.text).join(''), 'x');
});

test('list', async () => {
  const { parseRichText } = await load();
  const blocks = parseRichText('Ideas:\n- one\n- **two**');
  assert.deepEqual(blocks, [
    { type: 'p', inlines: [{ type: 'text', text: 'Ideas:' }] },
    { type: 'ul', items: [[{ type: 'text', text: 'one' }], [{ type: 'b', text: 'two' }]] }]);
});

test('paragraphs and line breaks', async () => {
  const { parseRichText } = await load();
  assert.deepEqual(parseRichText('a\nb\n\nc'), [
    { type: 'p', inlines: [{ type: 'text', text: 'a' }, { type: 'text', text: '\n' }, { type: 'text', text: 'b' }] },
    { type: 'p', inlines: [{ type: 'text', text: 'c' }] }]);
});

test('html in text stays text', async () => {
  const { renderRichText } = await load();
  const doc = fakeDocument(), node = doc.createElement('div');
  doc.created.length = 0;
  renderRichText(node, '<img src=x onerror=alert(1)>');
  assert.deepEqual(doc.created, ['p']);
  assert.equal(node.textContent, '<img src=x onerror=alert(1)>');
});

test('link click opens through callback', async () => {
  const { renderRichText } = await load();
  const doc = fakeDocument(), node = doc.createElement('div'), opened = [];
  renderRichText(node, 'go https://a.com/', { onLink: href => opened.push(href) });
  const a = find(node, 'a');
  assert.equal(a.attrs.href, 'https://a.com/');
  let prevented = false;
  a.listeners.click({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.deepEqual(opened, ['https://a.com/']);
});

test('plain text strips markers', async () => {
  const { plainText } = await load();
  assert.equal(plainText('**Hi** [there](https://a.com) `x`'), 'Hi there x');
  assert.equal(plainText('Ideas:\n- one\n- *two*'), 'Ideas:\n- one\n- two');
});

test('very long input stays fast', async () => {
  const { parseRichText } = await load();
  const started = Date.now();
  parseRichText('*_`['.repeat(20000));
  assert.ok(Date.now() - started < 500);
});

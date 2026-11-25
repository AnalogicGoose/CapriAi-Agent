'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const css = () => read('src/renderer/styles/stella-theme.css');

const TOKENS = ['--st-bg-0', '--st-bg-1', '--st-panel-a', '--st-panel-b', '--st-text', '--st-muted', '--st-muted-2',
  '--st-lavender', '--st-violet', '--st-blue', '--st-link', '--st-gold', '--st-rose', '--st-warm', '--st-ok',
  '--st-hairline', '--st-font', '--st-mono'];

test('theme defines every token', () => {
  const root = css().match(/:root\s*\{([^}]*)\}/)?.[1] || '';
  for (const token of TOKENS) assert.match(root, new RegExp(`${token}\\s*:`), `${token} is declared in :root`);
  assert.match(root, /--st-link:\s*#7ea6ff/i);
  assert.match(root, /--st-gold:\s*#f6dc9c/i);
});

test('every renderer page loads the theme first', () => {
  for (const page of ['index.html', 'settings.html', 'guide.html', 'desktop-highlight.html']) {
    const first = read(`src/renderer/${page}`).match(/<link rel="stylesheet" href="([^"]+)"/)?.[1];
    assert.equal(first, 'styles/stella-theme.css', `${page} loads the Stella theme before its own styles`);
  }
});

test('icon buttons are fixed circles', () => {
  const source = css();
  const base = source.match(/\.orbit-icon\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(base, /place-items:\s*center/);
  assert.match(base, /border-radius:\s*50%/);
  for (const size of [30, 34, 46]) {
    const rule = source.match(new RegExp(`\\.orbit-icon--${size}\\s*\\{([^}]*)\\}`))?.[1] || '';
    assert.match(rule, new RegExp(`width:\\s*${size}px`));
    assert.match(rule, new RegExp(`height:\\s*${size}px`));
  }
});

// Rules whose selector names one of the restyled overlay pieces.
function overlayRules(source) {
  const pieces = ['.talk-menu', '.panel', '.ticker', '.wake-indicator', '.voice-indicator'];
  return [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => pieces.some(piece => selector.includes(piece)))
    .map(([, selector, body]) => ({ selector: selector.trim(), body }));
}

test('old look is gone from overlays', () => {
  const rules = overlayRules(read('src/renderer/styles/capri.css'));
  assert.ok(rules.length > 20, 'overlay rules found');
  for (const { selector, body } of rules) {
    assert.doesNotMatch(body, /polygon\(/, `${selector} has no cut corners`);
    assert.doesNotMatch(body, /Chakra Petch|--font-display/, `${selector} has no Chakra Petch`);
    assert.doesNotMatch(body, /#31ff72|var\(--green\)/i, `${selector} has no neon green`);
  }
  const html = read('src/renderer/index.html');
  assert.equal((html.match(/data-talk="(text|voice)"/g) || []).length, 2);
  for (const talk of ['text', 'voice']) assert.match(html, new RegExp(`class="[^"]*orbit-icon--46[^"]*" data-talk="${talk}"`));
});

test('guide and highlight use theme tokens', () => {
  for (const file of ['guide.css', 'desktop-highlight.css']) {
    const source = read(`src/renderer/styles/${file}`).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.match(source, /var\(--st-/, `${file} uses Stella tokens`);
    assert.doesNotMatch(source, /var\(--green\)|#64e9ae/i, `${file} has no neon green`);
    assert.doesNotMatch(source, /polygon\(/, `${file} has no cut corners`);
    assert.doesNotMatch(source, /--font-display|Chakra Petch/, `${file} has no Chakra Petch`);
    assert.doesNotMatch(source, /\d+px \d+px 0 var\(--violet\)/, `${file} has no hard offset shadows`);
  }
});

test('hovering an overlay button never moves it out from under the pointer', () => {
  // The overlay is click-through outside its buttons: a hover lift makes the hit test flip on and off.
  const rules = overlayRules(read('src/renderer/styles/capri.css'));
  for (const { selector, body } of rules.filter(r => /:hover/.test(r.selector)))
    assert.doesNotMatch(body, /transform/, `${selector} moves on hover`);
});

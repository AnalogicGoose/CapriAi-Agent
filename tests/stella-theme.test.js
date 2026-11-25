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

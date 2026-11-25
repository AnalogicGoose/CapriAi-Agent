'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { publicUrl } = require('../src/main/web-tools');
const { createLinkOpener } = require('../src/main/link-open');
const FAIL = { ok: false, error: 'Couldn’t open that link.' };

const spy = (impl = async () => {}) => { const calls = []; const fn = async (...args) => { calls.push(args); return impl(...args); }; fn.calls = calls; return fn; };

test('opens public https in preferred browser', async () => {
  const openUrl = spy(), open = createLinkOpener({ publicUrl, openUrl });
  assert.deepEqual(await open('https://seriouseats.com/x'), { ok: true });
  assert.deepEqual(openUrl.calls, [['https://seriouseats.com/x', 'default']]);
});

test('rejected urls return error', async () => {
  const openUrl = spy(), open = createLinkOpener({ publicUrl, openUrl });
  for (const url of ['http://a.com', 'https://127.0.0.1/', 'https://localhost/', 'javascript:alert(1)', 42, 'https://a.com/' + 'x'.repeat(3000)])
    assert.deepEqual(await open(url), FAIL, String(url).slice(0, 40));
  assert.equal(openUrl.calls.length, 0);
});

test('browser failure returns error', async () => {
  const open = createLinkOpener({ publicUrl, openUrl: spy(async () => { throw Error('Firefox is not installed'); }) });
  assert.deepEqual(await open('https://a.com/'), FAIL);
});

test('overlay blocks navigation', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  const start = main.indexOf('function createOverlay()'), body = main.slice(start, main.indexOf('\nfunction ', start + 10));
  assert.match(body, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(body, /'will-navigate'/);
  assert.match(main, /ipcMain\.handle\('link:open'/);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/preload.js'), 'utf8'), /openLink: url => ipcRenderer\.invoke\('link:open', url\)/);
});

test('a missing browser says which and how to fix it', async () => {
  const open = createLinkOpener({ publicUrl, openUrl: spy(async () => { throw Error('I couldn’t find a verified browser executable for “Firefox”. Give me another installed browser or choose the Windows default (system).'); }) });
  assert.deepEqual(await open('https://a.com/'), { ok: false, error: 'Firefox isn’t installed. Pick another browser in her control room (App).' });
});

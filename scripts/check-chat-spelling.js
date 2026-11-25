'use strict';
// Brief isolated fixture window; no live Stella profile or chat submission.
const { app, BrowserWindow, Menu } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { installChatSpelling } = require('../src/main/chat-spelling');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'stella-spelling-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 500, height: 160,
    webPreferences: { backgroundThrottling: false, spellcheck: true, sandbox: true } });
  try {
    win.webContents.session.setSpellCheckerLanguages(['en-US']);
    const html = fs.readFileSync(path.join(__dirname, '../src/renderer/index.html'), 'utf8');
    const input = html.match(/<textarea class="panel__input"[^>]*><\/textarea>/)[0];
    const fixture = path.join(app.getPath('userData'), 'spelling.html');
    fs.writeFileSync(fixture, '<!doctype html><meta charset="utf-8">' + input);
    await win.loadFile(fixture);
    win.show();
    win.focus();
    const appSource = fs.readFileSync(path.join(__dirname, '../src/renderer/js/app.js'), 'utf8');
    const handler = appSource.match(/window\.addEventListener\('contextmenu', \(e\) => \{[\s\S]*?\n  \}\);/)[0];
    await win.webContents.executeJavaScript(`
      const chip = { visible: false };
      ${handler}
      const input = document.querySelector('textarea');
      if (!input.spellcheck) throw new Error('Composer spellcheck disabled');
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      if (event.defaultPrevented) throw new Error('Chat context menu cancelled');
      const background = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.body.dispatchEvent(background);
      if (!background.defaultPrevented) throw new Error('Background menu not suppressed');
      input.focus();
    `);
    let template, menu;
    installChatSpelling(win, { buildFromTemplate(items) {
      template = items;
      menu = Menu.buildFromTemplate(items);
      return { popup({ window }) { assert.equal(window, win); } };
    } });
    await win.webContents.insertText('helo friend');
    // A native typing event starts Windows' asynchronous spellcheck.
    win.webContents.sendInputEvent({ type: 'char', keyCode: ' ' });
    let params;
    const deadline = Date.now() + 10000;
    do {
      await new Promise(resolve => setTimeout(resolve, 300));
      const context = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('No native context-menu event')), 3000);
        win.webContents.once('context-menu', (_event, value) => { clearTimeout(timer); resolve(value); });
      });
      win.webContents.sendInputEvent({ type: 'mouseDown', x: 20, y: 20, button: 'right', clickCount: 1 });
      win.webContents.sendInputEvent({ type: 'mouseUp', x: 20, y: 20, button: 'right', clickCount: 1 });
      params = await context;
    } while (!params.dictionarySuggestions.includes('hello') && Date.now() < deadline);
    assert.equal(params.misspelledWord, 'helo');
    assert.ok(params.dictionarySuggestions.includes('hello'), 'Native spelling suggestions must include hello');
    assert.ok(menu.items.some(item => item.label === 'hello'), 'Native suggestion must appear in menu');
    const draft = () => win.webContents.executeJavaScript('document.querySelector("textarea").value');
    async function waitForDraft(expected) {
      const deadline = Date.now() + 2000;
      let actual = await draft();
      while (actual !== expected && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 25));
        actual = await draft();
      }
      assert.equal(actual, expected);
    }
    template.find(item => item.label === 'hello').click();
    await waitForDraft('hello friend ');
    win.webContents.undo();
    await waitForDraft('helo friend ');
    // Regression: suggestions must survive a false enabled flag on Windows.
    win.webContents.emit('context-menu', {}, { ...params, spellcheckEnabled: false });
    assert.ok(template.some(item => item.label === 'hello'));
    win.webContents.emit('context-menu', {}, { ...params, dictionarySuggestions: [] });
    assert.equal(template[0].label, 'No spelling suggestions');
    assert.equal(template[0].enabled, false);
    const previous = template;
    win.webContents.emit('context-menu', {}, { ...params, isEditable: false });
    assert.equal(template, previous);
    win.webContents.emit('context-menu', {}, { ...params, misspelledWord: '', dictionarySuggestions: [] });
    assert.equal(template.some(item => item.label === 'Add to dictionary'), false);
    assert.ok(template.some(item => item.role === 'paste'));
    console.log('PASS: real native spelling suggestions, correction and undo; false enabled flag regression; renderer right-click handling; empty suggestions and editing menu. Only popup display intercepted.');
  } finally { win.destroy(); }
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });

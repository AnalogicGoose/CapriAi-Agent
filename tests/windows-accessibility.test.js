'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { WindowsAccessibility } = require('../src/main/windows-accessibility');
const { CodexTools } = require('../src/main/codex-tools');
const { desktopHighlight, markerLayout } = require('../src/main/desktop-highlight');

function fixture() {
  const cfg = { screenAwareness: true, systemAccess: true, desktopActions: true };
  const window = { id: 1, pid: 2, x: 50, y: 50, width: 500, height: 500 };
  const bounds = { x: 60, y: 70, width: 100, height: 20 };
  const control = { identity: '1,2,3', name: 'Scale', role: 'Edit', enabled: true, operations: ['set-value'], bounds };
  const ctx = { text: 'Set Scale to 200%', signal: new AbortController().signal, check() {} };
  const events = [];
  const bridge = new WindowsAccessibility({ settings: () => cfg, foreground: () => ({ ...window }),
    confirm: async () => true, highlight: async (rectangle, _window, _check, label) => events.push({ rectangle, label }),
    run: async call => {
      events.push(call.operation);
      return call.operation === 'inspect' ? { controls: [control] }
        : call.operation === 'locate' ? { control } : { dispatched: true, verified: call.value === '200%' };
    },
  });
  return { cfg, window, bounds, bridge, ctx, events };
}

test('pointing re-resolves a visible control and sends no input', async () => {
  const { bridge, ctx, bounds, events } = fixture();
  const { controls: [control] } = await bridge.inspect('Scale', ctx);
  assert.equal(control.identity, undefined);
  assert.equal(await bridge.use('locate', control.id, '', ctx).then(row => row.shown), true);
  assert.deepEqual(events, ['inspect', 'locate', { rectangle: bounds, label: 'Scale' }]);
});

test('Windows actions require current request evidence and a fresh match after confirmation', async () => {
  const { bridge, ctx, window, events } = fixture();
  const tools = new CodexTools({ accessibility: bridge });
  const { controls: [control] } = await tools.run('capri_window_controls', { query: 'Scale' }, ctx);
  const args = { id: control.id, operation: 'set-value', value: '200%' };
  await assert.rejects(tools.run('capri_control', args, ctx), /requested action/);
  await assert.rejects(tools.run('capri_control', { ...args, requestEvidence: ctx.text }, { ...ctx, signal: new AbortController().signal }), /Inspect/);
  bridge.confirm = async () => false;
  assert.equal((await tools.run('capri_control', { ...args, requestEvidence: ctx.text }, ctx)).dispatched, false);
  bridge.confirm = async () => { window.id++; return true; };
  await assert.rejects(tools.run('capri_control', { ...args, requestEvidence: ctx.text }, ctx), /Inspect/);
  assert.deepEqual(events, ['inspect']);
  bridge.confirm = async (_message, detail) => { assert.match(detail, /Scale.*200%/); return true; };
  const { controls: [fresh] } = await bridge.inspect('Scale', ctx);
  const allowed = { ...args, id: fresh.id, requestEvidence: ctx.text };
  assert.equal((await tools.run('capri_control', allowed, ctx)).verified, true);
  await assert.rejects(tools.run('capri_control', allowed, ctx), /Inspect/);
  assert.deepEqual(events, ['inspect', 'inspect', 'set-value']);
});

test('OCR is opt-in by query, maps exact matches to the screen, and rechecks their location', async () => {
  const { bridge, ctx, events } = fixture();
  bridge.run = async () => ({ controls: [] });
  bridge.captureWindow = async () => ({ image: 'fixture', x: 50, y: 50, scaleX: 2, scaleY: 3 });
  bridge.ocr = async () => ({ matches: [{ name: 'Scale', bounds: { x: 3, y: 4, width: 20, height: 10 } }] });
  assert.deepEqual((await bridge.inspect('', ctx)).controls, []);
  const { controls: [control] } = await bridge.inspect('Scale', ctx);
  assert.deepEqual(control.operations, []);
  await bridge.use('locate', control.id, '', ctx);
  assert.deepEqual(events, [{ rectangle: { x: 56, y: 62, width: 40, height: 30 }, label: 'Scale' }]);
  bridge.ocr = async () => ({ matches: [{ name: 'Scale', bounds: { x: 9, y: 4, width: 20, height: 10 } }] });
  await assert.rejects(bridge.use('locate', control.id, '', ctx), /moved/);
});

test('the overlay is nonfocusing and destroys its marker when the target window moves', async () => {
  const original = { id: 1, pid: 2, x: 0, y: 0, width: 300, height: 200 };
  let foreground = original;
  let marker;
  class Window {
    constructor(options) { marker = this; this.options = options; }
    setIgnoreMouseEvents(on) { this.clickThrough = on; }
    setContentProtection() {}
    setAlwaysOnTop() {}
    async loadFile(file, options) { this.file = file; this.layout = JSON.parse(options.query.layout); }
    showInactive() { this.visible = true; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  const highlight = desktopHighlight({ BrowserWindow: Window, foreground: () => foreground, enabled: () => true,
    screen: { screenToDipRect: (_window, rect) => rect, getDisplayMatching: () => ({ bounds: original }) } });
  try {
    await highlight.show({ x: 2, y: 2, width: 20, height: 30 }, original, () => {}, '  File\n name  ');
    assert.equal(marker.clickThrough, true);
    assert.equal(marker.options.focusable, false);
    assert.equal(marker.options.x, 0);
    assert.equal(marker.visible, true);
    assert.match(marker.file, /renderer[\\/]desktop-highlight\.html$/);
    assert.equal(marker.layout.caption.label, 'File name');
    assert.ok(marker.layout.caption.y > marker.layout.frame.y + marker.layout.frame.height);
    foreground = { ...original, x: 10 };
    await new Promise(resolve => setTimeout(resolve, 220));
    assert.equal(marker.destroyed, true);
  } finally { highlight.clear(); }
});

test('the marker and caption fit secondary-monitor edges and the caption stays outside the target', () => {
  const display = { x: -800, y: -100, width: 800, height: 600 };
  const { window, frame, caption } = markerLayout({ x: -30, y: 470, width: 42, height: 36 }, display, 'Save');
  assert.equal(window.x + window.width, 0);
  assert.equal(window.y + window.height, 500);
  assert.ok(caption.x >= 0 && caption.x + caption.width <= window.width);
  assert.ok(caption.y + 24 < frame.y);
  assert.equal(markerLayout(display, display, 'Full window').caption, null);
  assert.equal(markerLayout({ x: -700, y: 50, width: 40, height: 20 }, display, '').caption, null);
  assert.throws(() => markerLayout({ x: 1, y: 20, width: 40, height: 20 }, display, 'Outside'), /outside/);
});

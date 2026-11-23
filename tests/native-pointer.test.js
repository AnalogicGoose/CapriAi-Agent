'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const native = require('../src/main/native-windows');

test('pointerState decodes the button high bit and cursor point', () => {
  let key = 0x8000;
  native._setApiForTests({
    keyState: code => { assert.equal(code, 0x01); return key; },
    cursorPos: buffer => { buffer.writeInt32LE(-1200, 0); buffer.writeInt32LE(340, 4); return 1; },
  });
  try {
    assert.deepEqual(native.pointerState(), { down: true, x: -1200, y: 340 });
    key = 0x0001;
    assert.equal(native.pointerState().down, false);
    key = -32768; // int16 as koffi returns it
    assert.equal(native.pointerState().down, true);
  } finally { native._setApiForTests(undefined); }
});

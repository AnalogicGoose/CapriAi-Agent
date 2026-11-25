'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const native = require('../src/main/native-windows');

test('pointerState decodes the button high bit and cursor point', () => {
  let key = 0x8000;
  native._setApiForTests({
    metrics: index => { assert.equal(index, 23); return 0; },
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

test('pointerState reads the primary button when the mouse buttons are swapped', () => {
  let swapped = 1;
  const asked = [];
  native._setApiForTests({
    metrics: index => { assert.equal(index, 23); return swapped; }, // SM_SWAPBUTTON
    keyState: code => { asked.push(code); return code === 0x02 ? 0x8000 : 0; },
    cursorPos: buffer => { buffer.writeInt32LE(5, 0); buffer.writeInt32LE(6, 4); return 1; },
  });
  try {
    assert.deepEqual(native.pointerState(), { down: true, x: 5, y: 6 });
    swapped = 0;
    assert.equal(native.pointerState().down, false);
    assert.deepEqual(asked, [0x02, 0x01]);
  } finally { native._setApiForTests(undefined); }
});

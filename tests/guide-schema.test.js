'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MARK_KINDS, LIMITS, validateTarget, validateDraw, validateWalkthrough } = require('../src/main/guide-schema');
const { DISPLAY_NAME } = require('../src/main/identity');

const ctl = { type: 'control', id: 'c1' };
const rep = n => 'x'.repeat(n);

test('display name', () => assert.equal(DISPLAY_NAME, 'Stella'));

test('accepts every mark kind with control, text and snapshot targets', () => {
  const snap = { type: 'snapshot', snapshotId: 's1', x: 1, y: 2, width: 30, height: 40 };
  const marks = MARK_KINDS.map((kind, i) => ({ kind, target: [ctl, { type: 'text', text: 'Save', nth: 2 }, snap][i % 3], ...(kind === 'arrow' ? { to: ctl } : {}), ...(kind === 'label' ? { text: 'Here' } : {}) }));
  const out = validateDraw({ marks });
  assert.equal(out.clear, false);
  assert.deepEqual(out.cards, []);
  assert.deepEqual(out.marks.map(m => m.id), ['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
  assert.deepEqual(out.marks[0], { id: 'm1', kind: 'ring', target: ctl });
  assert.deepEqual(out.marks[1].to, ctl);
  assert.deepEqual(out.marks[1].target, { type: 'text', text: 'Save', nth: 2 });
  assert.deepEqual(out.marks[2], { id: 'm3', kind: 'label', target: snap, text: 'Here' });
  assert.deepEqual(out.marks[4].target, { type: 'text', text: 'Save', nth: 2 });
  assert.equal(validateDraw({ clear: true, marks: [{ id: 'a', kind: 'ring', target: ctl }] }).marks[0].id, 'a');
});

test('rejects unknown kinds, too many marks or cards, and long text', () => {
  const m = { kind: 'ring', target: ctl };
  assert.throws(() => validateDraw({ marks: [{ kind: 'blob', target: ctl }] }), /marks\[0\]\.kind/);
  assert.throws(() => validateDraw({ marks: Array(13).fill(m) }), /marks/);
  assert.throws(() => validateDraw({ cards: Array(3).fill({ kind: 'note', text: 'a' }) }), /cards/);
  assert.throws(() => validateDraw({ cards: [{ kind: 'box' }] }), /cards\[0\]\.kind/);
  assert.throws(() => validateDraw({ marks: [m, m, m, { ...m, kind: 'label', text: rep(61) }] }), /marks\[3\]\.text: at most 60/);
  assert.throws(() => validateDraw({ cards: [{ kind: 'note', text: rep(401) }] }), /cards\[0\]\.text/);
  assert.throws(() => validateDraw({ cards: [{ kind: 'steps', items: Array(9).fill('a') }] }), /cards\[0\]\.items/);
  assert.throws(() => validateDraw({ cards: [{ kind: 'table', columns: Array(6).fill('a'), rows: [] }] }), /cards\[0\]\.columns/);
  assert.throws(() => validateDraw({ cards: [{ kind: 'table', columns: ['a'], rows: Array(9).fill(['a']) }] }), /cards\[0\]\.rows/);
  assert.throws(() => validateDraw({ cards: [{ kind: 'table', columns: ['a'], rows: [[rep(41)]] }] }), /cards\[0\]\.rows\[0\]\[0\]/);
  const ok = validateDraw({ cards: [{ kind: 'table', title: 'T', columns: ['a', 'b'], rows: [['1', '2']] }, { kind: 'steps', items: ['one'] }] });
  assert.deepEqual(ok.cards[0], { kind: 'table', title: 'T', columns: ['a', 'b'], rows: [['1', '2']] });
  assert.equal(LIMITS.marks, 12);
});

test('arrow needs a destination target', () => {
  assert.throws(() => validateDraw({ marks: [{ kind: 'arrow', target: ctl }] }), /marks\[0\]\.to/);
});

test('walkthrough allows snapshot targets only in step 1', () => {
  const snap = { type: 'snapshot', snapshotId: 's', x: 0, y: 0, width: 5, height: 5 };
  const step = target => ({ target, say: 'Go', action: 'click' });
  const ok = validateWalkthrough({ title: 'T', steps: [step(snap), step({ type: 'name', name: 'Save', role: 'button' })] });
  assert.equal(ok.steps[0].target.type, 'snapshot');
  assert.deepEqual(ok.steps[1].target, { type: 'name', name: 'Save', role: 'button' });
  assert.throws(() => validateWalkthrough({ title: 'T', steps: [step(ctl), step(snap)] }), /steps\[1\]\.target/);
  assert.throws(() => validateTarget({ type: 'snapshot', snapshotId: 's', x: 0, y: 0, width: 1, height: 1 }, { allowSnapshot: false }), /snapshot/);
});

test('walkthrough limits', () => {
  const s = { target: ctl, say: 'Go', action: 'click' };
  assert.throws(() => validateWalkthrough({ title: 'T', steps: Array(13).fill(s) }), /steps/);
  assert.throws(() => validateWalkthrough({ title: 'T', steps: [{ ...s, say: rep(161) }] }), /steps\[0\]\.say/);
  assert.throws(() => validateWalkthrough({ title: 'T', steps: [{ ...s, action: 'drag' }] }), /steps\[0\]\.action/);
  assert.equal(validateWalkthrough({ title: 'T', steps: [{ ...s, expectApp: 'chrome' }] }).steps[0].expectApp, 'chrome');
});

test('strings are trimmed and control characters removed', () => {
  assert.equal(validateDraw({ marks: [{ kind: 'label', target: ctl, text: 'Save\u0007 ' }] }).marks[0].text, 'Save');
  assert.deepEqual(validateTarget({ type: 'text', text: ' Hi\u0000 ' }), { type: 'text', text: 'Hi' });
});

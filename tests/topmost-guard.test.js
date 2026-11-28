'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTopmostGuard } = require('../src/main/topmost-guard');

function setup(overrides = {}) {
  const calls = [];
  let clock = 0, topmost = true, onTop = true;
  const guard = createTopmostGuard({ shouldBeOnTop: () => onTop, isTopmost: () => topmost,
    restore: () => calls.push('restore'), raise: () => calls.push('raise'), ownPid: 1, now: () => clock, ...overrides });
  return { guard, calls, set: v => { if ('clock' in v) clock = v.clock; if ('topmost' in v) topmost = v.topmost; if ('onTop' in v) onTop = v.onTop; } };
}

test('restores her always-on-top flag when another app comes forward and it was lost', () => {
  const { guard, calls, set } = setup();
  set({ topmost: false });
  guard.check({ id: 10, pid: 2, topmost: false });
  assert.deepEqual(calls, ['restore']);
});

test('lifts her above a topmost foreground app, once on change and once after it settles', () => {
  const { guard, calls, set } = setup();
  guard.check({ id: 10, pid: 2, topmost: true });
  guard.check({ id: 10, pid: 2, topmost: true }); // same window, too soon
  set({ clock: 1500 });
  guard.check({ id: 10, pid: 2, topmost: true }); // settle recheck
  set({ clock: 5000 });
  guard.check({ id: 10, pid: 2, topmost: true }); // no endless fighting
  assert.deepEqual(calls, ['raise', 'raise']);
});

test('catches an app that turns topmost a moment after it appears', () => {
  const { guard, calls, set } = setup();
  guard.check({ id: 10, pid: 2, topmost: false });
  set({ clock: 1300 });
  guard.check({ id: 10, pid: 2, topmost: true });
  assert.deepEqual(calls, ['raise']);
});

test('does nothing for her own windows, nothing in front, or while she is hidden', () => {
  const { guard, calls, set } = setup();
  set({ topmost: false });
  guard.check(null);
  guard.check({ id: 5, pid: 1, topmost: false });
  set({ onTop: false });
  guard.check({ id: 10, pid: 2, topmost: true });
  assert.deepEqual(calls, []);
});

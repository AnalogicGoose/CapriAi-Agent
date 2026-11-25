'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { CodexTools } = require('../src/main/codex-tools');

const ctx = { text: 'hi', check: () => {}, signal: new AbortController().signal };
function tools(activity, execute) {
  const t = new CodexTools({ settings: () => ({}), activity });
  t.execute = execute;
  return t;
}

test('run reports start and end with only the operation name', async () => {
  const events = [];
  const t = tools(e => events.push(e), async () => ({ done: true }));
  assert.deepEqual(await t.run('capri_reminder', { operation: 'add', text: 'secret text', schedule: 'x' }, ctx), { done: true });
  assert.deepEqual(events, [{ tool: 'capri_reminder', op: 'add', phase: 'start' }, { tool: 'capri_reminder', op: 'add', phase: 'end', ok: true }]);
  events.length = 0;
  await t.run('capri_body', { action: 'wave' }, ctx);
  assert.equal(events[0].op, 'wave');
  events.length = 0;
  await t.run('capri_desktop_step', { tool: 'search_web', query: 'private' }, ctx);
  assert.equal(events[0].op, 'search_web');
  events.length = 0;
  await t.run('capri_context', {}, ctx);
  assert.equal(events[0].op, null);
  events.length = 0;
  await t.run('capri_body', { action: 5 }, ctx);
  assert.equal(events[0].op, null);
  events.length = 0;
  await t.run('capri_body', { action: 'x'.repeat(100) }, ctx);
  assert.equal(events[0].op.length, 40);
});

test('a throwing tool reports ok false and still throws; a throwing activity callback is ignored', async () => {
  const events = [];
  const bad = tools(e => events.push(e), async () => { throw Error('boom'); });
  await assert.rejects(bad.run('capri_context', {}, ctx), /boom/);
  assert.deepEqual(events.map(e => [e.phase, e.ok]), [['start', undefined], ['end', false]]);
  const noisy = tools(() => { throw Error('listener'); }, async () => 'fine');
  assert.equal(await noisy.run('capri_context', {}, ctx), 'fine');
  const plain = new CodexTools({ settings: () => ({}) });
  plain.execute = async () => 1;
  assert.equal(await plain.run('capri_context', {}, ctx), 1);
});

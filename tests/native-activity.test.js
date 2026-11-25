'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nativeActivity } = require('../src/main/native-activity');

test('built-in AI tools map to a short, private activity', () => {
  assert.deepEqual(nativeActivity({ type: 'webSearch', query: 'blox fruits news' }), { tool: 'native_web_search', op: 'search' });
  assert.deepEqual(nativeActivity({ type: 'fileChange' }), { tool: 'native_file_change', op: null });
  assert.deepEqual(nativeActivity({ type: 'imageView' }), { tool: 'native_image_view', op: null });
  assert.deepEqual(nativeActivity({ type: 'mcpToolCall' }), { tool: 'native_tool', op: null });
  assert.deepEqual(nativeActivity({ type: 'collabAgentToolCall' }), { tool: 'native_tool', op: null });
  assert.equal(nativeActivity({ type: 'agentMessage' }), null);
  assert.equal(nativeActivity(null), null);
});

test('commands that launch something are told apart from other commands', () => {
  const op = command => nativeActivity({ type: 'commandExecution', command }).op;
  for (const c of ['Start-Process spotify', 'start "" "C:\\Program Files\\Steam\\steam.exe"', 'cmd /c start firefox https://x.y',
    'powershell -NoProfile -Command "Start-Process notepad"', 'explorer.exe shell:AppsFolder\\Spotify', 'Invoke-Item C:\\a.pdf', ['cmd', '/c', 'start', 'msedge']])
    assert.equal(op(c), 'launch', JSON.stringify(c));
  for (const c of ['npm test', 'Get-ChildItem', 'git status', 'echo started', '', undefined]) assert.equal(op(c), 'run', JSON.stringify(c));
  // Nothing from the command itself leaves: only the tool name and op.
  const a = nativeActivity({ type: 'commandExecution', command: 'Start-Process secret-app --token abc' });
  assert.deepEqual(Object.keys(a).sort(), ['op', 'tool']);
});

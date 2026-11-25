'use strict';
// The AI's own built-in tools (web search, shell commands, file edits, image views) don't go through
// Capri's tool list, so Stella would never see them. This turns one of those items into the same short
// activity Capri's tools report: a fixed tool name and op, never the query, command or any argument.

const LAUNCH = /(?:^|[\s"'(;&|])(?:start(?:-process)?|explorer(?:\.exe)?|invoke-item|ii)(?=[\s"']|$)/i;

const TYPES = {
  webSearch: () => ({ tool: 'native_web_search', op: 'search' }),
  commandExecution: item => {
    const command = Array.isArray(item.command) ? item.command.join(' ') : typeof item.command === 'string' ? item.command : '';
    return { tool: 'native_command', op: LAUNCH.test(command) ? 'launch' : 'run' };
  },
  fileChange: () => ({ tool: 'native_file_change', op: null }),
  imageView: () => ({ tool: 'native_image_view', op: null }),
  mcpToolCall: () => ({ tool: 'native_tool', op: null }),
  collabAgentToolCall: () => ({ tool: 'native_tool', op: null }),
};

function nativeActivity(item) {
  if (!item || typeof item !== 'object' || !Object.hasOwn(TYPES, item.type)) return null;
  return TYPES[item.type](item);
}

module.exports = { nativeActivity };

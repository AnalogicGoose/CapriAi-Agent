'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

function observe(action, fields, signal) {
  signal?.throwIfAborted();
  if (process.platform !== 'win32') return Promise.resolve(false);
  const script = fs.readFileSync(path.join(__dirname, 'windows-action-observer.ps1'), 'utf8');
  const command = Buffer.from(script, 'utf16le').toString('base64');
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const env = { ...process.env, STELLA_OBSERVE_ACTION: action, ...fields };
  return new Promise((resolve, reject) => {
    execFile(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', command],
      { env, windowsHide: true, timeout: action === 'workspace' ? 3800 : 6200, signal, maxBuffer: 8192 }, (error, output) => {
        if (signal?.aborted) reject(signal.reason);
        else resolve(!error && output.trim() === 'confirmed');
      });
  });
}

function observePlayback({ title, artist, browser, videoId }, signal) {
  if (!['Firefox', 'Google Chrome', 'Microsoft Edge', 'Brave'].includes(browser)) return Promise.resolve(false);
  return observe('music', {
    STELLA_OBSERVE_TITLE: title, STELLA_OBSERVE_ARTIST: artist, STELLA_OBSERVE_BROWSER: browser,
    STELLA_OBSERVE_VIDEO: videoId || '',
  }, signal);
}

const observeWorkspace = (folder, signal) => observe('workspace', { STELLA_OBSERVE_PATH: folder }, signal);

module.exports = { observePlayback, observeWorkspace };

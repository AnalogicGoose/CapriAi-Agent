'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { QwenVoice } = require('./qwen-voice');
const GRANT_MS = 60000;
const GRANT_PURPOSES = new Set(['guide', 'reminder']);

function spokenText(text) {
  return String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/\[\[[\s\S]*?\]\]/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 1500);
}

class SpeechOutput {
  // grantAllowed: what still applies to a granted line (session, overlay alive) once the visibility/fullscreen/Gaming
  // part of allowed() is lifted. ttsEnabled and muted are checked for every line, granted or not.
  constructor({ root, config, allowed, grantAllowed = () => false, notify = () => {}, launch = spawn, now = Date.now }) {
    Object.assign(this, { root, config, allowed, grantAllowed, notify, launch, now });
    this.epoch = 0;
    this.grants = new Map(); // token -> { until, line }
    this.qwen = new QwenVoice({ root, notify, launch });
  }
  cancel(notify = true) {
    this.epoch++;
    this.job?.kill();
    this.job = null;
    this.qwen.cancel();
    if (notify) this.notify({ type: 'stopped' });
  }
  // A one-time token main issues for one guide line or reminder it sends to the renderer: single use, 60 s, and only
  // for that exact line (compared in its spoken form).
  grant(purpose, text) {
    const line = typeof text === 'string' ? spokenText(text) : '';
    if (!GRANT_PURPOSES.has(purpose) || !line) throw Error('Invalid voice grant.');
    const now = this.now();
    for (const [token, entry] of this.grants) if (entry.until <= now) this.grants.delete(token);
    while (this.grants.size >= 16) this.grants.delete(this.grants.keys().next().value);
    const token = randomUUID();
    this.grants.set(token, { until: now + GRANT_MS, line });
    return token;
  }
  // Consumes the grant whether or not the line is then spoken (or matches).
  redeem(token, line) {
    if (typeof token !== 'string' || !this.grants.has(token)) return false;
    const entry = this.grants.get(token);
    this.grants.delete(token);
    return entry.until > this.now() && Boolean(line) && entry.line === line;
  }
  async speak(request) {
    this.cancel(false);
    const epoch = this.epoch, cfg = this.config();
    const text = typeof request?.text === 'string' ? spokenText(request.text) : '';
    const granted = this.redeem(request?.grant, text);
    const allowed = granted ? () => this.grantAllowed() : () => this.allowed();
    if (!cfg.ttsEnabled || cfg.muted || !allowed() || !text) return { ok: false, error: 'speech-output-paused' };
    if (cfg.ttsEngine === 'qwen') {
      if (typeof request.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(request.id)) return { ok: false, error: 'Invalid voice request.' };
      return this.qwen.speak(cfg, { id: request.id, text }, () => epoch === this.epoch && allowed() && this.config().ttsEnabled && !this.config().muted);
    }
    this.qwen.close();
    if (!['windows', 'chatterbox', 'f5'].includes(cfg.ttsEngine)) return { ok: false, error: 'Invalid voice engine.' };
    let dir, child;
    try {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stella-tts-'));
      const file = path.join(dir, 'request.json'), output = path.join(dir, 'speech.wav');
      await fs.writeFile(file, JSON.stringify({ ttsEngine: cfg.ttsEngine, ttsDevice: cfg.ttsDevice, ttsReference: cfg.ttsReference, ttsReferenceText: cfg.ttsReferenceText, text, output }), 'utf8');
      if (epoch !== this.epoch) return { ok: false, error: 'cancelled' };
      const windows = cfg.ttsEngine === 'windows';
      child = this.launch(windows ? 'powershell.exe' : cfg.ttsPython,
        windows ? ['-NoProfile', '-NonInteractive', '-File', path.join(this.root, 'scripts/tts-windows.ps1'), '-Request', file]
          : [path.join(this.root, 'scripts/tts-local.py'), file],
        { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      this.job = child;
      await new Promise((resolve, reject) => {
        let detail = '';
        child.stderr.on('data', data => { detail = (detail + data.toString()).slice(-1500); });
        const timer = setTimeout(() => { child.kill(); reject(Error('Voice generation timed out.')); }, 120000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error(detail || 'Voice generation stopped.')); });
      });
      if (epoch !== this.epoch || !allowed()) return { ok: false, error: 'cancelled' };
      if ((await fs.stat(output)).size > 16 * 1024 * 1024) throw Error('Voice output too large.');
      const audio = await fs.readFile(output);
      if (audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw Error('Invalid voice audio.');
      if (epoch !== this.epoch || !allowed()) return { ok: false, error: 'cancelled' };
      return { ok: true, audio: audio.toString('base64') };
    } catch (error) {
      return { ok: false, error: epoch !== this.epoch ? 'cancelled' : error.message };
    } finally {
      if (this.job === child) this.job = null;
      if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  close() { this.cancel(); this.qwen.close(); }
  warm() {
    const cfg = this.config();
    if (cfg.ttsEngine === 'qwen' && cfg.ttsEnabled && !cfg.muted) return this.qwen.ensure(cfg).catch(() => {});
  }
}
module.exports = { SpeechOutput, spokenText };

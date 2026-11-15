// Audio stays in the overlay; the local worker streams signed 16-bit PCM.
// Change the silence between phrases while playing each generated sample as-is.
const PHRASE_PAUSES = { neutral: 0.06, playful: 0.02, comforting: 0.19, pleased: 0.12, curious: 0.04 };

export class SpeechPlayer {
  constructor({ host, voice, onLevel = () => {}, onError = () => {}, onPlayback = () => {} }) {
    Object.assign(this, { host, voice, onLevel, onError, onPlayback });
    this.epoch = 0; this.serial = 0; this.sources = new Set(); this.chunkChain = Promise.resolve();
    host.onTtsState?.(event => {
      if (event.type === 'stopped') this.stop(false);
      else if (event.type === 'preview') {
        this.beginResponse(event.mood);
        this.updateResponse(event.text, true);
      }
      else if (event.type === 'chunk' && event.id === this.pending?.id) {
        const epoch = this.epoch;
        this.chunkChain = this.chunkChain.then(() => this.pcm(event, epoch)).catch(error => {
          if (epoch === this.epoch) { this.onError(error.message); this.stop(); }
        });
      }
    });
    window.addEventListener('beforeunload', () => this.stop());
    document.addEventListener('keydown', event => { if (event.key === 'Escape') this.stop(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stop(); });
  }
  get enabled() { return Boolean(this.config?.ttsEnabled && !this.config.muted); }
  get inputHeld() { return this.inputHold?.ctx.state === 'suspended'; }
  configure(cfg) { this.config = cfg; this.stop(); }
  stop(notify = true) {
    clearTimeout(this.proactiveTimer); this.proactive = null;
    this.epoch++; this.pending = null; this.response = null; this.responseMood = undefined; this.nextTime = 0; this.responseSuppressed = true;
    cancelAnimationFrame(this.raf);
    for (const source of this.sources) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); }
    this.sources.clear(); this.source = null; this.analyser?.disconnect(); this.analyser = null;
    this.releaseInputHold();
    this.onLevel(0);
    this.playing = false; this.onPlayback(false);
    if (notify) this.host.ttsCancel?.();
  }
  async context(epoch) {
    const ctx = this.voice.ensure();
    if (!this.inputHold) await ctx.resume();
    return epoch === this.epoch ? ctx : null;
  }
  async holdForInput() {
    const ctx = this.source?.context;
    if (!this.playing || !ctx || ctx.state !== 'running' || this.inputHold) return false;
    const hold = this.inputHold = { ctx };
    try {
      await ctx.suspend();
      return this.inputHold === hold;
    } catch {
      if (this.inputHold === hold) this.inputHold = null;
      return false;
    }
  }
  releaseInputHold() {
    const hold = this.inputHold;
    this.inputHold = null;
    if (hold) void hold.ctx.resume().catch(() => {});
  }
  schedule(ctx, buffer) {
    if (this.proactive && !this.playing) {
      if (!this.proactive.canStart()) { this.stop(); return; }
      clearTimeout(this.proactiveTimer);
    }
    if (!this.playing) { this.playing = true; this.onPlayback(true); }
    const utterance = this.pending;
    if (!this.analyser) {
      this.analyser = ctx.createAnalyser(); this.analyser.fftSize = 256;
      this.analyser.connect(this.voice.master);
      const samples = new Float32Array(256);
      const frame = () => {
        if (!this.analyser) return;
        this.analyser.getFloatTimeDomainData(samples);
        // The analyser precedes master gain; silent output must stay visually silent.
        const gain = this.enabled && !this.voice.muted && ctx.state === 'running'
          ? Math.max(0, this.voice.master.gain.value) : 0;
        this.onLevel(Math.sqrt(samples.reduce((n, x) => n + x*x, 0) / samples.length) * gain);
        this.raf = requestAnimationFrame(frame);
      };
      frame();
    }
    const source = this.source = ctx.createBufferSource();
    this.lastPlayedText = utterance?.text || '';
    source.buffer = buffer; source.connect(this.analyser); this.sources.add(source);
    const pause = utterance && !utterance.started && this.nextTime
      ? (Object.hasOwn(PHRASE_PAUSES, utterance.mood) ? PHRASE_PAUSES[utterance.mood] : PHRASE_PAUSES.neutral) : 0;
    const at = Math.max(this.nextTime + pause, ctx.currentTime + 0.06);
    if (utterance) utterance.started = true;
    this.nextTime = at + buffer.duration;
    source.onended = () => { this.sources.delete(source); source.disconnect(); this.finishIfIdle(); };
    source.start(at);
  }
  async pcm(event, epoch) {
    if (epoch !== this.epoch || event.sampleRate !== 24000) return;
    const bytes = Uint8Array.from(atob(event.audio), char => char.charCodeAt(0));
    if (!bytes.length || bytes.length % 2 || bytes.length > 192000) return;
    const ctx = await this.context(epoch); if (!ctx || epoch !== this.epoch) return;
    const buffer = ctx.createBuffer(1, bytes.length / 2, event.sampleRate);
    const output = buffer.getChannelData(0), view = new DataView(bytes.buffer);
    for (let i = 0; i < output.length; i++) output[i] = view.getInt16(i*2, true) / 32768;
    this.schedule(ctx, buffer);
  }
  finishIfIdle() {
    if (!this.sources.size && !this.pending && (!this.response || (this.response.done && !this.response.busy && !this.response.queue.length))) this.stop(false);
  }
  async speak(text, mood) { this.stop(); if (this.enabled) await this.play(text, mood); }
  speakProactive(text, deadline, available, mood) {
    if (!this.enabled || this.config.proactiveVoice !== true || this.pending || this.playing || this.response) return false;
    const canStart = () => this.enabled && this.config.proactiveVoice === true && Date.now() < deadline && available();
    const line = speechText(text);
    if (!Number.isSafeInteger(deadline) || !canStart() || !line) return false;
    this.stop();
    this.proactive = { canStart };
    this.proactiveTimer = setTimeout(() => {
      if (this.proactive && !this.playing) this.stop();
    }, deadline - Date.now());
    void this.play(line, mood);
    return true;
  }
  stopProactive() { if (this.proactive) this.stop(); }
  async play(text, mood) {
    const epoch = this.epoch, token = { id: `voice-${++this.serial}-${Date.now()}`, text, mood };
    this.pending = token;
    try {
      const result = await this.host.ttsSpeak({ text, id: token.id });
      if (this.pending !== token || epoch !== this.epoch) return;
      if (!result.ok) {
        if (result.error !== 'cancelled' && !this.proactive) this.onError(result.error);
        this.stop(); return;
      }
      if (result.streamed) await this.chunkChain;
      else {
        const ctx = await this.context(epoch); if (!ctx) return;
        const bytes = Uint8Array.from(atob(result.audio), char => char.charCodeAt(0));
        const buffer = await ctx.decodeAudioData(bytes.buffer);
        if (epoch !== this.epoch || this.pending !== token) return;
        this.schedule(ctx, buffer);
      }
      if (this.pending === token) { this.pending = null; this.finishIfIdle(); }
    } catch (error) {
      if (this.pending === token) { this.pending = null; if (!this.proactive) this.onError(error.message); this.finishIfIdle(); }
    }
  }
  beginResponse(mood) {
    this.stop();
    this.responseMood = mood;
    this.responseSuppressed = false;
    if (!this.enabled || this.config.ttsEngine !== 'qwen') return false;
    this.response = { consumed: '', queue: [], done: false, busy: false };
    return true;
  }
  setResponseMood(mood) {
    if (!this.responseSuppressed && !this.pending && !this.playing && !this.response?.consumed && Object.hasOwn(PHRASE_PAUSES, mood))
      this.responseMood = mood;
  }
  updateResponse(text, done = false) {
    const response = this.response;
    if (!response) { if (done && !this.responseSuppressed) this.speak(text, this.responseMood); return; }
    // Hold structured output until complete so code and control tags cannot leak.
    if (!done && /[`\[]/.test(text)) return;
    const plain = speechText(text);
    if (!plain.startsWith(response.consumed)) { this.stop(); return; }
    let remaining = plain.slice(response.consumed.length);
    while (remaining.trim()) {
      const match = /[.!?]["'”’]?(?=\s)/.exec(remaining);
      let end = match ? match.index + match[0].length : done ? remaining.length : 0;
      if (!done && end < 35) {
        const next = /[.!?]["'”’]?(?=\s)/g; next.lastIndex = Math.max(end, 1);
        const later = next.exec(remaining); end = later ? later.index + later[0].length : 0;
      }
      if (!end && remaining.length > 350) end = remaining.lastIndexOf(' ', 300);
      if (!end) break;
      if (end > 350) end = remaining.lastIndexOf(' ', 300) || end;
      const part = remaining.slice(0, end);
      response.consumed += part; response.queue.push(part.trim());
      remaining = remaining.slice(end);
    }
    response.done = done; this.drain(response);
  }
  async drain(response) {
    if (response.busy) return;
    response.busy = true;
    while (this.response === response && response.queue.length) await this.play(response.queue.shift(), this.responseMood);
    response.busy = false; this.finishIfIdle();
  }
}

export function speechText(text) {
  return String(text || '').replace(/```[\s\S]*?(?:```|$)/g, ' ').replace(/\[\[[\s\S]*?(?:\]\]|$)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 1500);
}

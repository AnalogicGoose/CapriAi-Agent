// Audio stays in the overlay; the local worker streams signed 16-bit PCM.
// Change the silence between phrases while playing each generated sample as-is.
const PHRASE_PAUSES = { neutral: 0.06, playful: 0.02, comforting: 0.19, pleased: 0.12, curious: 0.04 };
const SENTENCE_PUNCTUATION = /([.!?]+)["'\u2019\u201d)\]]*(?=\s|$)/g;
// Only letters/digits are speech; a lone "..." or emoji makes the local voice model babble noise.
const SPEAKABLE = /[\p{L}\p{N}]/u;
const ABBREVIATION = /(?:\b(?:mr|mrs|ms|dr|prof|sr|sra|jr|st|vs|etc|fig|no|e\.g|i\.e)\.|\b(?:[a-z]\.){2,})$/i;

function sentenceEnd(text) {
  for (const match of text.matchAll(SENTENCE_PUNCTUATION)) {
    const end = match.index + match[0].length;
    if (match[1] === '.') {
      const prefix = text.slice(0, match.index + 1);
      if (ABBREVIATION.test(prefix) || /\b[A-Z]\.$/.test(prefix) || (end === text.length && /\d\.$/.test(prefix))) continue;
    }
    if (text.slice(0, end).trim()) return end;
  }
  return 0;
}

export class SpeechPlayer {
  constructor({ host, voice, onLevel = () => {}, onError = () => {}, onPlayback = () => {} }) {
    Object.assign(this, { host, voice, onLevel, onError, onPlayback });
    this.epoch = 0; this.serial = 0; this.sources = new Map(); this.chunkChain = Promise.resolve();
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
  get lastPlayedText() {
    for (const [source, phrase] of this.sources) {
      if (source.context.currentTime >= phrase.start && source.context.currentTime < phrase.end) return phrase.text;
    }
    return this.lastEndedText || '';
  }
  configure(cfg) { this.config = cfg; this.stop(); }
  stop(notify = true) {
    clearTimeout(this.proactiveTimer); this.proactive = null;
    this.epoch++; this.pending = null; this.response = null; this.responseMood = undefined; this.nextTime = 0; this.responseSuppressed = true;
    cancelAnimationFrame(this.raf);
    for (const source of this.sources.keys()) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); }
    this.sources.clear(); this.source = null; this.analyser?.disconnect(); this.analyser = null;
    this.releaseInputHold();
    this.onLevel(0);
    this.playing = false; this.onPlayback(false);
    this.lastEndedText = '';
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
    source.buffer = buffer; source.connect(this.analyser);
    const pause = utterance && !utterance.started && this.nextTime
      ? (Object.hasOwn(PHRASE_PAUSES, utterance.mood) ? PHRASE_PAUSES[utterance.mood] : PHRASE_PAUSES.neutral) : 0;
    const at = Math.max(this.nextTime + pause, ctx.currentTime + 0.06);
    // A chunk that starts after a gap (first one, or late from a busy GPU) would pop: ramp it in over 4 ms.
    if (!this.nextTime || at > this.nextTime + 0.002) fadeIn(buffer);
    if (utterance) utterance.started = true;
    this.nextTime = at + buffer.duration;
    const text = utterance?.text || '';
    this.sources.set(source, { text, start: at, end: this.nextTime });
    source.onended = () => { this.lastEndedText = text; this.sources.delete(source); source.disconnect(); this.finishIfIdle(); };
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
    if (this.sources.size) return;
    if (!this.pending && (!this.response || (this.response.done && !this.response.busy && !this.response.queue.length))) this.stop(false);
    else if (this.playing) {
      this.source = null;
      this.playing = false;
      this.onPlayback(false);
    }
  }
  // grant: main's one-time token for a guide line or reminder (lets it speak while she is hidden; never when muted).
  async speak(text, mood, grant) { this.stop(); if (this.enabled && SPEAKABLE.test(speechText(text))) await this.play(text, mood, grant); }
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
  async play(text, mood, grant) {
    const epoch = this.epoch, token = { id: `voice-${++this.serial}-${Date.now()}`, text, mood };
    this.pending = token;
    try {
      const result = await this.host.ttsSpeak(typeof grant === 'string' ? { text, id: token.id, grant } : { text, id: token.id });
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
    if (!this.enabled || !['qwen', 'windows'].includes(this.config.ttsEngine)) return false;
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
      const end = sentenceEnd(remaining) || (done ? remaining.length : 0);
      if (!end) break;
      const part = remaining.slice(0, end);
      response.consumed += part;
      if (SPEAKABLE.test(part)) response.queue.push(part.trim());
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

function fadeIn(buffer) {
  const data = buffer.getChannelData(0), n = Math.min(data.length, Math.round(buffer.sampleRate * 0.004));
  for (let i = 0; i < n; i++) data[i] *= i / n;
}

export function speechText(text) {
  return String(text || '').replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '').replace(/```[\s\S]*?(?:```|$)/g, ' ').replace(/\[\[[\s\S]*?(?:\]\]|$)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 1500);
}

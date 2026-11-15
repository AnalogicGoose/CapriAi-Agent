import { MicrophoneCapture } from './microphone.js';
import { speechDetector } from './speech-detector.js';

const clean = text => String(text || '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
  .replace(/\[\[[\s\S]*?(\]\]|$)/g, '').trim();
const goodbye = /^(?:cancel|never ?mind|stop listening|end (?:the )?call|goodbye(?: capri)?|cancelar|cancela|deja de escuchar|termina (?:la )?llamada|adios)[.!?]*$/i;
const CHECK_IN_SETUP_MS = 6000;
const CHECK_IN_IDLE_MS = 12_000;
const ECHO_SETTLE_MS = 120;
const ECHO_PROBE_MS = 380;
const words = text => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function isEcho(reply, line) {
  const heard = words(reply), prompt = words(line);
  return Boolean(heard && (heard === prompt ||
    (heard.split(' ').length >= 2 && ` ${prompt} `.includes(` ${heard} `))));
}

// Voice turns share Capri's backend/history, but never create a chat surface.
export class VoiceCall {
  constructor({ host, speaker, indicator, history, onStart = async () => {}, onEnd = () => {}, onPromote = () => {},
    detectorFactory = speechDetector, captureFactory = () => new MicrophoneCapture(),
    idleMs = 60000, now = () => performance.now() }) {
    Object.assign(this, { host, speaker, indicator, history, onStart, onEnd, onPromote, detectorFactory, captureFactory, idleMs, now });
    this.revision = 0; this.lastTurn = 0;
    host.onSpeechState(event => this.receive(event));
    host.onChatDelta(({ id, text, delivery }) => {
      if (id !== this.turn || !this.id) return;
      if (delivery) this.speaker.setResponseMood?.(delivery);
      if (!text) return;
      this.answer += text; this.speaker.updateResponse(clean(this.answer));
    });
    indicator.addEventListener('click', () => this.end());
    document.addEventListener('keydown', event => { if (event.key === 'Escape') this.end(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.checkIn) this.end(); });
    window.addEventListener('beforeunload', () => this.end());
  }
  get active() { return Boolean(this.id); }
  state(value, message = '') {
    this.phase = value; this.indicator.hidden = !this.active;
    this.indicator.dataset.state = value;
    this.indicator.setAttribute('aria-label', message || ({ listening: 'Capri is listening. Click to end voice conversation.',
      thinking: 'Capri is thinking. You can interrupt.', speaking: 'Capri is speaking. You can interrupt.',
      starting: 'Preparing voice conversation.', error: 'Voice conversation unavailable.' }[value]));
    this.indicator.title = this.indicator.getAttribute('aria-label');
  }
  place(head, view) {
    this.indicator.style.left = `${Math.max(22, Math.min(view.w - 22, head.x))}px`;
    this.indicator.style.top = `${Math.max(42, Math.min(view.h - 22, (head.top ?? head.y - 40) - 10))}px`;
  }
  async prepare() {
    this.preparing ||= this.detectorFactory({ stream: () => this.capture?.stream,
      onFrame: probabilities => this.speechFrame(probabilities),
      onStart: () => this.speechStart(), onEnd: () => { this.userSpeaking = false; } })
      .then(detector => this.detector = detector).catch(error => { this.preparing = null; throw error; });
    return this.preparing;
  }
  async startCheckIn(options) {
    if (this.active || this.speaker.pending || this.speaker.playing || this.speaker.response ||
        !options.available() || options.deadline <= Date.now()) return false;
    const starting = this.start(null, options);
    const checkIn = this.checkIn;
    let timer;
    const ready = await Promise.race([starting, new Promise(resolve => {
      timer = setTimeout(() => resolve(false), Math.min(CHECK_IN_SETUP_MS, options.deadline - Date.now()));
    })]);
    clearTimeout(timer);
    if (!options.available() && this.checkIn === checkIn) this.end();
    if (checkIn.cancelled || !options.available() || (this.active && this.checkIn !== checkIn)) return false;
    if (!ready && this.checkIn === checkIn) this.end(true, { fallback: true });
    const playing = this.speaker.speakProactive(options.text, options.deadline, options.available, options.mood);
    if (ready && this.checkIn === checkIn) {
      if (!playing) this.end();
      else if (!checkIn.started) checkIn.startTimer = setTimeout(() => this.end(), options.deadline - Date.now());
    }
    return playing;
  }
  async start(wake = null, checkIn = null) {
    this.end(false);
    const revision = this.revision;
    this.checkIn = checkIn ? { options: checkIn, started: false, cancelled: false, answered: false } : null;
    this.id = wake?.id || crypto.randomUUID(); this.capture = wake?.capture || this.captureFactory();
    this.readySignal = wake ? Promise.resolve(true) : new Promise(resolve => { this.readyResolve = resolve; });
    this.fromWake = Boolean(wake); this.text = ''; this.acceptSpeech = !checkIn;
    this.initializing = true; this.early = [];
    this.state('starting');
    try {
      if (wake?.text?.length > 500) throw Error('The addressed request was too long; try a shorter request.');
      await this.onStart(checkIn); if (revision !== this.revision) return;
      if (wake) {
        const result = await this.host.speechConversation({ id: this.id });
        if (!result.ok) throw Error(result.error);
      } else {
        const result = await this.host.speechStart({ id: this.id, mode: 'conversation', checkIn: Boolean(checkIn) });
        if (!result.ok) throw Error(result.error);
      }
      if (revision !== this.revision) return;
      const detector = await this.prepare(); if (revision !== this.revision) return;
      if (!wake) {
        if (!await this.readySignal || revision !== this.revision) return;
        await (this.openingPromise ||= this.openCapture());
      } else { await this.pausing; if (revision !== this.revision) return; await detector.start(); }
      if (revision !== this.revision) return;
      const id = this.id;
      this.capture.stream?.getAudioTracks?.().forEach(track => track.addEventListener('ended', () => { if (this.id === id) this.end(); }));
      this.initializing = false;
      if (!checkIn) { this.state('listening'); this.keepAlive(); }
      if (wake?.text) this.final(wake.text, wake.complete !== false);
      for (const event of this.early) this.final(event.text, event.complete !== false);
      this.early = [];
      return true;
    } catch (error) {
      if (revision !== this.revision) return;
      this.state('error', error.message); this.end(true, { fallback: Boolean(checkIn) });
    }
  }
  async openCapture() {
    if (!this.id || this.opening || this.capture.stream) return;
    this.opening = true; const id = this.id, capture = this.capture;
    try {
      await capture.start(samples => {
        if (this.id === id && (!this.checkIn || this.checkIn.started)) this.host.speechAudio({ id, samples });
      }, () => { if (this.id === id) this.end(); });
      if (this.id !== id) return;
      const detector = await this.prepare(); if (this.id !== id) return;
      await this.pausing; if (this.id !== id) return;
      await detector.start(); if (this.id === id && !this.checkIn) this.state('listening');
    } catch { if (this.id === id) this.end(true, { fallback: Boolean(this.checkIn) }); }
    finally { if (this.id === id) this.opening = false; }
  }
  speechStart() {
    if (!this.id || (this.checkIn && !this.checkIn.started)) return;
    if (this.audioPlaying && this.speaker.holdForInput) {
      if (!this.echoRejected) this.probeSpeech(true);
      return;
    }
    if (this.echoTailAt !== undefined && this.now() - this.echoTailAt < ECHO_SETTLE_MS) {
      this.probeSpeech(false);
      return;
    }
    this.confirmSpeech(this.audioPlaying ? this.checkIn?.options.text : '', this.echoTailAt);
  }
  // A detector can hear Capri through the speakers. Pause the current audio
  // clock briefly, then require speech to continue after the echo has faded.
  probeSpeech(holdAudio) {
    if (this.echoProbe) return;
    const probe = this.echoProbe = {
      holdAudio, quietAt: holdAudio ? Infinity : this.echoTailAt, tailAt: holdAudio ? undefined : this.echoTailAt,
      frames: 0, text: this.speaker.lastPlayedText || this.checkIn?.options.text || '',
      timer: setTimeout(() => this.finishProbe(false), ECHO_PROBE_MS),
    };
    if (!holdAudio) return;
    void this.speaker.holdForInput().then(held => {
      if (this.echoProbe !== probe) return;
      if (held) probe.quietAt = this.now();
      else this.finishProbe(false);
    });
  }
  speechFrame({ isSpeech }) {
    const probe = this.echoProbe;
    if (!probe || this.now() - probe.quietAt < ECHO_SETTLE_MS) return;
    if (probe.holdAudio && this.speaker.inputHeld === false) { this.finishProbe(false); return; }
    probe.frames = isSpeech >= 0.75 ? probe.frames + 1 : 0;
    if (probe.frames >= 2) this.finishProbe(true);
  }
  clearProbe() {
    clearTimeout(this.echoProbe?.timer);
    this.echoProbe = null;
  }
  finishProbe(confirmed) {
    const probe = this.echoProbe;
    this.clearProbe();
    if (confirmed) this.confirmSpeech(probe?.text, probe?.tailAt);
    else {
      // One failed interruption is enough for this utterance. Keep playing it
      // from the same position and wait for the normal reply window.
      this.echoRejected = this.audioPlaying;
      this.speaker.releaseInputHold?.();
    }
  }
  confirmSpeech(echoText = '', tailAt) {
    this.replyEcho = echoText;
    this.userSpeaking = true; this.keepAlive();
    if (!this.acceptSpeech || this.turn || this.speaker.pending || this.speaker.source || this.speaker.response) {
      this.interrupt(); this.text = '';
      const preRollMs = tailAt === undefined ? 500 : Math.max(0, Math.floor(this.now() - tailAt - ECHO_SETTLE_MS));
      this.host.speechReset({ id: this.id, preRollMs });
    }
    this.clearProbe();
    this.echoTailAt = undefined;
    this.acceptSpeech = true; this.state('listening');
  }
  interrupt() {
    this.generation = (this.generation || 0) + 1;
    if (this.turn) this.host.chatStop(this.turn);
    this.turn = null; this.speaker.stop();
  }
  keepAlive() {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => {
      if (this.turn || this.userSpeaking || this.speaker.pending || this.speaker.source) this.keepAlive();
      else this.end();
    }, this.checkIn ? CHECK_IN_IDLE_MS : this.idleMs);
  }
  receive(event) {
    if (!this.id || event.id !== this.id) return;
    if (event.type === 'ready') {
      this.ready = true; this.readyResolve?.(true); this.readyResolve = null;
      if (this.detector) this.openingPromise ||= this.openCapture();
    }
    else if (event.type === 'check-in-promoted' && this.checkIn) {
      clearTimeout(this.checkIn.startTimer);
      this.checkIn = null; this.keepAlive(); this.onPromote();
    }
    else if (event.type === 'final') {
      if (this.initializing) this.early.push(event);
      else this.final(event.text, event.complete !== false);
    }
    else if (event.type === 'error' || event.type === 'stopped') {
      this.end(true, { fallback: event.type === 'error' && Boolean(this.checkIn && !this.checkIn.started) });
    }
  }
  final(text, complete) {
    if (!this.id || !this.acceptSpeech || typeof text !== 'string') return;
    if (this.overlong) { if (complete) this.overlong = false; return; }
    this.text = [this.text, text].filter(Boolean).join(' ');
    if (this.text.length > 1500) { this.text = ''; this.overlong = !complete; this.state('listening'); return; }
    if (!complete) return;
    const message = this.text.trim(); this.text = '';
    if (!message) return;
    const first = this.checkIn && !this.checkIn.answered ? this.checkIn : null;
    if (this.replyEcho && isEcho(message, this.replyEcho)) {
      this.acceptSpeech = false;
      this.host.speechReset({ id: this.id, listening: false });
      return;
    }
    if (goodbye.test(message)) { this.end(); return; }
    if (first) first.answered = true;
    this.reply(message, first?.options.replyTo);
  }
  async reply(text, replyTo) {
    this.interrupt(); this.clearProbe();
    const generation = this.generation, session = this.id;
    this.keepAlive(); this.state('thinking'); this.acceptSpeech = false;
    this.host.speechReset({ id: session, listening: false });
    // Let an interrupted backend finish cancelling before starting the next turn.
    await this.inFlight?.catch(() => {});
    if (this.id !== session || generation !== this.generation) return;
    const id = this.turn = this.lastTurn = Math.max(Date.now(), this.lastTurn + 1);
    this.answer = '';
    const run = async () => {
      const local = await this.host.personalRoute(text, id, this.history?.history || [], false, replyTo, session);
      if (this.id !== session || generation !== this.generation) return;
      if (local.endVoice) { this.turn = null; this.end(); return; }
      const wasAudible = this.speaker.enabled;
      this.speaker.beginResponse(local.mood);
      const result = local.handled ? { ok: true, text: local.text } : await this.host.chatSend({
        id, mode: 'voice', messages: [{ role: 'user', content: text }] });
      if (this.id !== session || generation !== this.generation) return;
      if (!result.ok) throw Error(result.error || 'Voice reply unavailable.');
      if (wasAudible === false && this.speaker.enabled) this.speaker.beginResponse(result.delivery || local.mood);
      else if (result.delivery) this.speaker.setResponseMood?.(result.delivery);
      this.turn = null; this.speaker.updateResponse(clean(result.text), true);
      this.history?.history.push({ role: 'user', content: text }, { role: 'assistant', content: clean(result.text) });
      this.history?.trimHistory(); this.state('speaking');
    };
    this.inFlight = run().catch(async () => {
      if (this.id === session && generation === this.generation) {
        this.turn = null; this.speaker.stop(); this.state('listening');
        await this.speaker.speak?.(this.history?.brain?.lang === 'es'
          ? 'No pude terminar esa respuesta. ¿Me lo dices otra vez?'
          : "I couldn't finish that reply. Could you try again?");
      }
    });
    await this.inFlight;
  }
  playback(active) {
    if (!this.id) return;
    if (this.checkIn && !this.checkIn.started) {
      if (!active) return;
      this.checkIn.started = true; clearTimeout(this.checkIn.startTimer);
    }
    if (active) {
      this.audioPlaying = true; this.echoRejected = false; this.acceptSpeech = false;
      this.host.speechReset({ id: this.id, listening: false });
      this.state('speaking');
    } else {
      if (this.audioPlaying) {
        this.audioPlaying = false; this.echoTailAt = this.now(); this.clearProbe();
        this.probeSpeech(false);
      }
      if (!this.turn) { this.state('listening'); this.keepAlive(); }
    }
  }
  end(notify = true, { fallback = false } = {}) {
    const checkIn = this.checkIn;
    if (checkIn) { clearTimeout(checkIn.startTimer); checkIn.cancelled = !fallback; }
    this.checkIn = null;
    this.clearProbe(); this.audioPlaying = false; this.echoTailAt = undefined; this.replyEcho = '';
    const id = this.id; this.id = null; this.revision++; this.ready = false; this.opening = false;
    this.readyResolve?.(false); this.readyResolve = null; this.openingPromise = null;
    clearTimeout(this.idle); this.interrupt(); this.capture?.cancel(); this.capture = null;
    this.pausing = this.detector?.pause().catch(() => {}); this.userSpeaking = false; this.text = '';
    this.overlong = false; this.state('idle');
    if (id) { this.host.speechCancel({ id }); if (notify) this.host.wakeEndSession(); this.onEnd(); }
  }
}

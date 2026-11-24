import { MicrophoneCapture } from './microphone.js';

// Commands-only listening: open only while main says so (a walkthrough is running or a reminder window is open).
// Main matches the fixed local commands and discards every other transcript; nothing heard comes back here.
// Mirrors WakeListener's microphone lifecycle, and shows her voice indicator the whole time it listens.
export class CommandListener {
  constructor({ host, indicator, blocked = () => false, ownsIndicator = () => true, place = () => {}, beforeStart = () => {},
    captureFactory = () => new MicrophoneCapture(), now = Date.now }) {
    Object.assign(this, { host, indicator, blocked, ownsIndicator, place, beforeStart, captureFactory, now });
    this.enabled = false; this.retryAt = 0; this.listening = false; this.shown = false;
    host.onSpeechState(event => this.receive(event));
    host.onSpeechCommands?.(message => this.configure(message?.on === true));
    // After a renderer reload main does not resend the window state, so ask once.
    host.speechCommandsState?.().then(state => { if (state?.on === true && !this.enabled) this.configure(true); }).catch(() => {});
    window.addEventListener('beforeunload', () => this.pause());
    this.timer = setInterval(() => this.tick(), 500);
  }
  // While the window is open, wake listening stays paused (one microphone owner at a time).
  get active() { return this.enabled; }
  configure(on) {
    this.enabled = on; this.retryAt = 0;
    if (!on) this.pause();
    this.tick();
  }
  render() {
    const show = Boolean(this.enabled && this.listening);
    if (show) {
      this.place();
      this.indicator.hidden = false; this.indicator.dataset.state = 'listening';
      this.indicator.setAttribute('aria-label', 'Capri is listening for guide commands.');
      this.indicator.title = this.indicator.getAttribute('aria-label');
      this.shown = true;
    } else if (this.shown) {
      this.shown = false;
      // A voice call that took over the microphone also owns the indicator; leave it alone then.
      if (this.ownsIndicator()) { this.indicator.hidden = true; this.indicator.dataset.state = ''; }
    }
  }
  tick() {
    if (!this.enabled || this.blocked()) { this.pause(); return; }
    if (!this.id && this.now() >= this.retryAt) this.start();
    else if (this.listening) this.place();
  }
  async start() {
    const id = this.id = crypto.randomUUID(); this.capture = this.captureFactory(); this.listening = false;
    try {
      this.beforeStart();
      const result = await this.host.speechStart({ id, mode: 'commands' });
      if (this.id !== id) { this.host.speechCancel({ id }); return; }
      if (!result.ok) throw Error(result.error);
    } catch (error) { if (this.id === id) this.fail(error?.message === 'speech-busy' ? 1500 : 10000); }
  }
  pause() {
    if (!this.id) { this.render(); return; }
    const id = this.id; this.id = null; this.listening = false; this.capture?.cancel(); this.capture = null;
    this.host.speechCancel({ id }); this.render();
  }
  fail(delay) { this.pause(); this.retryAt = this.now() + delay; }
  async receive(event) {
    if (!this.id || event.id !== this.id) return;
    if (event.type === 'ready') {
      const id = this.id;
      try {
        await this.capture.start(samples => this.host.speechAudio({ id, samples }), () => { if (this.id === id) this.fail(10000); });
        if (this.id === id) { this.listening = true; this.render(); }
      } catch { if (this.id === id) this.fail(10000); }
    } else if (event.type === 'error') this.fail(10000);
    else if (event.type === 'stopped') { this.pause(); this.retryAt = this.now() + 1500; }
  }
}

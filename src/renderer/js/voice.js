// Stella's sounds, synthesized with Web Audio so nothing has to ship with the repo.
// Any file dropped in the custom sounds folder (tray > Son) named after a cue
// (hello.mp3, done.wav, listen.ogg...) replaces the synth for that cue.
//
// The palette is starlight: glassy FM bells, tiny stardust pings and a little air, all
// in D lydian (a bright major with a dreamy raised fourth) and sent through a soft
// echo so every sound leaves a faint trail, like her LEDs. No saws, no squares, no crackle.

import { rand, pick } from './util.js';

// D lydian, D4..D7
const SCALE = [62, 64, 66, 68, 69, 71, 73, 74, 76, 78, 80, 81, 83, 85, 86, 88, 90, 92, 93, 95, 97, 98];
// the talking beads: a calm pentatonic slice of it, middle register
const BLIP_NOTES = [74, 76, 78, 81, 83, 86];
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export const CUES = ['hello', 'blip', 'tick', 'done', 'alert', 'error', 'teleport-out', 'teleport-in',
  'listen', 'grab', 'drop', 'chime', 'celebrate', 'flare', 'remember', 'recall', 'approval', 'wave', 'dance'];

// The same cue never stacks on itself faster than this.
const MIN_GAP = 140;

export class Voice {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.volume = 0.7;
    this.custom = new Map(); // cue -> AudioBuffer
    this.lastBlip = 0;
    this.lastCue = new Map();
  }

  ensure(make = () => new AudioContext()) {
    if (this.ctx) return this.ctx;
    const ctx = make();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    // soft clip so stacked cues never get harsh
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 1.4) / Math.tanh(1.4);
    }
    shaper.curve = curve;
    this.master.connect(shaper).connect(ctx.destination);
    // the trail: a darkened echo every bell sends a little into
    this.space = ctx.createGain();
    this.space.gain.value = 0.55;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.19;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.38;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3800;
    this.space.connect(delay).connect(tone).connect(feedback).connect(delay);
    tone.connect(this.master);
    this.noise = this.makeNoise();
    return ctx;
  }

  configure({ muted, volume }) {
    if (typeof muted === 'boolean') this.muted = muted;
    if (typeof volume === 'number') {
      this.volume = volume;
      if (this.master) this.master.gain.value = volume;
    }
  }

  async loadCustom(list) {
    const ctx = this.ensure();
    this.custom.clear();
    for (const { name, url } of list) {
      if (!CUES.includes(name)) continue;
      try {
        const data = await (await fetch(url)).arrayBuffer();
        this.custom.set(name, await ctx.decodeAudioData(data));
      } catch (err) {
        console.warn('[stella] could not load sound', name, err);
      }
    }
  }

  // opts.ambient: a sound that belongs to a motion; it gives way to her real voice.
  play(cue, opts = {}) {
    if (this.muted || !CUES.includes(cue)) return;
    if (opts.ambient && (this.spoken?.playing || this.spoken?.pending)) return;
    const now = performance.now();
    if (cue !== 'blip' && now - (this.lastCue.get(cue) ?? -Infinity) < MIN_GAP) return;
    this.lastCue.set(cue, now);
    const ctx = this.ensure();
    if (ctx.state === 'suspended') ctx.resume?.();
    const custom = this.custom.get(cue);
    if (custom) {
      const src = ctx.createBufferSource();
      src.buffer = custom;
      src.connect(this.master);
      src.start();
      return;
    }
    const k = opts.soft ? 0.6 : 1;
    const fn = {
      hello: () => this.hello(),
      blip: () => this.blip(opts.mood),
      tick: () => this.tick(),
      done: () => this.done(),
      alert: () => this.alert(),
      error: () => this.error(),
      'teleport-out': () => this.dissolve(k),
      'teleport-in': () => this.gather(k),
      listen: () => this.listen(),
      grab: () => this.grab(),
      drop: () => this.drop(),
      chime: () => this.chime(),
      celebrate: () => this.celebrate(),
      flare: () => this.flare(),
      remember: () => this.swirl(true),
      recall: () => this.swirl(false),
      approval: () => this.approval(),
      wave: () => this.wave(),
      dance: () => this.dance(),
    }[cue];
    try { fn?.(); } catch (err) { console.warn('[stella] sound failed', cue, err); }
  }

  // ---- building blocks -------------------------------------------------------------------

  makeNoise() {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  env(param, t, a, peak, d) {
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak, t + a);
    param.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  // where a sound goes: straight out, plus a share into the echo
  out(send) {
    const g = this.ctx.createGain();
    g.connect(this.master);
    if (send > 0) {
      const s = this.ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.space);
    }
    return g;
  }

  // a glass bell: a sine carrier lit by an inharmonic modulator whose brightness fades first,
  // plus a twin a few cents up for shimmer
  bell(freq, t, dur, peak, { send = 0.35, ratio = 3.5, bright = 1.2, detune = 5, attack = 0.004 } = {}) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    this.env(g.gain, t, attack, peak, dur);
    g.connect(this.out(send));
    for (const cents of detune ? [0, detune] : [0]) {
      const car = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const depth = ctx.createGain();
      car.type = 'sine';
      mod.type = 'sine';
      car.frequency.setValueAtTime(freq, t);
      car.detune.setValueAtTime(cents, t);
      mod.frequency.setValueAtTime(freq * ratio, t);
      depth.gain.setValueAtTime(freq * bright, t);
      depth.gain.exponentialRampToValueAtTime(Math.max(1, freq * 0.02), t + Math.min(dur, 0.25));
      mod.connect(depth).connect(car.frequency);
      const level = ctx.createGain();
      level.gain.value = detune ? 0.5 : 1;
      car.connect(level).connect(g);
      car.start(t); mod.start(t);
      car.stop(t + attack + dur + 0.05); mod.stop(t + attack + dur + 0.05);
    }
    return g;
  }

  // a plain soft tone (pads, glides); returns the oscillator so callers can bend it
  tone(freq, t, dur, peak, { type = 'sine', send = 0.25, attack = 0.01 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    this.env(g.gain, t, attack, peak, dur);
    o.connect(g).connect(this.out(send));
    o.start(t);
    o.stop(t + attack + dur + 0.05);
    return o;
  }

  // air: filtered noise that drifts from one colour to another
  air(t, dur, peak, from, to, { q = 0.8, attack = 0.05, send = 0.2 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + attack + dur);
    const g = ctx.createGain();
    this.env(g.gain, t, attack, peak, dur);
    src.connect(bp).connect(g).connect(this.out(send));
    src.start(t, rand(0, 0.4));
    src.stop(t + attack + dur + 0.05);
  }

  // stardust: a few tiny high pings scattered over a span
  dust(t, span, count, peak, lo = 86, hi = 98) {
    const notes = SCALE.filter((n) => n >= lo && n <= hi);
    for (let i = 0; i < count; i++) {
      this.bell(midi(pick(notes)), t + rand(0, span), rand(0.12, 0.3), peak * rand(0.5, 1), { send: 0.5, ratio: 5.1, bright: 0.6, detune: 0 });
    }
  }

  // ---- cues ------------------------------------------------------------------------------

  // talking: one small glass bead, darker when worried, brighter when excited
  blip(mood = 'talk') {
    const now = performance.now();
    if (now - this.lastBlip < 45) return;
    this.lastBlip = now;
    const t = this.ctx.currentTime;
    const n = pick(BLIP_NOTES) + (mood === 'alert' ? 4 : mood === 'error' ? -5 : 0);
    this.bell(midi(n), t, rand(0.05, 0.08), 0.045, { send: 0.12, ratio: 2, bright: 0.5, detune: 0 });
  }

  // working: a faint tap on glass
  tick() {
    const t = this.ctx.currentTime;
    this.bell(rand(2600, 3400), t, 0.03, 0.025, { send: 0.1, ratio: 1.5, bright: 0.3, detune: 0 });
  }

  // a greeting: three bells rising D-A-D, a sprinkle on top
  hello() {
    const t = this.ctx.currentTime;
    [74, 81, 86].forEach((n, i) => this.bell(midi(n), t + i * 0.09, 0.5 + i * 0.15, 0.08));
    this.dust(t + 0.24, 0.3, 4, 0.025);
  }

  // finished: a climbing lydian arpeggio that lands on a warm open fifth, and a shimmer
  done() {
    const t = this.ctx.currentTime;
    [74, 78, 81, 85].forEach((n, i) => this.bell(midi(n), t + i * 0.075, 0.45, 0.07));
    const end = t + 0.32;
    this.bell(midi(86), end, 1.1, 0.085);
    this.bell(midi(93), end + 0.01, 1.0, 0.05);
    this.tone(midi(62), end, 0.9, 0.04, { attack: 0.06, send: 0.3 });
    this.dust(end + 0.05, 0.6, 6, 0.02);
  }

  // look at me: two clear two-note calls, a fourth apart
  alert() {
    const t = this.ctx.currentTime;
    for (let r = 0; r < 2; r++) {
      this.bell(midi(86), t + r * 0.3, 0.25, 0.09, { bright: 1.6 });
      this.bell(midi(81), t + r * 0.3 + 0.12, 0.35, 0.08, { bright: 1.6 });
    }
  }

  // something went wrong: a dull, falling minor third over a low sigh, never a buzz
  error() {
    const t = this.ctx.currentTime;
    this.bell(midi(69), t, 0.4, 0.08, { ratio: 1.41, bright: 0.9, send: 0.25 });
    this.bell(midi(65), t + 0.16, 0.6, 0.08, { ratio: 1.41, bright: 0.9, send: 0.25 });
    const low = this.tone(150, t, 0.45, 0.09, { type: 'triangle', send: 0.05, attack: 0.02 });
    low.frequency.exponentialRampToValueAtTime(90, t + 0.4);
    this.air(t, 0.35, 0.03, 1400, 400);
  }

  // leaving (gaming, fullscreen): she comes apart into a falling scatter of light and breath
  dissolve(k = 1) {
    const t = this.ctx.currentTime;
    [93, 90, 86, 81, 78, 74].forEach((n, i) => this.bell(midi(n), t + i * 0.045, 0.3, 0.05 * k, { send: 0.5, detune: 0 }));
    this.air(t, 0.45, 0.05 * k, 900, 7000, { attack: 0.08 });
  }

  // coming back: the scatter gathers upward and settles on a soft low bloom
  gather(k = 1) {
    const t = this.ctx.currentTime;
    [74, 78, 81, 86, 90, 93].forEach((n, i) => this.bell(midi(n), t + i * 0.045, 0.3, 0.05 * k, { send: 0.5, detune: 0 }));
    this.air(t, 0.35, 0.045 * k, 7000, 900, { attack: 0.06 });
    this.tone(midi(50), t + 0.25, 0.5, 0.08 * k, { attack: 0.04, send: 0.2 });
  }

  // "Hey Stella" heard: a quick bright opening, up a fourth — the ear perking up
  listen() {
    const t = this.ctx.currentTime;
    this.bell(midi(81), t, 0.18, 0.07, { bright: 0.9 });
    this.bell(midi(86), t + 0.08, 0.35, 0.08, { bright: 0.9 });
  }

  // picked up: a small upward glide
  grab() {
    const t = this.ctx.currentTime;
    const o = this.tone(520, t, 0.12, 0.06, { attack: 0.005, send: 0.15 });
    o.frequency.exponentialRampToValueAtTime(880, t + 0.1);
  }

  // set down: a low soft bell and a puff of air
  drop() {
    const t = this.ctx.currentTime;
    this.bell(midi(62), t, 0.35, 0.08, { ratio: 2, bright: 0.7, send: 0.2 });
    this.air(t, 0.12, 0.03, 1500, 500, { attack: 0.01 });
  }

  // a reminder: three bright rings, like the three rings she draws
  chime() {
    const t = this.ctx.currentTime;
    [86, 90, 93].forEach((n, i) => this.bell(midi(n), t + i * 0.22, 0.9, 0.08, { bright: 1.4 }));
    this.tone(midi(74), t, 1.1, 0.03, { attack: 0.1, send: 0.3 });
  }

  // a little victory: a burst of stardust over a bright major bloom
  celebrate() {
    const t = this.ctx.currentTime;
    [74, 78, 81, 86].forEach((n) => this.bell(midi(n), t + rand(0, 0.02), 0.9, 0.05, { send: 0.45 }));
    this.dust(t + 0.04, 0.5, 10, 0.03);
    this.air(t, 0.3, 0.03, 3000, 9000, { attack: 0.02 });
  }

  // opening something for you: a short upward breath and a bright ping
  flare() {
    const t = this.ctx.currentTime;
    this.air(t, 0.16, 0.05, 800, 6000, { attack: 0.06, q: 1.2 });
    this.bell(midi(88), t + 0.16, 0.4, 0.07);
  }

  // remembering (inward) or looking back (outward): a short spiral of notes
  swirl(inward) {
    const t = this.ctx.currentTime;
    const notes = [74, 78, 81, 85, 88];
    (inward ? [...notes].reverse() : notes).forEach((n, i) => this.bell(midi(n), t + i * 0.06, 0.28, 0.045, { send: 0.45, detune: 0 }));
    const end = t + notes.length * 0.06;
    if (inward) this.tone(midi(62), end, 0.45, 0.06, { attack: 0.03 });
    else this.bell(midi(90), end, 0.6, 0.05);
  }

  // asking permission: two notes that rise and stay open, like a question
  approval() {
    const t = this.ctx.currentTime;
    this.bell(midi(78), t, 0.25, 0.07);
    this.bell(midi(83), t + 0.14, 0.6, 0.075);
  }

  // waving: two soft pings
  wave() {
    const t = this.ctx.currentTime;
    this.bell(midi(83), t, 0.22, 0.055, { detune: 0 });
    this.bell(midi(83), t + 0.2, 0.3, 0.05, { detune: 0 });
  }

  // spinning: a quick up-and-down twirl
  dance() {
    const t = this.ctx.currentTime;
    [74, 78, 81, 86, 81, 78, 74, 81].forEach((n, i) => this.bell(midi(n), t + i * 0.08, 0.2, 0.045, { send: 0.3, detune: 0 }));
  }
}

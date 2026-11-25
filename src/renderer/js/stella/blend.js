import {damp} from './math.js';
import {P} from './params.js';

const MODES = ['idle', 'listen', 'think', 'speak', 'rest'];

export class StateBlend {
  constructor() {
    this.mode = 'idle';
    this.listen = 0;
    this.think = 0;
    this.speak = 0;
    this.rest = 0;
    this.level = 0;
    this.raw = 0;
  }

  setMode(mode) {
    if (!MODES.includes(mode)) throw new Error(`Stella: unknown mode "${mode}"`);
    this.mode = mode;
  }

  setVoice(raw) {
    this.raw = raw == null ? 0 : Math.min(1, Math.max(0, raw));
  }

  step(dt) {
    for (const k of ['listen', 'think', 'speak', 'rest']) {
      this[k] = damp(this[k], this.mode === k ? 1 : 0, P.ease.state, dt);
    }
    const rate = this.raw > this.level ? P.ease.voiceAttack : P.ease.voiceRelease;
    this.level = damp(this.level, this.raw, rate, dt);
  }
}

import { clamp, smoothstep } from './math.js';

export const IDLE_VARIATIONS = ['speedShift', 'counterTurn', 'sway', 'breathPulse', 'shineWave', 'dotDrift', 'globeTilt'];

const GAP_MIN = 8000, GAP_MAX = 25000;
const DUR_MIN = 10000, DUR_MAX = 30000;
const FADE = 2000;

// Schedules occasional idle variations for Stella. Times are in milliseconds.
export class IdleScheduler {
  constructor({ random = Math.random, energy = () => 0.5 } = {}) {
    this.random = random;
    this.energy = energy;
    this.nextStart = null; // set on first update
    this.current = null;   // { name, start, duration, abortAt, abortFrom }
    this.last = null;
    this.blocked = false;
  }

  _gap() { return GAP_MIN + this.random() * (GAP_MAX - GAP_MIN); }

  _pick() {
    const pool = IDLE_VARIATIONS.filter(n => n !== this.last);
    return pool[Math.min(pool.length - 1, Math.floor(this.random() * pool.length))];
  }

  _envelope(now) {
    const c = this.current;
    const t = now - c.start;
    let env = Math.min(smoothstep(t / FADE), smoothstep((c.duration - t) / FADE));
    if (c.abortAt !== null) env = Math.min(env, c.abortFrom * (1 - smoothstep((now - c.abortAt) / FADE)));
    return clamp(env, 0, 1);
  }

  update(now, { allowed = true } = {}) {
    if (this.nextStart === null) this.nextStart = now + this._gap();

    if (!allowed) this.blocked = true;
    else if (this.blocked) {
      // Resuming after a block: plain idle for a fresh gap before any variation.
      this.blocked = false;
      this.nextStart = now + this._gap();
    }

    if (this.current && !allowed && this.current.abortAt === null) {
      this.current.abortFrom = this._envelope(now);
      this.current.abortAt = now;
    }

    if (this.current) {
      const c = this.current;
      const over = now - c.start >= c.duration || (c.abortAt !== null && now - c.abortAt >= FADE);
      if (over) {
        this.current = null;
        this.nextStart = now + this._gap();
      }
    }

    if (!this.current && allowed && now >= this.nextStart) {
      const name = this._pick();
      this.last = name;
      this.current = { name, start: now, duration: DUR_MIN + this.random() * (DUR_MAX - DUR_MIN), abortAt: null, abortFrom: 0 };
    }

    const energy = this.energy();
    if (!this.current) return { name: null, envelope: 0, energy };
    return { name: this.current.name, envelope: this._envelope(now), energy };
  }
}

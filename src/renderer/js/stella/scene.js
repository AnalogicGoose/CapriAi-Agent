// Stella's per-frame scene: turns time + state into plain data the painter and
// the WebGL passes draw. Pure: no DOM, no canvas.
import {TAU, clamp, lerp, smoothstep, easeInOut, damp, noise1} from './math.js';
import {P} from './params.js';
import {MOTIONS} from './motions.js';

const SPEED_EASE = 4;   // how fast angular speeds follow their targets (1/s)
const BURSTS = ['celebrate', 'spinBurst'];

// Small seeded PRNG so the dot swarm is the same every run.
function stellaRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const D = P.dots;
const rand = stellaRandom(0x57e11a);
const SWARM = Array.from({length: P.blades.count * D.perGap}, (_, i) => ({
  gap: i % P.blades.count,
  da: (rand() < 0.5 ? -1 : 1) * (D.spreadMin + rand() * (D.spreadMax - D.spreadMin)),
  r: D.rMin + rand() * (D.rMax - D.rMin),
  ph: rand() * TAU, sp: 0.6 + rand() * 0.9, sz: 0.7 + rand() * 0.7,
}));

const env = (o, k) => (o && o[k] > 0 ? Math.min(1, o[k]) : 0);
const idleEnv = (idle, name, reduced) => (!reduced && idle && idle.name === name ? clamp(idle.envelope || 0, 0, 1) : 0);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// Accumulated angles. Speeds ease toward their targets, so a sudden change in
// state never makes an angle jump.
export class SceneClock {
  constructor() {
    this.spin = 0; this.blades = 0; this.sticks = 0; this.chase = 0; this.ringTurn = 0;
    this.sway = 0; this.tilt = 0;
    this.orbit = 0; this.radar = 0; this.ripple = 0; this.rippleSpeed = 3;
    this.scan = 0; this.burst = 0;
    this._rates = null; this._idleName = null; this._shiftSign = -1;
    this._burstOn = false; this._burstFrom = 0; this._burstTo = 0; this._burstT = 1; this._burstDur = 1;
  }

  step(dt, blend, idle, motions = {}, {reduced = false} = {}) {
    const S = P.speeds, b = blend || {};
    const think = b.think || 0, speak = b.speak || 0, rest = b.rest || 0;
    const mul = lerp(1, 0.3, rest) * (reduced ? 0.1 : 1);
    const name = reduced || !idle ? null : idle.name;
    if (name === 'speedShift' && this._idleName !== 'speedShift') this._shiftSign = -this._shiftSign;
    this._idleName = name;
    const shift = idleEnv(idle, 'speedShift', reduced), counter = idleEnv(idle, 'counterTurn', reduced);
    const sway = idleEnv(idle, 'sway', reduced);
    const bladeRate = (S.blades + think * S.bladesThink + speak * S.bladesSpeak)
      * (1 + this._shiftSign * 0.8 * shift) * (1 - sway) * mul;
    const target = {
      spin: (S.spin + think * S.spinThink) * mul,
      blades: bladeRate,
      sticks: bladeRate * (1 - 2 * counter),
      chase: (S.chase + think * S.chaseThink) * mul,
      ringTurn: -0.5 * bladeRate,
      orbit: (0.6 * idleEnv(idle, 'dotDrift', reduced) + 1.5 * (env(motions, 'swirlIn') + env(motions, 'swirlOut'))) * mul,
    };
    if (!this._rates) this._rates = {...target};
    for (const k of Object.keys(target)) {
      this._rates[k] = damp(this._rates[k], target[k], SPEED_EASE, dt);
      this[k] += this._rates[k] * dt;
    }
    this.sway += 0.6 * dt;
    this.tilt = damp(this.tilt, idleEnv(idle, 'globeTilt', reduced), SPEED_EASE, dt);
    this.radar += 2 * dt * (reduced ? 0.1 : 1);
    this.rippleSpeed = damp(this.rippleSpeed, speak > 0.5 ? 9 : 3, SPEED_EASE, dt);
    this.ripple += this.rippleSpeed * dt;
    this.scan = env(motions, 'scan') > 0 ? this.scan + dt / (MOTIONS.scan.duration / 1000) : 0;

    // Celebrate / spin burst: one extra full turn, eased over the motion.
    const burstName = BURSTS.find(n => env(motions, n) > 0);
    if (burstName && !this._burstOn && this._burstT >= 1) {
      this._burstFrom = this.burst;
      this._burstTo = this.burst + TAU * (reduced ? 0.1 : 1);
      this._burstT = 0; this._burstDur = MOTIONS[burstName].duration / 1000;
    }
    this._burstOn = !!burstName;
    if (this._burstT < 1) {
      this._burstT = Math.min(1, this._burstT + dt / this._burstDur);
      this.burst = lerp(this._burstFrom, this._burstTo, easeInOut(this._burstT));
    }
  }
}

// Brightness of the radar sweep on a stick at `angle`.
const radarLight = (angle, sweep) => smoothstep(1 - Math.abs(wrap(angle - sweep)) / (Math.PI / 4));

export function buildScene({s, t, clock, blend, idle, motions = {}, aim = null, reduced = false, fold = 0}) {
  const b = blend || {}, mo = motions || {};
  const listen = b.listen || 0, think = b.think || 0, rest = b.rest || 0;
  const E = (b.speak || 0) * (b.level || 0);
  const sc = s / 360, f = clamp(fold || 0, 0, 1);
  const ie = name => idleEnv(idle, name, reduced);

  // Overall scale: idle breath pulse and the pulse-like motions.
  const scale = 1 + 0.06 * ie('breathPulse') + 0.08 * env(mo, 'pulse') + 0.08 * env(mo, 'doublePulse')
    + 0.05 * env(mo, 'breath') + 0.1 * env(mo, 'wake');
  const R = P.R * s * scale;
  const breath = 1 + 0.02 * Math.sin(t * 1.3);
  const brightness = lerp(1, 0.45, rest);
  const body = 1 - smoothstep((f - 0.4) / 0.5);   // everything but the center point fades while folding
  const glitch = env(mo, 'glitch');
  const jx = reduced ? 0 : 2 * glitch * noise1(t * 41), jy = reduced ? 0 : 2 * glitch * noise1(t * 37 + 5);
  const cx = s / 2 + jx, cy = s / 2 + jy;

  const swayOff = 0.5 * Math.sin(clock.sway) * ie('sway');
  const base = clock.blades + swayOff + clock.burst;
  const music = 1 + 0.08 * Math.sin(t * 8) * env(mo, 'musicPulse');
  const fl = env(mo, 'flare'), fo = env(mo, 'fold');

  // Blades.
  const B = P.blades, reach = (1 + E * 0.12 - listen * 0.07) * (1 + 0.18 * fl) * (1 - 0.35 * fo) * music;
  const blades = Array.from({length: B.count}, (_, k) => ({
    angle: base + B.offset + k * TAU / B.count,
    rIn: R * (B.rIn - listen * 0.04), rOut: R * B.rOut * reach,
    wIn: (B.wIn + E * 10) * sc, wOut: B.wOut * sc, seed: k, alpha: brightness * body,
  }));
  const ae = env(mo, 'aim');
  if (aim != null && ae > 0) {
    let best = 0;
    for (let k = 1; k < blades.length; k++) {
      if (Math.abs(wrap(aim - blades[k].angle)) < Math.abs(wrap(aim - blades[best].angle))) best = k;
    }
    const bl = blades[best];
    bl.angle += wrap(aim - bl.angle) * ae;
    bl.rOut *= 1 + 0.15 * ae;
  }

  // Sticks, trailing a little behind; the radar lights one as it sweeps.
  const K = P.sticks, rd = env(mo, 'radar');
  const sticks = Array.from({length: K.count}, (_, k) => {
    const angle = clock.sticks + swayOff + clock.burst + K.offset - K.lag * (1 + think) + k * TAU / K.count;
    const h = rd * radarLight(angle, clock.radar);
    return {
      angle, rIn: R * (K.rIn - listen * 0.04),
      rOut: R * (K.rOut + E * 0.08 - listen * 0.05) * (1 + 0.18 * fl) * (1 - 0.35 * fo) * music,
      wIn: (K.wIn + E * 6) * sc * (1 + 0.6 * h), wOut: K.wOut * sc, seed: k + B.count,
      alpha: Math.min(1, brightness * body * (1 + 0.6 * h)),
    };
  });
  for (const x of [...blades, ...sticks]) x.rOut = lerp(x.rOut, x.rIn, f);

  // Ring.
  const ringR = R * P.ring * breath * (1 - f);
  const chime = env(mo, 'chime') * (0.5 - 0.5 * Math.cos(t * TAU * 3 / (MOTIONS.chime.duration / 1000)));
  let ringAlpha = Math.min(1, 0.8 + listen * 0.2 + 0.2 * fl + 0.3 * chime);
  ringAlpha = lerp(ringAlpha, 1, env(mo, 'approval'));
  const ring = {
    r: ringR, turn: clock.ringTurn, alpha: ringAlpha * brightness * body,
    chase: {angle: clock.chase, strength: think},
  };

  // Dot swarms in the gaps between the blades.
  const swirl = 1 - 0.5 * env(mo, 'swirlIn') + 0.5 * env(mo, 'swirlOut');
  const dots = SWARM.map(d => {
    const a = base + clock.orbit + d.gap * TAU / B.count + d.da * (1 - listen * 0.35) + 0.07 * Math.sin(t * d.sp + d.ph);
    const r0 = R * (d.r + 0.05 * Math.sin(t * d.sp * 1.3 + d.ph)
      + E * 0.12 * (0.5 + 0.5 * Math.sin(d.ph + t * 6)) - listen * 0.08) * swirl;
    const r = lerp(r0, ringR, f);
    const tw = 0.55 + 0.45 * Math.sin(t * 2 + d.ph * 3);
    return {
      x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, r: d.sz * 2.1 * sc,
      alpha: clamp(0.35 + 0.55 * tw, 0, 1) * brightness * body,
      color: P.colors.dots[d.gap % 2 ? 0 : 1],
    };
  });

  // Globe and its heart.
  const gr = R * P.ring * breath * P.globe * (1 - f);
  const globe = {
    r: gr * breath, yaw: clock.spin, pitch: lerp(P.globePitch, 0.25, clock.tilt),
    wavy: 0.08 + E * 0.9 + listen * 0.25, rippleSpeed: clock.rippleSpeed, ripple: clock.ripple,
    heart: {r: gr * (0.42 + E * 0.25 + listen * 0.08 + 0.03 * Math.sin(t * 1.3)), alpha: brightness * body},
    scan: env(mo, 'scan') > 0 ? clock.scan % 1 : null,
  };

  const ticks = env(mo, 'ticks'), wave = ie('shineWave');
  const sheen = {
    enabled: body > 0,
    flicker: !reduced,
    stepped: ticks > 0,
    speed: P.sheen.speed * (1 + wave),
    seedStep: lerp(P.sheen.seedStep, 1.4 / (B.count + K.count), wave),
    flickerBoost: reduced ? 0 : Math.max(ticks, glitch),
  };

  return {
    s, R, cx, cy, scale, brightness, fold: f,
    ring, blades, sticks, dots, globe,
    ambient: (0.16 + E * 0.15 + listen * 0.06 + 0.1 * env(mo, 'trail')) * brightness * body,
    sheen,
    point: {r: R * 0.06, alpha: smoothstep(f / 0.5) * (1 - smoothstep((f - 0.75) / 0.25))},
  };
}

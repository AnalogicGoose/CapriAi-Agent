import { smoothstep } from './math.js';

const m = (duration, priority, hold) => hold ? { duration: 0, priority, hold: true } : { duration, priority };

export const MOTIONS = {
  flare: m(900, 2), fold: m(700, 2), radar: m(1800, 1), scan: m(1400, 1), ticks: m(1200, 1),
  aim: m(0, 3, true), trail: m(1200, 1), chime: m(1800, 3), swirlIn: m(1300, 1), swirlOut: m(1300, 1),
  approval: m(0, 3, true), glitch: m(500, 3), celebrate: m(1400, 2), musicPulse: m(0, 1, true),
  wake: m(600, 2), pulse: m(500, 1), doublePulse: m(900, 1), spinBurst: m(1500, 2), breath: m(1600, 1),
};

const APP_FLARE = new Set(['open_url', 'open_app', 'open_workspace', 'open_media', 'play_music', 'play_video',
  'youtube_latest', 'open_result']);
const APP_RADAR = new Set(['search_web', 'search_news', 'steam_deals']);

const AGENT = {
  stella_close_app: 'fold',
  stella_screen: 'scan', stella_context: 'scan', stella_point_on_snapshot: 'scan',
  stella_input: 'ticks', stella_desktop_step: 'ticks', stella_control: 'ticks', stella_window_controls: 'ticks',
  stella_routine_step: 'ticks',
  stella_point: 'aim', stella_walkthrough: 'aim', stella_draw: 'trail', stella_reminder: 'swirlIn',
  stella_memory_learn: 'swirlIn', stella_memory_change: 'swirlIn', stella_project_change: 'swirlIn',
  stella_routines_save: 'swirlIn', stella_topic_recap: 'swirlIn',
  stella_memory_lookup: 'swirlOut', stella_project_lookup: 'swirlOut', stella_routines_lookup: 'swirlOut',
  stella_curiosity_lookup: 'swirlOut', stella_settings_read: 'swirlOut', stella_saved_work: 'swirlOut',
  stella_daily_review: 'swirlOut',
  stella_approval: 'approval',
  stella_settings_change: 'pulse', stella_routines_delete: 'pulse', stella_body: 'pulse',
};

// The AI's own built-in tools (src/main/native-activity.js).
const NATIVE = { native_web_search: 'radar', native_file_change: 'ticks', native_image_view: 'scan', native_tool: 'think' };

export function motionForAgentTool(tool, op) {
  if (tool === 'stella_apps') return APP_RADAR.has(op) ? 'radar' : 'flare';
  // Desktop steps that open or look something up are the same as stella_apps; the rest are clicks and typing.
  if (tool === 'stella_desktop_step' && (APP_RADAR.has(op) || APP_FLARE.has(op))) return APP_RADAR.has(op) ? 'radar' : 'flare';
  if (tool === 'native_command') return op === 'launch' ? 'flare' : 'ticks';
  if (Object.hasOwn(NATIVE, tool)) return NATIVE[tool];
  return Object.hasOwn(AGENT, tool) ? AGENT[tool] : 'think';
}

export function motionForCodexTool(tool = '') {
  if (/search|grep|glob|find|fetch|browse/i.test(tool)) return 'radar';
  if (/write|edit|patch|notebook/i.test(tool)) return 'ticks';
  if (/read|view|inspect|list/i.test(tool)) return 'scan';
  return 'think';
}

const ACT = {
  alarm: 'glitch', flinch: 'glitch', curious: 'pulse', hop: 'celebrate', victory: 'celebrate',
  split: 'spinBurst', zap: 'flare', point: 'aim', idleWave: 'doublePulse',
  idleStretch: 'breath', idleYawn: 'breath', idleBreathe: 'breath', idleSway: 'breath', idlePreen: 'breath',
  idleBounce: 'spinBurst', spin: 'spinBurst', dance: 'spinBurst',
};

export function motionForAct(name) {
  return Object.hasOwn(ACT, name) ? ACT[name] : null;
}

const NO_SIT = 'I don’t sit anymore — I just float around now.';
const BODY = {
  come: { come: true, motion: 'pulse' }, nap: { rest: true, motion: 'breath' },
  wake: { wake: true, motion: 'wake' }, mood: { motion: 'pulse' }, wave: { motion: 'doublePulse' },
  dance: { motion: 'spinBurst' }, stretch: { motion: 'breath' },
  sit: { motion: null, reply: NO_SIT }, stand: { motion: null, reply: NO_SIT },
};

export function bodyResponse(action) {
  return { motion: null, reply: null, ...(Object.hasOwn(BODY, action) ? BODY[action] : {}) };
}

// Holds that layer instead of replacing each other: the aimed blade and the approval ring.
export const CO_HOLDS = new Set(['aim', 'approval']);

const ROUTINE_GAP = 1800, CROSSFADE = 250, RELEASE = 400, HOLD_IN = 150;

export class MotionMixer {
  constructor() { this.list = []; this.lastRoutine = -Infinity; }

  // Envelope of a motion's own shape (ignoring crossfade-out).
  #shape(a, now) {
    const t = now - a.start;
    if (t < 0) return 0;
    let e;
    if (a.hold) {
      e = smoothstep(t / HOLD_IN);
      if (a.releasedAt != null) e = Math.min(e, 1 - smoothstep((now - a.releasedAt) / RELEASE));
    } else {
      const d = a.duration;
      if (t >= d) return 0;
      e = Math.min(smoothstep(t / (d * 0.15)), smoothstep((d - t) / (d * 0.25)));
    }
    return e;
  }

  #env(a, now) {
    let e = this.#shape(a, now);
    if (a.killedAt != null) e *= 1 - smoothstep((now - a.killedAt) / CROSSFADE);
    return e;
  }

  #alive(a, now) {
    if (a.killedAt != null && now >= a.killedAt + CROSSFADE) return false;
    if (a.hold) return a.releasedAt == null || now < a.releasedAt + RELEASE;
    return now - a.start < a.duration;
  }

  play(name, now) {
    const def = MOTIONS[name];
    if (!def) return false;
    this.list = this.list.filter(a => this.#alive(a, now));
    const live = this.list.filter(a => a.killedAt == null);
    if (def.hold && live.some(a => a.name === name && a.releasedAt == null)) return false;
    if (live.some(a => a.priority > def.priority)) return false;
    if (def.priority === 1) {
      if (now - this.lastRoutine < ROUTINE_GAP) return false;
      this.lastRoutine = now;
    }
    for (const a of live) if (!(CO_HOLDS.has(name) && CO_HOLDS.has(a.name))) a.killedAt = now;
    this.list.push({ name, start: now, duration: def.duration, priority: def.priority, hold: !!def.hold });
    return true;
  }

  release(name, now) {
    for (const a of this.list) if (a.name === name && a.hold && a.releasedAt == null && a.killedAt == null) a.releasedAt = now;
  }

  update(now) {
    const out = {};
    for (const a of this.list) {
      const e = this.#env(a, now);
      if (e > 0 && !(out[a.name] >= e)) out[a.name] = e;
    }
    return out;
  }

  busy(now) {
    for (const a of this.list) {
      if (a.hold && this.#alive(a, now) && a.releasedAt == null && a.killedAt == null) return true;
      if (a.priority >= 2 && (this.#env(a, now) > 0 || (a.killedAt == null && now >= a.start && this.#alive(a, now)))) return true;
    }
    return false;
  }
}

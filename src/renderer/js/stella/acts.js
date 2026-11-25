// Stella: her motions as acts — playing, performing, reacting to tools and her own
// agent, and the music pulse. Installed on Stella's prototype; `this` is the controller.
import { MOTIONS, motionForAct, motionForAgentTool, motionForCodexTool } from './motions.js';
import { letGo } from './focus.js';

const THINK_MS = 2000, MUSIC_MS = 45000, CELEBRATE_SPEAK_MS = 600;
const MUSIC_OPS = new Set(['play_music', 'play_video', 'youtube_latest']);
const resolved = () => Promise.resolve();

export const Acts = {
  // Starts a motion as her current act; null when it can't play. Nothing plays while she's dragged or dormant.
  start(name) {
    if (!name || !MOTIONS[name] || this.dragging || this.dormant) return null;
    const now = this.now();
    if (!this.motions.play(name, now)) return null;
    const entry = this.motions.list[this.motions.list.length - 1];
    this.endAct(false);
    const def = MOTIONS[name];
    const act = { name, entry, until: def.hold ? Infinity : now + def.duration };
    act.promise = new Promise(done => { act.done = done; });
    this._act = act;
    return act;
  },

  // Plays a motion; resolves when it ends or is replaced.
  play(name) { return this.start(name)?.promise ?? resolved(); },

  endAct(completed) {
    const a = this._act;
    if (!a) return;
    this._act = null;
    letGo(a.entry, this.now());
    a.done(completed);
  },

  // A held motion started here lets go after 1.5 s; one this call didn't start is left alone.
  perform(name, dir = 0) {
    const motion = motionForAct(name) ?? (MOTIONS[name] ? name : null);
    const act = motion && this.start(motion);
    if (!act) return resolved();
    if (MOTIONS[motion].hold) this.after(1500, () => { if (this._act === act) this.endAct(true); });
    return act.promise;
  },

  reactToAction(name) {
    if (name === 'think') { this.thinkUntil = this.now() + THINK_MS; return; }
    const motion = motionForAct(name) ?? (MOTIONS[name] && !MOTIONS[name].hold ? name : null);
    if (motion) this.play(motion);
  },

  reactToTool(tool) {
    const motion = motionForCodexTool(tool);
    if (motion === 'think') this.thinkUntil = this.now() + THINK_MS;
    else this.play(motion);
  },

  // A tool call from her own agent: { tool, op, phase: 'start' | 'end', ok }.
  agentActivity({ tool, op, phase, ok } = {}) {
    const motion = motionForAgentTool(tool, op), now = this.now();
    if (phase === 'start') {
      if (tool === 'capri_apps') this.releaseMusic();
      if (motion === 'think') { this.agentThink.set(tool, now); return; }
      if (tool === 'capri_draw') this.drawTarget = null; // toward the middle until the drawing reports where it is
      const act = this.start(motion);
      if (act && MOTIONS[motion].hold) this.agentHolds.set(tool, act);
      return;
    }
    if (phase !== 'end') return;
    this.agentThink.delete(tool);
    const act = this.agentHolds.get(tool);
    if (act) {
      this.agentHolds.delete(tool);
      letGo(act.entry, now);
      if (this._act === act) act.until = now;
    }
    if (ok === false) this.play('glitch');
    else if (ok && tool === 'capri_apps' && MUSIC_OPS.has(op)) this.musicUntil = now + MUSIC_MS;
  },

  releaseMusic() {
    this.musicUntil = 0;
    this.motions.release('musicPulse', this.now());
  },

  pulse() { return this.play('pulse'); },
  hurt() { return this.play('glitch'); },
  spark() { this.play('pulse'); return true; },
  zap() { this.play('flare'); return true; },
  gaze() { this.play('pulse'); return true; },
  earnUplink() { this.play('flare'); return true; },

  celebrate({ onSpeak } = {}) {
    this.play('celebrate');
    return new Promise(done => this.after(CELEBRATE_SPEAK_MS, () => { onSpeak?.(); done(); }));
  },

  stepMusic(now) {
    if (!this.musicUntil) return;
    if (now >= this.musicUntil) { this.releaseMusic(); return; }
    const on = this.motions.list.some(a => a.name === 'musicPulse' && a.killedAt == null && a.releasedAt == null);
    if (!on && !this.dragging && !this.dormant) this.motions.play('musicPulse', now);
  },
};

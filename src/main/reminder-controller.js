'use strict';
// Fired reminder -> delivery plan -> spoken line (with a one-time voice grant) and/or her reminder card, or held until
// fullscreen / Gaming mode / a locked session ends. A fired occurrence stays pending in the store (pending_due) until the
// user acts on it (Done, Snooze, or dismissing the card); redeliver() shows pending ones again, once, as missed, after a
// restart, a resume/unlock or a renderer reload. Card buttons and the voice commands "done" / "snooze N" act on it. Pure: main.js
// injects the overlay sender, TTS grant and command window, so this runs in tests without Electron.
const { deliveryPlan, reminderLine, HeldReminders } = require('./reminder-delivery');

const WINDOW_MS = 30000; // commands-only listening after a card is shown (spec decision 1)
const MAX_SNOOZE_MINUTES = 7 * 24 * 60;
const MAX_SENT = 32;

// minutes: a finite number in (0, 7 days], or 'tomorrow' (09:00 the next local day). Anything else -> null.
function snoozeUntil(minutes, nowMs) {
  if (minutes === 'tomorrow') {
    const d = new Date(nowMs);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 9, 0, 0, 0).getTime();
  }
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_SNOOZE_MINUTES) return null;
  return nowMs + Math.round(minutes * 60000);
}

// Card copy. {time} is local HH:MM, {n} a count. No companion name anywhere.
const COPY = {
  en: { done: 'Done', snooze10: 'Snooze 10 min', snooze: 'Snooze…', m15: '15 min', h1: '1 h', tomorrow: 'Tomorrow 9:00',
    ackDone: 'Done, nice work.', ackSnooze: 'Okay, I’ll remind you again at {time}.',
    stale: 'That one already moved on to its next time, so there was nothing to mark done.', failed: 'Sorry, I couldn’t do that. Try again?',
    more: '…and {n} more reminders. Ask me for your reminders to see them all.' },
  es: { done: 'Hecho', snooze10: 'Posponer 10 min', snooze: 'Posponer…', m15: '15 min', h1: '1 h', tomorrow: 'Mañana 9:00',
    ackDone: 'Hecho, muy bien.', ackSnooze: 'Vale, te lo recuerdo otra vez a las {time}.',
    stale: 'Ese ya pasó a su siguiente hora, así que no había nada que marcar como hecho.', failed: 'Perdona, no pude hacerlo. ¿Lo intentas otra vez?',
    more: '…y {n} recordatorios más. Pregúntame por tus recordatorios para verlos todos.' },
  fr: { done: 'Fait', snooze10: 'Reporter 10 min', snooze: 'Reporter…', m15: '15 min', h1: '1 h', tomorrow: 'Demain 9:00',
    ackDone: 'C’est fait, bravo.', ackSnooze: 'D’accord, je te le rappelle à {time}.',
    stale: 'Celui-ci est déjà passé à sa prochaine heure, il n’y avait rien à terminer.', failed: 'Désolée, je n’ai pas pu. Tu réessaies ?',
    more: '…et {n} autres rappels. Demande-moi tes rappels pour tous les voir.' },
  pt: { done: 'Feito', snooze10: 'Adiar 10 min', snooze: 'Adiar…', m15: '15 min', h1: '1 h', tomorrow: 'Amanhã 9:00',
    ackDone: 'Feito, muito bem.', ackSnooze: 'Certo, te lembro de novo às {time}.',
    stale: 'Esse já passou para o próximo horário, então não havia nada para marcar como feito.', failed: 'Desculpa, não consegui fazer isso. Tenta de novo?',
    more: '…e mais {n} lembretes. Pergunte pelos seus lembretes para ver todos.' },
  ru: { done: 'Готово', snooze10: 'Отложить на 10 мин', snooze: 'Отложить…', m15: '15 мин', h1: '1 ч', tomorrow: 'Завтра в 9:00',
    ackDone: 'Готово, молодец.', ackSnooze: 'Хорошо, напомню снова в {time}.',
    stale: 'Это напоминание уже перешло на следующее время, так что отмечать нечего.', failed: 'Прости, не получилось. Попробуешь ещё раз?',
    more: '…и ещё напоминаний: {n}. Спроси про напоминания, чтобы увидеть все.' },
};
const copy = lang => COPY[String(lang || '').toLowerCase().split(/[-_]/)[0]] || COPY.en;
const clock = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const keyOf = (id, firedDue) => `${id}:${firedDue}`;

class ReminderController {
  // state(): { fullscreen, gaming, overlayAvailable, voiceOn, locked }; send(payload) to the overlay ('reminder:due');
  // grant(line) -> one-time TTS token; openWindow(ms) opens commands-only listening; isOverlay(sender).
  constructor({ store, state, lang = () => 'en', send, grant, openWindow = () => {}, isOverlay = () => false, now = Date.now }) {
    Object.assign(this, { store, state, lang, send, grant, openWindow, isOverlay, now });
    this.held = new HeldReminders();
    this.sent = new Map(); // id:firedDue -> true, cards sent and not yet acted on
    this.last = null; // { id, firedDue, at } of the most recently shown card
    this.ready = false; // the overlay renderer has registered its reminder listener
  }

  // The renderer is (re)loaded and listening, or went away.
  // A reloaded renderer lost its cards: the pending ones are delivered again once it is ready.
  setReady(on) {
    this.ready = Boolean(on);
    if (!this.ready) { this.last = null; this.sent.clear(); return; }
    this.redeliver();
  }

  _state() {
    const s = this.state() || {};
    return { fullscreen: Boolean(s.fullscreen), gaming: Boolean(s.gaming), voiceOn: Boolean(s.voiceOn), locked: Boolean(s.locked),
      overlayAvailable: this.ready && Boolean(s.overlayAvailable) };
  }

  _line(entry) {
    return reminderLine({ text: entry.text, fired_due: entry.firedDue },
      { missed: entry.missed, lang: this.lang(), firedDue: entry.firedDue, now: this.now() });
  }

  _grant(line) { try { return this.grant(line); } catch { return undefined; } }

  _card(entry, speak) {
    const line = this._line(entry), t = copy(this.lang());
    this.sent.delete(keyOf(entry.id, entry.firedDue));
    this.sent.set(keyOf(entry.id, entry.firedDue), true);
    while (this.sent.size > MAX_SENT) this.sent.delete(this.sent.keys().next().value);
    const grant = speak ? this._grant(line) : undefined;
    this.send({ type: 'card', id: entry.id, firedDue: entry.firedDue, line,
      actions: [{ id: 'done', label: t.done }, { id: 'snooze10', label: t.snooze10 }, { id: 'snooze', label: t.snooze }],
      snooze: [{ minutes: 15, label: t.m15 }, { minutes: 60, label: t.h1 }, { minutes: 'tomorrow', label: t.tomorrow }], failed: t.failed,
      ...(grant ? { speak: true, grant } : {}) });
  }

  // Scheduler callback.
  fire(reminder, { missed = false, firedDue } = {}) {
    const s = this._state();
    const plan = deliveryPlan(s);
    const entry = { id: reminder.id, text: reminder.text, missed: Boolean(missed), firedDue: firedDue ?? reminder.fired_due ?? reminder.next_due };
    // Her voice goes through the overlay renderer: without it (or while locked), the line is spoken when the held card is shown.
    const speakNow = plan.speak && s.overlayAvailable && !s.locked;
    if (plan.card === 'now') { this._card(entry, speakNow); return; }
    if (speakNow) {
      const line = this._line(entry), grant = this._grant(line);
      if (grant) this.send({ type: 'speak', line, grant });
    }
    this.held.add({ ...entry, unspoken: plan.speak && !speakNow });
  }

  // Start, resume/unlock and renderer reload: every occurrence still pending in the store that is not already on its
  // way (held or sent) is delivered again, once, as missed. One per reminder (the store keeps only its latest), held
  // and flushed together so more than five collapse into the summary card (no burst).
  redeliver() {
    let rows = [];
    try { rows = this.store.pending(); } catch { return; }
    const s = this._state();
    for (const row of rows) {
      const firedDue = row.pending_due;
      if (this.sent.has(keyOf(row.id, firedDue)) || this.held.has(row.id, firedDue)) continue;
      this.held.add({ id: row.id, text: row.text, missed: true, firedDue, unspoken: s.voiceOn });
    }
    this.flush();
  }

  // Shows held cards once nothing holds them (fullscreen ended, Gaming mode off, session unlocked, renderer ready).
  flush() {
    const s = this._state();
    if (!s.overlayAvailable || s.fullscreen || s.gaming || s.locked) return;
    this.held.flush(({ reminders, more }) => {
      for (const entry of reminders) this._card(entry, entry.unspoken && s.voiceOn);
      if (more > 0) this.send({ type: 'more', line: copy(this.lang()).more.replace('{n}', String(more)) });
    });
  }

  // The renderer actually showed this card: it becomes the target of voice replies for WINDOW_MS.
  shown(sender, id, firedDue) {
    if (!this.isOverlay(sender) || !this.sent.has(keyOf(id, firedDue))) return false;
    this.last = { id, firedDue, at: this.now() };
    this.openWindow(WINDOW_MS);
    return true;
  }

  // 'reminder:action' from the overlay: (id, 'done'|'snooze'|'dismiss', firedDue, minutes number | 'tomorrow').
  // 'dismiss': the user clicked the card away; the occurrence is acknowledged (no longer pending).
  ipcAction(sender, id, action, firedDue, minutes) {
    if (!this.isOverlay(sender)) return { ok: false, error: 'Overlay required.' };
    return this.act(id, action, firedDue, minutes);
  }

  act(id, action, firedDue, minutes) {
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isFinite(firedDue) || !['done', 'snooze', 'dismiss'].includes(action)) {
      return { ok: false, error: 'Invalid reminder action.' };
    }
    const key = keyOf(id, firedDue);
    // Permanent failures resolve the card as gone (gone: true) instead of leaving it stuck on "try again".
    if (!this.sent.has(key)) return { ok: false, gone: true, error: 'That reminder card is no longer open.' };
    const t = copy(this.lang());
    let text;
    try {
      if (action === 'dismiss') {
        this.store.acknowledge(id, firedDue);
        this._forget(key);
        return { ok: true };
      }
      if (action === 'done') {
        const row = this.store.get(id);
        if (!row) { this._forget(key); return { ok: false, gone: true, error: 'Reminder not found.' }; }
        // A repeating card whose occurrence was already superseded (a newer one fired, or it was completed elsewhere):
        // nothing to complete, so say so honestly; the card is obsolete.
        if (row.schedule.kind !== 'once' && row.fired_due !== firedDue) {
          this._forget(key);
          return { ok: false, gone: true, text: t.stale };
        }
        this.store.complete(id, firedDue);
        text = t.ackDone;
      } else {
        const until = snoozeUntil(minutes, this.now());
        if (until === null) return { ok: false, error: 'Invalid snooze time.' };
        const row = this.store.snooze(id, until, firedDue);
        if (!row || row.status !== 'active' || row.snoozed_until !== until) {
          this._forget(key);
          return { ok: false, gone: true, error: 'That reminder can no longer be snoozed.' };
        }
        text = t.ackSnooze.replace('{time}', clock(until));
      }
    } catch { return { ok: false, error: 'Reminder storage is unavailable.' }; }
    this._forget(key);
    return { ok: true, text };
  }

  _forget(key) {
    this.sent.delete(key);
    if (this.last && keyOf(this.last.id, this.last.firedDue) === key) this.last = null;
  }

  // Commands-only listening: "done" / "snooze [N | tomorrow]" go to the most recently shown card within WINDOW_MS.
  // A superseded card is resolved with the honest line. Returns true when the command was meant for a reminder (even if the snooze value was rejected).
  voice({ command, minutes } = {}) {
    if (command !== 'done' && command !== 'snooze') return false;
    const last = this.last;
    if (!last || this.now() - last.at > WINDOW_MS) return false;
    const result = this.act(last.id, command, last.firedDue, command === 'snooze' ? (minutes ?? 10) : undefined);
    if (result.ok || result.gone) this.send({ type: 'resolved', id: last.id, firedDue: last.firedDue, line: result.text });
    return true;
  }
}

module.exports = { ReminderController, snoozeUntil, WINDOW_MS, MAX_SNOOZE_MINUTES };

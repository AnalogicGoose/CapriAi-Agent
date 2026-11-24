'use strict';

// Delivery policy for fired reminders and her short localized lines. Pure: no Electron.
// Quiet trial and paused check-ins are deliberately not inputs here: a reminder is a promise the user
// asked for, so only fullscreen, Gaming mode, voice and overlay availability matter.

// `overlayAvailable` means the overlay exists and is not destroyed (she may be stowed in her biochip).
function deliveryPlan({ fullscreen, gaming, overlayAvailable, voiceOn }) {
  if (fullscreen || gaming) return { speak: Boolean(voiceOn), card: 'held' };
  return { speak: Boolean(voiceOn), card: overlayAvailable ? 'now' : 'held' };
}

// {t} is the reminder text, {time} the local HH:MM it was due.
const LINES = {
  en: { normal: 'Reminder, sweetheart: {t}', missed: 'You missed this one, love: {t}, at {time}' },
  es: { normal: 'Recordatorio, cariño: {t}', missed: 'Se te pasó este, cielo: {t}, a las {time}' },
  fr: { normal: 'Rappel, mon cœur : {t}', missed: 'Tu as raté celui-ci, mon chou : {t}, à {time}' },
  pt: { normal: 'Lembrete, querido: {t}', missed: 'Você perdeu este, querido: {t}, às {time}' },
  ru: { normal: 'Напоминание, милый: {t}', missed: 'Ты пропустил это, милый: {t}, в {time}' },
};
// Plain Control room copy (the only place `name` is used).
const PLAIN = {
  en: { normal: '{name} reminder: {t}', missed: 'You missed: {t} at {time}' },
  es: { normal: 'Recordatorio de {name}: {t}', missed: 'Te perdiste: {t} a las {time}' },
  fr: { normal: 'Rappel de {name} : {t}', missed: 'Tu as manqué : {t} à {time}' },
  pt: { normal: 'Lembrete de {name}: {t}', missed: 'Você perdeu: {t} às {time}' },
  ru: { normal: 'Напоминание от {name}: {t}', missed: 'Вы пропустили: {t} в {time}' },
};

const pick = (table, lang) => table[typeof lang === 'string' ? lang.toLowerCase().split(/[-_]/)[0] : ''] || table.en;
const clock = (ms) => {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// reminder: { text, fired_due }. options: { missed, lang, name, firedDue, plain }.
// `firedDue` (epoch ms) overrides reminder.fired_due for the missed time. The spoken form never contains her
// name; pass `plain: true` with `name` (DISPLAY_NAME) for the Control room wording.
function reminderLine(reminder, { missed = false, lang, name = '', firedDue, plain = false } = {}) {
  const table = pick(plain ? PLAIN : LINES, lang);
  const time = clock(firedDue ?? reminder?.fired_due);
  return table[missed ? 'missed' : 'normal']
    .replace('{name}', name).replace('{time}', time).replace('{t}', () => String(reminder?.text ?? ''));
}

const MAX_CARDS = 5;

// Reminders held while fullscreen or Gaming mode is active.
class HeldReminders {
  constructor() { this.items = []; }

  // Same id + firedDue is held once. Each entry carries `firedDue` (falls back to fired_due).
  add(r) {
    const due = r.firedDue ?? r.fired_due;
    if (this.items.some((x) => x.id === r.id && (x.firedDue ?? x.fired_due) === due)) return;
    this.items.push(r);
  }

  // Calls fn({ reminders, more }) once, oldest first, then empties the queue; no call when empty.
  // At most 5 cards: with 5 or fewer, `reminders` has them all and `more` is 0. Beyond 5, `reminders` holds
  // the first 4 and the 5th card is the summary "and {more} more", where more = total - 4.
  flush(fn) {
    if (!this.items.length) return;
    const all = this.items;
    this.items = [];
    const collapsed = all.length > MAX_CARDS;
    fn({ reminders: collapsed ? all.slice(0, MAX_CARDS - 1) : all, more: collapsed ? all.length - (MAX_CARDS - 1) : 0 });
  }
}

module.exports = { deliveryPlan, reminderLine, HeldReminders, MAX_CARDS };

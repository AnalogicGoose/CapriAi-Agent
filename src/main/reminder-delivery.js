'use strict';

// Delivery policy for fired reminders and her short localized lines. Pure: no Electron.
// Quiet trial and paused check-ins are deliberately not inputs here: a reminder is a promise the user
// asked for, so only fullscreen, Gaming mode, voice and overlay availability matter.

// `overlayAvailable` means the overlay exists and is not destroyed (she may be resting in her corner).
// `locked`: the Windows session is locked or suspended; nobody is there, so the card (and its voice) waits for unlock.
function deliveryPlan({ fullscreen, gaming, overlayAvailable, voiceOn, locked = false }) {
  if (fullscreen || gaming || locked) return { speak: Boolean(voiceOn), card: 'held' };
  return { speak: Boolean(voiceOn), card: overlayAvailable ? 'now' : 'held' };
}

// {t} is the reminder text, {time} the local HH:MM it was due, {date} its local day (missedOn: not today).
const LINES = {
  en: { normal: 'Reminder, sweetheart: {t}', missed: 'You missed this one, love: {t}, at {time}', missedOn: 'You missed this one, love: {t}, on {date} at {time}' },
  es: { normal: 'Recordatorio, cariño: {t}', missed: 'Se te pasó este, cielo: {t}, a las {time}', missedOn: 'Se te pasó este, cielo: {t}, el {date} a las {time}' },
  fr: { normal: 'Rappel, mon cœur : {t}', missed: 'Tu as raté celui-ci, mon chou : {t}, à {time}', missedOn: 'Tu as raté celui-ci, mon chou : {t}, le {date} à {time}' },
  pt: { normal: 'Lembrete, querido: {t}', missed: 'Você perdeu este, querido: {t}, às {time}', missedOn: 'Você perdeu este, querido: {t}, em {date} às {time}' },
  ru: { normal: 'Напоминание, милый: {t}', missed: 'Ты пропустил это, милый: {t}, в {time}', missedOn: 'Ты пропустил это, милый: {t}, {date} в {time}' },
};
// Plain Control room copy (the only place `name` is used).
const PLAIN = {
  en: { normal: '{name} reminder: {t}', missed: 'You missed: {t} at {time}', missedOn: 'You missed: {t} on {date} at {time}' },
  es: { normal: 'Recordatorio de {name}: {t}', missed: 'Te perdiste: {t} a las {time}', missedOn: 'Te perdiste: {t} el {date} a las {time}' },
  fr: { normal: 'Rappel de {name} : {t}', missed: 'Tu as manqué : {t} à {time}', missedOn: 'Tu as manqué : {t} le {date} à {time}' },
  pt: { normal: 'Lembrete de {name}: {t}', missed: 'Você perdeu: {t} às {time}', missedOn: 'Você perdeu: {t} em {date} às {time}' },
  ru: { normal: 'Напоминание от {name}: {t}', missed: 'Вы пропустили: {t} в {time}', missedOn: 'Вы пропустили: {t} {date} в {time}' },
};
const LOCALE = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', pt: 'pt-BR', ru: 'ru-RU' };

const base = lang => (typeof lang === 'string' ? lang.toLowerCase().split(/[-_]/)[0] : '');
const pick = (table, lang) => table[base(lang)] || table.en;
const sameDay = (a, b) => { const x = new Date(a), y = new Date(b); return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate(); };
// Local day like "Nov 22" / "22 nov" (the year too when it is not this year).
function day(ms, lang, nowMs) {
  const options = { day: 'numeric', month: 'short', ...(new Date(ms).getFullYear() !== new Date(nowMs).getFullYear() ? { year: 'numeric' } : {}) };
  try { return new Intl.DateTimeFormat(LOCALE[base(lang)] || 'en-US', options).format(ms); }
  catch { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
}
const clock = (ms) => {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// reminder: { text, fired_due }. options: { missed, lang, name, firedDue, plain, now }.
// `firedDue` (epoch ms) overrides reminder.fired_due for the missed time; a missed time on another day than `now`
// also says the day. The spoken form never contains her name; pass `plain: true` with `name` (DISPLAY_NAME) for the
// Control room wording.
function reminderLine(reminder, { missed = false, lang, name = '', firedDue, plain = false, now = Date.now() } = {}) {
  const table = pick(plain ? PLAIN : LINES, lang);
  const due = firedDue ?? reminder?.fired_due;
  const time = clock(due);
  const otherDay = missed && Number.isFinite(due) && !sameDay(due, now);
  return table[missed ? (otherDay ? 'missedOn' : 'missed') : 'normal']
    .replace('{name}', name).replace('{date}', otherDay ? day(due, lang, now) : '').replace('{time}', time)
    .replace('{t}', () => String(reminder?.text ?? ''));
}

const MAX_CARDS = 5;

// Reminders held while fullscreen or Gaming mode is active.
class HeldReminders {
  constructor() { this.items = []; }

  // One entry per reminder: its latest occurrence (a newer one replaces an older one held for the same id).
  // Each entry carries `firedDue` (falls back to fired_due).
  add(r) {
    const due = r.firedDue ?? r.fired_due;
    const index = this.items.findIndex((x) => x.id === r.id);
    if (index >= 0) {
      if ((this.items[index].firedDue ?? this.items[index].fired_due) >= due) return;
      this.items.splice(index, 1);
    }
    this.items.push(r);
  }

  has(id, due) { return this.items.some((x) => x.id === id && (x.firedDue ?? x.fired_due) === due); }

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

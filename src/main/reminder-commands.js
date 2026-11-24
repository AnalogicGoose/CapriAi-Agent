'use strict';
// Reminder tool helpers and offline commands (no Codex needed).
const { describe } = require('./reminder-schedule');

// Appended to the tool instructions only while capri_reminder is offered (kept under 200 bytes).
const REMINDER_INSTRUCTIONS = '\nFor reminders use capri_reminder. Give the schedule JSON in the user\'s local time, and repeat the exact time from its result back to them.';

const pad = n => String(n).padStart(2, '0');
function localTime(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const effective = row => (row.snoozed_until ?? row.next_due);
const summary = (row, lang) => ({ id: row.id, text: row.text, next: localTime(effective(row)), repeat: describe(row.schedule, lang) });

const T = {
  en: { none: 'You have no reminders right now.', head: 'Your reminders:', gone: id => `I can't find an active reminder ${id}.`,
    cancelled: (id, t) => `Okay, reminder ${id} is cancelled: ${t}`, done: (id, t) => `Done, nice work: ${t}`, usage: 'Try /remind list, /remind cancel <number> or /remind done <number>.' },
  es: { none: 'Ahora mismo no tienes recordatorios.', head: 'Tus recordatorios:', gone: id => `No encuentro un recordatorio activo ${id}.`,
    cancelled: (id, t) => `Listo, recordatorio ${id} cancelado: ${t}`, done: (id, t) => `Hecho, bien: ${t}`, usage: 'Prueba /remind list, /remind cancel <número> o /remind done <número>.' },
  fr: { none: 'Tu n\'as aucun rappel pour le moment.', head: 'Tes rappels :', gone: id => `Je ne trouve pas de rappel actif ${id}.`,
    cancelled: (id, t) => `C'est fait, rappel ${id} annulé : ${t}`, done: (id, t) => `Terminé, bravo : ${t}`, usage: 'Essaie /remind list, /remind cancel <numéro> ou /remind done <numéro>.' },
  pt: { none: 'Você não tem lembretes agora.', head: 'Seus lembretes:', gone: id => `Não encontro um lembrete ativo ${id}.`,
    cancelled: (id, t) => `Pronto, lembrete ${id} cancelado: ${t}`, done: (id, t) => `Feito, muito bem: ${t}`, usage: 'Tente /remind list, /remind cancel <número> ou /remind done <número>.' },
  ru: { none: 'Сейчас у тебя нет напоминаний.', head: 'Твои напоминания:', gone: id => `Не нахожу активное напоминание ${id}.`,
    cancelled: (id, t) => `Готово, напоминание ${id} отменено: ${t}`, done: (id, t) => `Готово, молодец: ${t}`, usage: 'Попробуй /remind list, /remind cancel <номер> или /remind done <номер>.' },
};

const ASK_LIST = [
  /^(?:what (?:are|is) my reminders?|what reminders? do i have|(?:list|show)(?: me)?(?: all)?(?: of)? my reminders?)$/u,
  /^(?:qu[eé] recordatorios? tengo|cu[aá]les son mis recordatorios?|(?:mu[eé]strame|lista) mis recordatorios?)$/u,
  /^(?:quels sont mes rappels|quels rappels (?:ai-je|j'ai)|(?:montre|liste)(?:-moi)? mes rappels)$/u,
  /^(?:quais s[aã]o meus lembretes|que lembretes eu tenho|(?:mostre|liste)(?: meus)? lembretes)$/u,
  /^(?:какие у меня напоминания|покажи(?: мне)? (?:мои )?напоминания)$/u,
];

function normalize(text) {
  return String(text).normalize('NFC').toLowerCase().replace(/[¿¡?!.,;:]+/gu, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:hey\s+)?capri\s+/u, '');
}

function renderList(store, lang) {
  const t = T[lang] || T.en;
  const rows = store.list();
  if (!rows.length) return t.none;
  return [t.head, ...rows.map(row => { const s = summary(row, lang); return `${s.id}. ${s.text}: ${s.next} (${s.repeat})`; })].join('\n');
}

function routeReminderCommand(text, store, lang) {
  if (typeof text !== 'string' || !store) return null;
  const t = T[lang] || T.en;
  const slash = /^\s*\/remind(?:\s+(\S+))?(?:\s+(\S+))?\s*$/iu.exec(text);
  if (slash) {
    const verb = (slash[1] || 'list').toLowerCase();
    if (verb === 'list' && !slash[2]) return { handled: true, text: renderList(store, lang) };
    if ((verb === 'cancel' || verb === 'done') && /^\d{1,9}$/.test(slash[2] || '')) {
      const id = Number(slash[2]);
      const row = store.get(id);
      if (!row || row.status !== 'active') return { handled: true, text: t.gone(id) };
      if (verb === 'cancel') store.cancel(id); else store.complete(id, row.fired_due);
      return { handled: true, text: (verb === 'cancel' ? t.cancelled : t.done)(id, row.text) };
    }
    return { handled: true, text: t.usage };
  }
  const plain = normalize(text);
  if (ASK_LIST.some(re => re.test(plain))) return { handled: true, text: renderList(store, lang) };
  return null;
}

module.exports = { REMINDER_INSTRUCTIONS, localTime, summary, routeReminderCommand };

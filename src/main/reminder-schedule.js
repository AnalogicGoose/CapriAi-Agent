'use strict';
// Pure schedule math for reminders. Local time, DST handled by the platform via new Date(y, m, d, hh, mm).

const KINDS = ['once', 'daily', 'weekdays', 'days', 'interval', 'monthly'];
const MIN_EVERY = 5;
const MAX_EVERY = 10080;
const SEARCH_DAYS = 400;
const AT_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function fail(field, why) { throw new Error(`Invalid schedule: ${field} ${why}`); }

function readAt(s) {
  if (typeof s.at !== 'string' || !AT_RE.test(s.at)) fail('at', 'must be HH:MM (00:00-23:59)');
  return s.at;
}

function readStart(value) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail('start', 'must be an ISO date string');
  return value;
}

function parseDate(value) {
  const m = typeof value === 'string' && DATE_RE.exec(value);
  if (!m) fail('date', 'must be YYYY-MM-DD');
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const check = new Date(y, mo, d);
  if (check.getFullYear() !== y || check.getMonth() !== mo || check.getDate() !== d) fail('date', 'is not a real calendar date');
  return { y, mo, d };
}

function validateSchedule(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) fail('schedule', 'must be an object');
  if (!KINDS.includes(s.kind)) fail('kind', `must be one of ${KINDS.join(', ')}`);
  switch (s.kind) {
    case 'once': {
      if (s.date !== undefined || s.at !== undefined) {
        parseDate(s.date);
        return { kind: 'once', date: s.date, at: readAt(s) };
      }
      if (s.start === undefined) fail('date', 'and at (or start) are required for once');
      return { kind: 'once', start: readStart(s.start) };
    }
    case 'daily':
    case 'weekdays':
      return { kind: s.kind, at: readAt(s) };
    case 'days': {
      if (!Array.isArray(s.days) || !s.days.length || !s.days.every(n => Number.isInteger(n) && n >= 0 && n <= 6)) {
        fail('days', 'must be a non-empty array of integers 0 (Sun) to 6 (Sat)');
      }
      return { kind: 'days', days: [...new Set(s.days)].sort((a, b) => a - b), at: readAt(s) };
    }
    case 'interval': {
      if (!Number.isInteger(s.every_minutes) || s.every_minutes < MIN_EVERY || s.every_minutes > MAX_EVERY) {
        fail('every_minutes', `must be an integer from ${MIN_EVERY} to ${MAX_EVERY}`);
      }
      return { kind: 'interval', every_minutes: s.every_minutes, start: s.start === undefined ? new Date().toISOString() : readStart(s.start) };
    }
    default: {
      if (!Number.isInteger(s.day_of_month) || s.day_of_month < 1 || s.day_of_month > 31) fail('day_of_month', 'must be an integer from 1 to 31');
      return { kind: 'monthly', day_of_month: s.day_of_month, at: readAt(s) };
    }
  }
}

function nextDue(schedule, after) {
  const s = validateSchedule(schedule);
  const afterMs = after instanceof Date ? after.getTime() : Number(after);
  if (!Number.isFinite(afterMs)) throw new Error('Invalid after: must be a Date');

  if (s.kind === 'once') {
    let t;
    if (s.start) t = Date.parse(s.start);
    else {
      const { y, mo, d } = parseDate(s.date);
      const [hh, mm] = s.at.split(':').map(Number);
      t = new Date(y, mo, d, hh, mm).getTime();
    }
    return t > afterMs ? new Date(t) : null;
  }

  if (s.kind === 'interval') {
    const step = s.every_minutes * 60000;
    const start = Date.parse(s.start);
    if (afterMs < start) return new Date(start);
    return new Date(start + (Math.floor((afterMs - start) / step) + 1) * step);
  }

  const [hh, mm] = s.at.split(':').map(Number);
  const base = new Date(afterMs);
  for (let i = 0; i <= SEARCH_DAYS; i++) {
    const y = base.getFullYear(), mo = base.getMonth(), d = base.getDate() + i;
    const cand = new Date(y, mo, d, hh, mm);
    if (cand.getTime() <= afterMs) continue;
    const dow = cand.getDay();
    if (s.kind === 'weekdays' && (dow === 0 || dow === 6)) continue;
    if (s.kind === 'days' && !s.days.includes(dow)) continue;
    if (s.kind === 'monthly') {
      const last = new Date(cand.getFullYear(), cand.getMonth() + 1, 0).getDate();
      if (cand.getDate() !== Math.min(s.day_of_month, last)) continue;
    }
    return cand;
  }
  return null;
}

const T = {
  en: {
    once: (a, d) => `Once on ${d} at ${a}`, onceStart: 'Once', daily: a => `Daily at ${a}`, weekdays: a => `Weekdays at ${a}`,
    days: (a, l) => `${l} at ${a}`, monthly: (a, n) => `Monthly on day ${n} at ${a}`,
    everyMin: n => `Every ${n} minutes`, everyHour: n => (n === 1 ? 'Every hour' : `Every ${n} hours`), everyDay: n => (n === 1 ? 'Every day' : `Every ${n} days`),
    names: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  },
  es: {
    once: (a, d) => `Una vez el ${d} a las ${a}`, onceStart: 'Una vez', daily: a => `Cada día a las ${a}`, weekdays: a => `Días laborables a las ${a}`,
    days: (a, l) => `${l} a las ${a}`, monthly: (a, n) => `Cada mes el día ${n} a las ${a}`,
    everyMin: n => `Cada ${n} minutos`, everyHour: n => (n === 1 ? 'Cada hora' : `Cada ${n} horas`), everyDay: n => (n === 1 ? 'Cada día' : `Cada ${n} días`),
    names: ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'],
  },
  fr: {
    once: (a, d) => `Une fois le ${d} à ${a}`, onceStart: 'Une fois', daily: a => `Chaque jour à ${a}`, weekdays: a => `En semaine à ${a}`,
    days: (a, l) => `${l} à ${a}`, monthly: (a, n) => `Chaque mois le ${n} à ${a}`,
    everyMin: n => `Toutes les ${n} minutes`, everyHour: n => (n === 1 ? 'Toutes les heures' : `Toutes les ${n} heures`), everyDay: n => (n === 1 ? 'Chaque jour' : `Tous les ${n} jours`),
    names: ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'],
  },
  pt: {
    once: (a, d) => `Uma vez em ${d} às ${a}`, onceStart: 'Uma vez', daily: a => `Todo dia às ${a}`, weekdays: a => `Dias úteis às ${a}`,
    days: (a, l) => `${l} às ${a}`, monthly: (a, n) => `Todo mês no dia ${n} às ${a}`,
    everyMin: n => `A cada ${n} minutos`, everyHour: n => (n === 1 ? 'A cada hora' : `A cada ${n} horas`), everyDay: n => (n === 1 ? 'Todo dia' : `A cada ${n} dias`),
    names: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'],
  },
  ru: {
    once: (a, d) => `Один раз ${d} в ${a}`, onceStart: 'Один раз', daily: a => `Каждый день в ${a}`, weekdays: a => `По будням в ${a}`,
    days: (a, l) => `${l} в ${a}`, monthly: (a, n) => `Каждый месяц, ${n}-го числа в ${a}`,
    everyMin: n => `Каждые ${n} мин.`, everyHour: n => (n === 1 ? 'Каждый час' : `Каждые ${n} ч.`), everyDay: n => (n === 1 ? 'Каждый день' : `Каждые ${n} дн.`),
    names: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
  },
};

function describe(schedule, lang) {
  const s = validateSchedule(schedule);
  const t = T[lang] || T.en;
  switch (s.kind) {
    case 'once': return s.date ? t.once(s.at, s.date) : t.onceStart;
    case 'daily': return t.daily(s.at);
    case 'weekdays': return t.weekdays(s.at);
    case 'days': return t.days(s.at, s.days.map(d => t.names[d]).join(', '));
    case 'monthly': return t.monthly(s.at, s.day_of_month);
    default: {
      const m = s.every_minutes;
      if (m % 1440 === 0) return t.everyDay(m / 1440);
      if (m % 60 === 0) return t.everyHour(m / 60);
      return t.everyMin(m);
    }
  }
}

module.exports = { KINDS, validateSchedule, nextDue, describe };

'use strict';
// Fixed local voice/text commands for walkthroughs and reminders in en/es/fr/pt/ru. Matching is local, needs no AI
// call, and is whole-utterance: after dropping her name and courtesy/filler words ("please", "por favor",
// "s'il te plaît", "пожалуйста", "step"/"paso"…), the whole message must be the command, so a remark that merely
// contains a command word ("next time remind me", "stop the music") is not one.
const { DISPLAY_NAME } = require('./identity');
const COMMANDS = {
  next: ['next', 'next step', 'next one', 'siguiente', 'sigue', 'suivant', 'suivante', 'suite', 'próximo', 'proximo', 'seguinte',
    'далее', 'дальше', 'следующий'],
  back: ['back', 'go back', 'previous', 'atrás', 'atras', 'volver', 'regresa', 'retour', 'précédent', 'precedent', 'revenir',
    'voltar', 'volta', 'anterior', 'назад', 'вернись'],
  repeat: ['repeat', 'repeat that', 'say that again', 'again', 'repite', 'repítelo', 'repitelo', 'repetir', 'otra vez', 'répète',
    'repete', 'encore une fois', 'repita', 'de novo', 'повтори', 'ещё раз', 'еще раз'],
  stop: ['stop', 'cancel', 'enough', 'para', 'detente', 'basta', 'arrête', 'arrete', 'arrête toi', 'arrete toi', 'pare', 'chega',
    'стоп', 'хватит'],
  continue: ['continue', 'go on', 'resume', 'continúa', 'continua', 'continuar', 'sigue adelante', 'continuer', 'reprends',
    'продолжай', 'продолжить'],
  done: ['done', "i'm done", 'i’m done', 'finished', 'i did it', 'did it', 'hecho', 'listo', 'ya está', 'ya esta', 'terminado',
    'ya lo hice', 'fait', "c'est fait", 'c’est fait', 'terminé', 'termine', 'fini', 'feito', 'pronto', 'concluído', 'concluido',
    'já fiz', 'готово', 'сделано', 'сделал', 'сделала'],
  snooze: ['snooze', 'remind me later', 'later', 'pospón', 'pospon', 'posponer', 'más tarde', 'mas tarde', 'luego', 'reporte',
    'reporter', 'plus tard', 'rappelle moi plus tard', 'adiar', 'adia', 'mais tarde', 'отложи', 'позже', 'напомни позже'],
};
const SNOOZE_VERBS = ['snooze', 'remind me in', 'remind me', 'pospón', 'pospon', 'posponer', 'reporte', 'reporter', 'rappelle moi dans',
  'adiar', 'adia', 'отложи', 'напомни через'];
const FILLER = new Set([...DISPLAY_NAME.toLowerCase().split(/\s+/).filter(Boolean), 'hey', 'oye', 'эй', 'ей', 'ok', 'okay', 'vale', 'alright', 'please', 'pls', 'por', 'favor',
  "s'il", 's’il', 'te', 'vous', 'plaît', 'plait', 'пожалуйста', 'step', 'paso', 'étape', 'etape', 'passo', 'шаг',
  'the', 'el', 'al', 'le', 'la', 'o', 'now', 'ahora', 'maintenant', 'agora', 'теперь', 'давай']);
const PREPOSITIONS = new Set(['for', 'in', 'por', 'para', 'durante', 'en', 'de', 'pour', 'dans', 'pendant', 'em', 'на', 'через']);
const TOMORROW = /^(?:(?:until|till|hasta|jusqu'à|jusqu’à|jusqu'a|até|ate|до)\s+)?(?:tomorrow|mañana|manana|demain|amanhã|amanha|завтра)$/u;
const HALF_HOUR = new Set(['half an hour', 'half hour', 'media hora', 'demi heure', 'une demi heure', 'meia hora', 'полчаса']);
const NUMBERS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, 'forty five': 45,
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, diez: 10, quince: 15, veinte: 20, treinta: 30, 'cuarenta y cinco': 45,
  une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, dix: 10, quinze: 15, vingt: 20, trente: 30, 'quarante cinq': 45,
  um: 1, uma: 1, dois: 2, duas: 2, três: 3, quatro: 4, dez: 10, vinte: 20, trinta: 30, 'quarenta e cinco': 45,
  один: 1, одну: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, десять: 10, пятнадцать: 15, двадцать: 20, тридцать: 30,
  'сорок пять': 45,
};
const MINUTE = /^(?:minutes?|mins?|minutos?|минут[уы]?)$/u;
const HOUR = /^(?:hours?|horas?|heures?|час|часа|часов)$/u;
const MAX_MINUTES = 24 * 60;

const normalize = text => String(text || '').toLowerCase().normalize('NFC')
  .replace(/[^\p{L}\p{N}\s'’]/gu, ' ').split(/\s+/).filter(word => word && !FILLER.has(word)).join(' ');

// "15 minutes", "an hour", "diez minutos", "until tomorrow" -> minutes or 'tomorrow'; anything else -> null.
function duration(rest) {
  let words = rest.split(' ');
  if (PREPOSITIONS.has(words[0])) words = words.slice(1);
  const phrase = words.join(' ');
  if (TOMORROW.test(phrase)) return 'tomorrow';
  if (HALF_HOUR.has(phrase)) return 30;
  const unit = words.at(-1);
  const factor = MINUTE.test(unit) ? 1 : HOUR.test(unit) ? 60 : 0;
  if (!factor) return null;
  const amount = words.slice(0, -1).join(' ');
  const count = amount === '' && factor === 60 ? 1 : /^\d{1,4}$/.test(amount) ? Number(amount) : NUMBERS[amount];
  const minutes = count * factor;
  return Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= MAX_MINUTES ? minutes : null;
}

function commandPhrase(text) {
  if (typeof text !== 'string' || text.length > 200) return null;
  const said = normalize(text);
  if (!said) return null;
  for (const [command, words] of Object.entries(COMMANDS)) if (words.includes(said)) return { command };
  for (const verb of SNOOZE_VERBS) {
    if (!said.startsWith(verb + ' ')) continue;
    const minutes = duration(said.slice(verb.length + 1));
    return minutes === null ? null : { command: 'snooze', minutes };
  }
  return null;
}

module.exports = { commandPhrase, WALKTHROUGH_COMMANDS: ['next', 'back', 'repeat', 'stop', 'continue'] };

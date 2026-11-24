'use strict';

// Short local lines in her warm voice for guide moments that need no AI call: walkthrough endings,
// the exclusive-fullscreen notice, replies to local walkthrough commands and the guide card's buttons.
const LINES = {
  en: {
    done: 'All done, sweetheart. You did that beautifully.',
    lost: 'I lost the thread there, sorry. Want to start over together?',
    'paused-too-long': 'I paused the walkthrough for now. Ask me again whenever you’re ready.',
    'exclusive-fullscreen': 'That game is in exclusive fullscreen, so I can’t draw over it. I’ll just talk you through it.',
    stopped: 'Okay, I stopped the walkthrough.',
    ok: 'Okay.',
  },
  es: {
    done: 'Listo, cariño. Lo hiciste de maravilla.',
    lost: 'Perdí el hilo, lo siento. ¿Empezamos de nuevo juntos?',
    'paused-too-long': 'Dejé la guía en pausa por ahora. Pídemela otra vez cuando quieras.',
    'exclusive-fullscreen': 'Ese juego está en pantalla completa exclusiva, así que no puedo dibujar encima. Te guío solo con la voz.',
    stopped: 'Vale, detuve la guía.',
    ok: 'Vale.',
  },
  fr: {
    done: 'Et voilà, mon cœur. Tu t’en es très bien sorti.',
    lost: 'J’ai perdu le fil, désolée. On recommence ensemble ?',
    'paused-too-long': 'J’ai mis le guide en pause. Redemande-moi quand tu veux.',
    'exclusive-fullscreen': 'Ce jeu est en plein écran exclusif, je ne peux pas dessiner dessus. Je te guide à la voix.',
    stopped: 'D’accord, j’ai arrêté le guide.',
    ok: 'D’accord.',
  },
  pt: {
    done: 'Pronto, querido. Você foi ótimo.',
    lost: 'Perdi o fio da meada, desculpa. Vamos começar de novo juntos?',
    'paused-too-long': 'Deixei o guia em pausa por enquanto. É só pedir de novo quando quiser.',
    'exclusive-fullscreen': 'Esse jogo está em tela cheia exclusiva, então não consigo desenhar por cima. Vou te guiar só pela voz.',
    stopped: 'Tudo bem, parei o guia.',
    ok: 'Tudo bem.',
  },
  ru: {
    done: 'Готово, милый. Ты отлично справился.',
    lost: 'Я потеряла нить, прости. Начнём заново вместе?',
    'paused-too-long': 'Я пока поставила подсказки на паузу. Попроси ещё раз, когда будешь готов.',
    'exclusive-fullscreen': 'Эта игра в эксклюзивном полноэкранном режиме, рисовать поверх я не могу. Подскажу голосом.',
    stopped: 'Хорошо, я остановила подсказки.',
    ok: 'Хорошо.',
  },
};
const BUTTONS = {
  en: { next: 'Next', stop: 'Stop' },
  es: { next: 'Siguiente', stop: 'Parar' },
  fr: { next: 'Suivant', stop: 'Arrêter' },
  pt: { next: 'Próximo', stop: 'Parar' },
  ru: { next: 'Далее', stop: 'Стоп' },
};
const KINDS = ['done', 'lost', 'paused-too-long', 'exclusive-fullscreen', 'stopped', 'ok'];

const table = (source, lang) => source[typeof lang === 'string' ? lang.toLowerCase().split(/[-_]/)[0] : ''] || source.en;
const guideLine = (kind, lang) => table(LINES, lang)[kind] || LINES.en[kind] || '';
const guideButton = (id, lang) => table(BUTTONS, lang)[id] || BUTTONS.en[id] || id;

module.exports = { guideLine, guideButton, KINDS };

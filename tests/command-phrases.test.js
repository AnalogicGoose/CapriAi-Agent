'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { commandPhrase } = require('../src/main/command-phrases');

const said = text => commandPhrase(text)?.command ?? null;

test('command phrases in five languages map to the same commands', () => {
  const phrases = {
    next: { en: ['next', 'Next step, please!'], es: ['siguiente', 'sigue'], fr: ['Suivant !', 'la suite'], pt: ['próximo', 'seguinte'], ru: ['далее', 'дальше'] },
    back: { en: ['back', 'go back'], es: ['atrás', 'volver'], fr: ['retour', 'précédent'], pt: ['voltar', 'anterior'], ru: ['назад', 'вернись'] },
    repeat: { en: ['repeat', 'say that again'], es: ['repite', 'repítelo'], fr: ['répète', 'encore une fois'], pt: ['repete', 'repita'], ru: ['повтори', 'ещё раз'] },
    stop: { en: ['stop', 'cancel'], es: ['para', 'detente'], fr: ['arrête', 'arrête-toi'], pt: ['pare', 'chega'], ru: ['стоп', 'хватит'] },
    continue: { en: ['continue', 'go on'], es: ['continúa', 'sigue adelante'], fr: ['continue', 'reprends'], pt: ['continua', 'continuar'], ru: ['продолжай', 'продолжить'] },
    done: { en: ['done', "I'm done"], es: ['hecho', 'ya está'], fr: ['fait', "c'est fait"], pt: ['feito', 'pronto'], ru: ['готово', 'сделано'] },
    snooze: { en: ['snooze', 'remind me later'], es: ['pospón', 'más tarde'], fr: ['reporte', 'plus tard'], pt: ['adiar', 'mais tarde'], ru: ['отложи', 'напомни позже'] },
  };
  for (const [command, languages] of Object.entries(phrases)) {
    for (const [lang, list] of Object.entries(languages)) {
      assert.ok(list.length >= 2, `${command}/${lang}`);
      for (const text of list) assert.equal(said(text), command, `${lang}: ${text}`);
    }
  }
  assert.equal(said('Hey Stella, next'), 'next');
  assert.equal(said('Hey Stella, next'), 'next');
  assert.equal(said('siguiente por favor'), 'next');
  for (const remark of ['what a nice day', 'next time remind me', 'I clicked it', 'please', 'stop the music', 'done with lunch soon', '', null, 42])
    assert.equal(commandPhrase(remark), null, String(remark));
});

test('numbers and words for snooze durations', () => {
  assert.deepEqual(commandPhrase('snooze 15 minutes'), { command: 'snooze', minutes: 15 });
  assert.deepEqual(commandPhrase('snooze an hour'), { command: 'snooze', minutes: 60 });
  assert.deepEqual(commandPhrase('pospón diez minutos'), { command: 'snooze', minutes: 10 });
  assert.deepEqual(commandPhrase('pospón 10 minutos'), { command: 'snooze', minutes: 10 });
  assert.deepEqual(commandPhrase('Snooze for 2 hours.'), { command: 'snooze', minutes: 120 });
  assert.deepEqual(commandPhrase('snooze half an hour'), { command: 'snooze', minutes: 30 });
  assert.deepEqual(commandPhrase('reporte de cinq minutes'), { command: 'snooze', minutes: 5 });
  assert.deepEqual(commandPhrase('adiar uma hora'), { command: 'snooze', minutes: 60 });
  assert.deepEqual(commandPhrase('отложи на пятнадцать минут'), { command: 'snooze', minutes: 15 });
  assert.deepEqual(commandPhrase('snooze until tomorrow'), { command: 'snooze', minutes: 'tomorrow' });
  assert.deepEqual(commandPhrase('pospón hasta mañana'), { command: 'snooze', minutes: 'tomorrow' });
  assert.deepEqual(commandPhrase('отложи до завтра'), { command: 'snooze', minutes: 'tomorrow' });
  assert.deepEqual(commandPhrase('snooze'), { command: 'snooze' });
  for (const bad of ['snooze 0 minutes', 'snooze 5000 minutes', 'snooze banana minutes', 'snooze 15 bananas']) assert.equal(commandPhrase(bad), null, bad);
});

test('her display name is dropped as an address, from identity.js', () => {
  const { DISPLAY_NAME } = require('../src/main/identity');
  const { commandPhrase: phrase } = require('../src/main/command-phrases');
  assert.deepEqual(phrase(`${DISPLAY_NAME}, next`), { command: 'next' });
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/main/command-phrases.js'), 'utf8');
  assert.ok(!/'stella'/i.test(src), 'no hard-coded name');
});

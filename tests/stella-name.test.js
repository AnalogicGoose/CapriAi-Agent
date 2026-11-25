'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const { DISPLAY_NAME } = require('../src/main/identity');
const { wakePhrase } = require('../src/main/wake-phrase');

test('her visible name is Stella', () => {
  assert.equal(DISPLAY_NAME, 'Stella');
  assert.match(read('src/main/personality.js'), /const PERSONA = `You are Stella,/);
  assert.match(read('src/main/personality.js'), /Your character is Stella:/);
  assert.doesNotMatch(read('src/renderer/js/chat.js'), /You are Capri|Project Capricorn|digital ghost/);
  assert.doesNotMatch(read('src/renderer/js/panel.js'), /CAPRI \/\/|PROJECT CAPRICORN/);
});

test('Hey Stella wakes her; Hey Capri still works quietly', () => {
  assert.deepEqual(wakePhrase('Hey Stella, open music'), { text: 'open music' });
  assert.deepEqual(wakePhrase('hey stella'), { text: '' });
  assert.deepEqual(wakePhrase('Hey Capri what time'), { text: 'what time' });
  assert.equal(wakePhrase('I told Stella hi'), null);
  assert.deepEqual(wakePhrase('Hey Stela, lights'), { text: 'lights' }, 'a common one-l transcription');
});

test('indicators say Hey Stella', () => {
  const wake = read('src/renderer/js/wake-listener.js'), voice = read('src/renderer/js/voice-call.js');
  assert.match(wake, /Hey Stella/); assert.doesNotMatch(wake, /Hey Capri|Capri is/);
  assert.doesNotMatch(voice, /'Capri is/);
  assert.match(read('src/renderer/index.html'), /aria-label="Talk to Stella"/);
  assert.match(read('src/renderer/index.html'), /<span class="panel__who">Stella<\/span>/);
});

test('chat UI strings drop the old persona in every language', () => {
  const lines = read('src/renderer/js/lines.js').replace(/\r/g, '');
  const blocks = [...lines.matchAll(/\n {4}chat: \{([\s\S]*?)\n {4}\},?\n/g)].map(m => m[1]);
  assert.equal(blocks.length, 5);
  for (const block of blocks) {
    const ui = block.split('\n').filter(line => /^\s*(badge|hello|again|placeholder|noteTag|note):/.test(line)).join('\n');
    assert.ok(ui, 'chat block has UI strings');
    assert.doesNotMatch(ui, /choom|chumba|чумба|ghost|fantasma|fantôme|призрак|Capri|Капри/i, ui);
  }
});

test('main-process notices name Stella', () => {
  const main = read('src/main/main.js');
  for (const text of ["'Capri — Personal memory'", 'Resume Capri before', 'Restart Capri to load', "'Capri — local only'", 'unmute Capri to preview', 'Bring Capri back']) {
    assert.ok(!main.includes(text), text);
  }
});

test('typed commands addressed to Stella reach the local parsers', () => {
  const { musicRequest } = require('../src/main/music-playback');
  const { actionIntent, launchTarget } = require('../src/main/action-agent');
  assert.deepEqual(musicRequest('Stella, play the song Around the World'), musicRequest('play the song Around the World'));
  assert.ok(musicRequest('Stella, play the song Around the World'));
  assert.equal(actionIntent('Stella, open notepad'), actionIntent('Capri, open notepad'));
  assert.equal(actionIntent('Stella, open notepad'), true);
  assert.deepEqual(launchTarget('hey Stella open notepad'), launchTarget('hey Capri open notepad'));
});

test('no name-stripping regex knows only the old name', () => {
  for (const file of fs.readdirSync(path.join(__dirname, '../src/main')).filter(f => f.endsWith('.js'))) {
    const source = read(`src/main/${file}`);
    for (const line of source.split('\n')) {
      if (/(^|[^\w])capri(?=[,\[\(\!:.?)\s])/i.test(line.replace(/capri_\w+|capri:\/\/|'capri'|caprigpt|CapriGPT/gi, '')) && !/stella/i.test(line) && /\/\^/.test(line))
        assert.fail(`${file}: ${line.trim().slice(0, 120)}`);
    }
  }
});

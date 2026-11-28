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
  assert.doesNotMatch(read('src/renderer/js/chat.js'), /digital ghost/);
  assert.doesNotMatch(read('src/renderer/js/panel.js'), /STELLA \/\/|PROJECT STELLACORN/);
});

test('Hey Stella wakes her; Hey Stella still works quietly', () => {
  assert.deepEqual(wakePhrase('Hey Stella, open music'), { text: 'open music' });
  assert.deepEqual(wakePhrase('hey stella'), { text: '' });
  assert.deepEqual(wakePhrase('Hey Stella what time'), { text: 'what time' });
  assert.equal(wakePhrase('I told Stella hi'), null);
  assert.deepEqual(wakePhrase('Hey Stela, lights'), { text: 'lights' }, 'a common one-l transcription');
});

test('indicators say Hey Stella', () => {
  const wake = read('src/renderer/js/wake-listener.js'), voice = read('src/renderer/js/voice-call.js');
  assert.match(wake, /Hey Stella/);
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
    assert.doesNotMatch(ui, /choom|chumba|чумба|ghost|fantasma|fantôme|призрак/i, ui);
  }
});

test('no Capri left anywhere in the repo (old versions live in git history)', () => {
  const { execSync } = require('node:child_process');
  const allowed = new Set(['LICENSE', 'src/main/profile-migration.js', 'tests/profile-migration.test.js', 'src/main/main.js', 'tests/stella-name.test.js',
    'README.md', 'README.fr.md', 'docs/ROADMAP.md', 'docs/START-HERE.md', 'docs/VALIDATION.md', 'docs/DEVELOPMENT.md']);
  const hits = execSync('git grep -Ili -e capri -e Капри', { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).split('\n')
    .filter(f => f && !allowed.has(f) && !f.startsWith('docs/superpowers/'));
  assert.deepEqual(hits, []);
});

test('typed commands addressed to Stella reach the local parsers', () => {
  const { musicRequest } = require('../src/main/music-playback');
  const { actionIntent, launchTarget } = require('../src/main/action-agent');
  assert.deepEqual(musicRequest('Stella, play the song Around the World'), musicRequest('play the song Around the World'));
  assert.ok(musicRequest('Stella, play the song Around the World'));
  assert.equal(actionIntent('Stella, open notepad'), actionIntent('Stella, open notepad'));
  assert.equal(actionIntent('Stella, open notepad'), true);
  assert.deepEqual(launchTarget('hey Stella open notepad'), launchTarget('hey Stella open notepad'));
});

test('no name-stripping regex knows only the old name', () => {
  for (const file of fs.readdirSync(path.join(__dirname, '../src/main')).filter(f => f.endsWith('.js'))) {
    const source = read(`src/main/${file}`);
    for (const line of source.split('\n')) {
      if (/(^|[^\w])stella(?=[,\[\(\!:.?)\s])/i.test(line.replace(/stella_\w+|stella:\/\/|'stella'|stella|Stella/gi, '')) && !/stella/i.test(line) && /\/\^/.test(line))
        assert.fail(`${file}: ${line.trim().slice(0, 120)}`);
    }
  }
});

test('tray, windows and the app build use Stella’s icon', () => {
  const ico = fs.readFileSync(path.join(__dirname, '../assets/icons/stella.ico'));
  assert.equal(ico.readUInt16LE(2), 1, 'an icon file'); assert.ok(ico.readUInt16LE(4) >= 6, 'several sizes');
  const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16] || 256);
  for (const size of [16, 24, 32, 48, 256]) assert.ok(sizes.includes(size), `${size}px`);
  const main = read('src/main/main.js');
  assert.match(main, /'assets', 'icons', 'stella\.ico'/, 'tray');
  assert.doesNotMatch(main + read('src/main/settings-window.js'), /tray\.png/);
  assert.equal(JSON.parse(read('package.json')).build.win.icon ?? JSON.parse(read('package.json')).build.icon, 'assets/icons/stella.ico');
});

test('nothing of the old character’s world is left (biochip, satellite, slang, the old corner mask…)', () => {
  const { execSync } = require('node:child_process');
  const root = path.join(__dirname, '..');
  const old = /\b(?:biochip|satellite|away-mask|night.city|personality construct|dozens of minds|red light|mane|in the show|gigs?|choom|preem|flatlined?|edgerunners?)\b|satélite|спутник|чумба|биочип/i;
  const files = execSync('git ls-files', { cwd: root, encoding: 'utf8' }).split('\n')
    .filter(f => f && !f.startsWith('docs/superpowers/') && f !== 'tests/stella-name.test.js' && /\.(js|cjs|mjs|json|md|html|css|txt)$/.test(f));
  const hits = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    text.split('\n').forEach((line, i) => { if (old.test(line) && !/doesNotMatch/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 120)}`); });
  }
  assert.deepEqual(hits, []);
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { EventEmitter } = require('node:events');
const { SpeechOutput, spokenText } = require('../src/main/tts');
const { wave } = require('../src/main/whisper-engine');

test('spoken text removes commands, code and link targets', () => {
  assert.equal(spokenText('**Hello** [[close: app]] ```js\nbad()``` [friend](https://example.com)'), 'Hello friend');
  assert.equal(spokenText('x'.repeat(2000)).length, 1500);
});

test('local synthesis returns WAV and cleans its private request directory', async () => {
  let requestFile;
  const out = new SpeechOutput({ root: process.cwd(), config: () => ({ttsEnabled:true,ttsEngine:'windows'}), allowed: () => true,
    launch: (_exe, args) => {
      requestFile = args.at(-1);
      const child = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => child.emit('close', 1);
      setImmediate(async () => {
        const request = JSON.parse(await fs.readFile(requestFile, 'utf8'));
        await fs.writeFile(request.output, wave(Buffer.alloc(32000)));
        child.emit('close', 0);
      });
      return child;
    } });
  const result = await out.speak({text:'Hi'});
  assert.equal(result.ok, true);
  assert.equal(Buffer.from(result.audio, 'base64').toString('ascii',0,4), 'RIFF');
  await assert.rejects(fs.access(requestFile));
});

test('interruption kills generation and suppresses stale audio', async () => {
  let ready, killed = false;
  const launched = new Promise(resolve => { ready = resolve; });
  const out = new SpeechOutput({ root: process.cwd(), config: () => ({ttsEnabled:true,ttsEngine:'windows'}), allowed: () => true,
    launch: () => {
      const child = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => { killed = true; child.emit('close', 1); };
      ready(); return child;
    } });
  const job = out.speak({text:'A long reply'});
  await launched; out.cancel();
  assert.equal((await job).error, 'cancelled'); assert.equal(killed, true);
});

test('muting and pause prevent the engine from starting', async () => {
  const out = new SpeechOutput({root:process.cwd(),config:()=>({ttsEnabled:true,muted:true}),allowed:()=>true,
    launch:()=>assert.fail('muted engine must not start')});
  assert.equal((await out.speak({text:'Hi'})).ok,false);
});

test('renderer discards a completed synthesis after stop', async () => {
  const source = await fs.readFile(require.resolve('../src/renderer/js/speech-output.js'), 'utf8');
  const { SpeechPlayer } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const old = {window:global.window,document:global.document,cancelAnimationFrame:global.cancelAnimationFrame};
  global.window = global.document = {addEventListener(){}};
  global.cancelAnimationFrame = () => {};
  try {
    let complete, ensure = 0;
    const player = new SpeechPlayer({host:{ttsCancel(){},ttsSpeak:()=>new Promise(resolve=>{complete=resolve;})},
      voice:{ensure(){ensure++;}}});
    player.configure({ttsEnabled:true});
    const pending = player.speak('Old answer'); player.stop();
    complete({ok:true,audio:'unused'}); await pending;
    assert.equal(ensure,0);
  } finally { Object.assign(global,old); }
});

test('proactive voice is opt-in and discards audio if availability changes during warmup', async () => {
  const source = await fs.readFile(require.resolve('../src/renderer/js/speech-output.js'), 'utf8');
  const { SpeechPlayer } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const old = { window: global.window, document: global.document, cancelAnimationFrame: global.cancelAnimationFrame };
  global.window = global.document = { addEventListener() {} };
  global.cancelAnimationFrame = () => {};
  try {
    let complete, available = true, decoded = 0;
    const player = new SpeechPlayer({
      host: { ttsCancel() {}, ttsSpeak: () => new Promise(resolve => { complete = resolve; }) },
      voice: { ensure: () => ({ resume: async () => {}, decodeAudioData: async () => { decoded++; return {}; } }) },
      onPlayback: playing => { assert.equal(playing, false); },
    });
    player.configure({ ttsEnabled: true });
    assert.equal(player.speakProactive('Hello', Date.now() + 1000, () => available), false);
    player.configure({ ttsEnabled: true, proactiveVoice: true });
    assert.equal(player.speakProactive('Hello', Date.now() - 1000, () => available), false);
    assert.equal(player.speakProactive('Welcome back', Date.now() + 1000, () => available), true);
    available = false;
    complete({ ok: true, audio: 'AQI=' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(decoded, 1);
    assert.equal(player.pending, null);
    assert.equal(player.sources.size, 0);
  } finally { Object.assign(global, old); }
});

test('a stopped PCM chunk cannot schedule audio after its asynchronous context check', async () => {
  const source = await fs.readFile(require.resolve('../src/renderer/js/speech-output.js'), 'utf8');
  const { SpeechPlayer } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const old = { window: global.window, document: global.document, cancelAnimationFrame: global.cancelAnimationFrame };
  global.window = global.document = {addEventListener() {}};
  global.cancelAnimationFrame = () => {};
  try {
    const player = new SpeechPlayer({host: {}, voice: {}});
    player.context = async () => {
      player.stop();
      return { createBuffer: () => assert.fail('Cancelled PCM must not reach the audio queue') };
    };
    await player.pcm({ sampleRate: 24000, audio: 'AQI=' }, player.epoch);
  } finally { Object.assign(global, old); }
});

test('a TTS grant speaks once while the overlay is hidden and never when muted', async () => {
  let launches = 0, cfg = { ttsEnabled: true, ttsEngine: 'windows' };
  const out = new SpeechOutput({ root: process.cwd(), config: () => cfg, allowed: () => false, grantAllowed: () => true,
    launch: (_exe, args) => {
      launches++;
      const child = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => child.emit('close', 1);
      setImmediate(async () => {
        const request = JSON.parse(await fs.readFile(args.at(-1), 'utf8'));
        await fs.writeFile(request.output, wave(Buffer.alloc(32000)));
        child.emit('close', 0);
      });
      return child;
    } });
  assert.equal((await out.speak({ text: 'Click Display' })).ok, false, 'hidden overlay without a grant stays silent');
  assert.equal((await out.speak({ text: 'Click Display', grant: 'forged-token' })).ok, false);
  const grant = out.grant('guide');
  assert.equal(typeof grant, 'string');
  assert.equal((await out.speak({ text: 'Click Display', grant })).ok, true);
  assert.equal((await out.speak({ text: 'Click Display', grant })).ok, false, 'a grant is single use');
  assert.equal(launches, 1);
  cfg = { ttsEnabled: true, ttsEngine: 'windows', muted: true };
  const muted = out.grant('reminder');
  assert.equal((await out.speak({ text: 'Stretch', grant: muted })).ok, false, 'a grant never overrides mute');
  cfg = { ttsEnabled: true, ttsEngine: 'windows' };
  assert.equal((await out.speak({ text: 'Stretch', grant: muted })).ok, false, 'a grant is consumed even when speech fails');
  cfg = { ttsEnabled: false, ttsEngine: 'windows' };
  assert.equal((await out.speak({ text: 'Stretch', grant: out.grant('guide') })).ok, false, 'a grant never overrides voice off');
  assert.equal(launches, 1);
  assert.throws(() => out.grant('chat'));
  let clock = 1000;
  const timed = new SpeechOutput({ root: process.cwd(), config: () => ({ ttsEnabled: true, ttsEngine: 'windows' }), allowed: () => false,
    grantAllowed: () => true, now: () => clock, launch: () => assert.fail('an expired grant must not start the engine') });
  const old = timed.grant('guide'); clock += 60001;
  assert.equal((await timed.speak({ text: 'Late', grant: old })).ok, false, 'grants expire after 60 s');
});

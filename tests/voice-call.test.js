'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { SpeechInput } = require('../src/main/speech');
const tick = () => new Promise(resolve => setImmediate(resolve));
const uri = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
async function controller(now) {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/js/voice-call.js'), 'utf8')
    .replace("import { MicrophoneCapture } from './microphone.js';", 'class MicrophoneCapture {}')
    .replace("import { speechDetector } from './speech-detector.js';", 'const speechDetector=()=>{};');
  global.window = global.document = { addEventListener() {} };
  const { VoiceCall } = await import(uri(source));
  const events = [], callbacks = {}, attributes = {};
  const indicator = { hidden: true, dataset: {}, style: {}, addEventListener() {}, setAttribute(k,v) { attributes[k]=v; }, getAttribute(k) { return attributes[k]; } };
  const history = { history: [], trimHistory() {} };
  const speaker = { stop() { events.push('stop-audio'); this.pending=null;this.source=null;this.response=null; },
    beginResponse() { events.push('begin-reply');this.response={}; }, updateResponse(text,done) { events.push({spoken:text,done}); } };
  const capture = { stream: {}, cancel() { events.push('cancel-mic'); }, start: async () => {} };
  const detector = { start: async () => {events.push('start-detector');}, pause: async () => {} };
  const host = { onSpeechState: fn => callbacks.speech=fn, onChatDelta: fn => callbacks.delta=fn,
    speechStart: async () => ({ok:true}), speechConversation: async () => ({ok:true}),
    speechCancel: ({id}) => events.push({cancel:id}), speechReset: ({id}) => events.push({reset:id}),
    speechAudio() {}, wakeEndSession() {events.push('end-session');}, chatStop: id=>events.push({stopTurn:id}),
    personalRoute: async () => ({handled:false}), chatSend: async () => ({ok:true,text:'I am here, sweetheart.'}) };
  const call = new VoiceCall({host,speaker,indicator,history,now,captureFactory:()=>capture,
    onThinking: on => events.push({ thinking: on }),
    detectorFactory: async config => { callbacks.detector=config;return detector; }});
  return {call,host,speaker,capture,detector,events,callbacks,indicator,history};
}

test('wake voice uses the same mic, submits only complete addressed speech and never needs a panel', async () => {
  const f=await controller();
  try {
    await f.call.start({id:'voice-call-01',capture:f.capture,text:'Can you',complete:false});
    assert.equal(f.call.active,true);assert.equal(f.indicator.hidden,false);
    assert.equal(f.events.some(e=>e==='cancel-mic'),false);
    f.callbacks.speech({id:'voice-call-01',type:'final',text:'help me?',complete:true});await tick();await tick();
    assert.deepEqual(f.history.history.map(m=>m.content),['Can you help me?','I am here, sweetheart.']);
    assert(f.events.some(e=>e.spoken==='I am here, sweetheart.'&&e.done));
  } finally { f.call.end(); }
});

test('unmuting during a voice turn enables its spoken confirmation', async () => {
  const f = await controller();
  f.speaker.enabled = false;
  f.host.chatSend = async () => {
    f.speaker.stop(); // The settings broadcast resets active synthesis.
    f.speaker.enabled = true;
    return { ok: true, text: 'I’m unmuted.' };
  };
  try {
    await f.call.start({ id: 'unmute-voice', capture: f.capture, text: 'You can talk again.', complete: true });
    await tick(); await tick();
    assert.equal(f.events.filter(event => event === 'begin-reply').length, 2);
    assert.ok(f.speaker.response);
    assert.ok(f.events.some(event => event.spoken === 'I’m unmuted.' && event.done));
  } finally { f.call.end(); }
});

test('processing starts after a complete utterance and gives way to speech before the reply is done', async () => {
  const f = await controller();
  let finish;
  f.host.chatSend = () => new Promise(resolve => { finish = resolve; });
  try {
    await f.call.start({ id: 'early-voice', capture: f.capture, text: 'Can you', complete: false });
    assert.equal(f.indicator.dataset.state, 'listening');
    f.callbacks.speech({ id: f.call.id, type: 'final', text: 'help me?', complete: true });
    assert.equal(f.indicator.dataset.state, 'thinking');
    assert.ok(f.events.some(event => event.thinking === true));
    await tick();
    f.callbacks.delta({ id: f.call.turn, text: 'Of course.' });
    assert.ok(f.events.some(event => event.spoken === 'Of course.' && !event.done));
    f.call.playback(true);
    assert.equal(f.indicator.dataset.state, 'speaking');
    assert.ok(f.events.some(event => event.thinking === false));
    f.call.playback(false);
    assert.equal(f.indicator.dataset.state, 'thinking');
    finish({ ok: true, text: 'Of course. What do you need?' });
    await tick();
    f.call.playback(false);
    assert.equal(f.indicator.dataset.state, 'listening');
  } finally { f.call.end(); }
});

test('speech onset cuts audio, cancels generation and rejects stale deltas/results before the next turn', async () => {
  const f=await controller();let finish;
  f.host.chatSend=()=>new Promise(resolve=>{finish=resolve;});
  try {
    await f.call.start({id:'voice-call-02',capture:f.capture,text:'Hello',complete:true});await tick();
    const turn=f.call.turn;f.speaker.source={};
    f.callbacks.detector.onStart();
    assert.equal(f.speaker.source,null);assert.equal(f.call.turn,null);
    assert(f.events.some(e=>e.stopTurn===turn));assert(f.events.some(e=>e.reset==='voice-call-02'));
    const before=f.events.filter(e=>e.spoken).length;
    f.callbacks.delta({id:turn,text:'Stale words'});finish({ok:true,text:'Stale answer'});await tick();
    assert.equal(f.events.filter(e=>e.spoken).length,before);assert.deepEqual(f.history.history,[]);
    f.host.chatSend=async()=>({ok:true,text:'Listening to the new request.'});
    f.callbacks.speech({id:'voice-call-02',type:'final',text:'Actually, something else.',complete:true});await tick();await tick();
    assert.equal(f.history.history[0].content,'Actually, something else.');
  } finally {f.call.end();}
});

test('manual voice does not show listening before the microphone and recognizer are ready', async () => {
  const f=await controller();f.capture.stream=null;f.capture.start=async()=>{f.capture.stream={};};
  try {
    const starting=f.call.start();await tick();
    assert.equal(f.call.phase,'starting');assert.equal(f.capture.stream,null);
    f.callbacks.speech({id:f.call.id,type:'ready'});await starting;
    assert.equal(f.call.phase,'listening');assert(f.capture.stream);
    assert(f.events.includes('start-detector'));
  }finally{f.call.end();}
});

test('spoken check-ins take one addressed-by-context reply without a wake phrase or echo', async () => {
  let now = 1000;
  const f = await controller(() => now), routed = [];
  const line = 'I sketched a bakery that moves when it rains.';
  f.capture.stream = null;
  f.capture.start = async () => { f.capture.stream = {}; };
  f.speaker.speakProactive = () => {
    f.speaker.source = {}; f.call.playback(true); return true;
  };
  f.host.personalRoute = async (text, _id, _history, _commandsOnly, replyTo) => {
    routed.push({ text, replyTo });
    return { handled: true, text: 'I’ll set that idea aside for a day.' };
  };
  const final = text => f.callbacks.speech({ id: f.call.id, type: 'final', text, complete: true });
  try {
    const starting = f.call.startCheckIn({ text: line, deadline: Date.now() + 1000, available: () => true, replyTo: 'draft-ref' });
    await tick();
    final('Unrelated speech');
    f.callbacks.speech({ id: f.call.id, type: 'ready' });
    assert.equal(await starting, true);
    final('More background speech');
    f.callbacks.detector.onStart();
    assert.equal(f.speaker.source, null);
    final(line);
    await tick();
    assert.deepEqual(routed, []);
    f.callbacks.detector.onEnd();
    f.callbacks.detector.onStart();
    final('Not now.');
    await tick();
    assert.deepEqual(routed, [{ text: 'Not now.', replyTo: 'draft-ref' }]);
    assert(f.events.some(event => event.spoken === 'I’ll set that idea aside for a day.'));
    f.call.playback(false);
    now += 200;
    f.callbacks.detector.onStart();
    final('Thanks.');
    await tick();
    assert.deepEqual(routed.at(-1), { text: 'Thanks.', replyTo: undefined });
  } finally { f.call.end(); }
});

test('unavailable check-in microphone falls back to one-way audio', async () => {
  const f = await controller();
  f.host.speechStart = async () => ({ ok: false, error: 'speech-paused' });
  let played = 0;
  f.speaker.speakProactive = () => { played++; return true; };
  assert.equal(await f.call.startCheckIn({
    text: 'Welcome back.', deadline: Date.now() + 1000, available: () => true,
  }), true);
  assert.equal(f.call.active, false);
  assert.equal(played, 1);
});

test('speaker bleed resumes the same greeting while real speech can interrupt it', async () => {
  let now = 1000;
  const f = await controller(() => now);
  const line = 'Hi, sweetheart. How are you?';
  let holds = 0, releases = 0;
  f.capture.stream = null;
  f.capture.start = async () => { f.capture.stream = {}; };
  f.speaker.speakProactive = () => { f.speaker.source = {}; f.call.playback(true); return true; };
  f.speaker.holdForInput = async () => { holds++; return true; };
  f.speaker.releaseInputHold = () => { releases++; };
  try {
    const opening = f.call.startCheckIn({ text: line, deadline: Date.now() + 2000, available: () => true });
    await tick();
    f.callbacks.speech({ id: f.call.id, type: 'ready' });
    await opening;
    const audio = f.speaker.source;
    f.callbacks.detector.onStart();
    await tick();
    for (let i = 0; i < 4; i++) f.callbacks.detector.onFrame({ isSpeech: 0.99 });
    now += 170;
    f.callbacks.detector.onFrame({ isSpeech: 0.03 });
    f.call.finishProbe(false);
    assert.equal(f.speaker.source, audio, 'Suspected echo must not cancel the original greeting');
    assert.equal(releases, 1);
    f.callbacks.detector.onStart();
    assert.equal(holds, 1, 'A rejected echo must not repeatedly pause the same audio');
    f.callbacks.speech({ id: f.call.id, type: 'final', text: 'Night market.', complete: true });
    assert.deepEqual(f.history.history, []);

    f.call.playback(true);
    f.callbacks.detector.onStart();
    await tick();
    now += 170;
    for (let i = 0; i < 3; i++) f.callbacks.detector.onFrame({ isSpeech: 0.99 });
    assert.equal(f.speaker.source, null);
    f.callbacks.speech({ id: f.call.id, type: 'final', text: 'I’m good, how are you?', complete: true });
    await tick();
    assert.equal(f.history.history[0].content, 'I’m good, how are you?');
  } finally { f.call.end(); }
});

test('voice ignores echo transcripts until neural speech onset and can end by voice', async () => {
  const f=await controller();
  try {
    await f.call.start({id:'voice-call-03',capture:f.capture,text:'Hi',complete:true});await tick();await tick();
    const count=f.history.history.length;f.callbacks.speech({id:f.call.id,type:'final',text:'Echo of Capri',complete:true});await tick();
    assert.equal(f.history.history.length,count);
    f.callbacks.detector.onStart();f.callbacks.speech({id:f.call.id,type:'final',text:'Stop listening.',complete:true});
    assert.equal(f.call.active,false);assert.equal(f.indicator.hidden,true);
  } finally {f.call.end();}
});

test('a failed voice reply reports the problem by voice and keeps the session recoverable', async () => {
  const f=await controller();const errors=[];
  f.host.chatSend=async()=>({ok:false,error:'backend unavailable'});f.speaker.speak=async text=>errors.push(text);
  try {
    await f.call.start({id:'voice-error-05',capture:f.capture,text:'Hello',complete:true});await tick();await tick();
    assert.equal(f.call.active,true);assert.equal(errors.length,1);assert.match(errors[0],/try again/);
  }finally{f.call.end();}
});

test('a timing cue ends the voice exchange without another spoken reply', async () => {
  const f = await controller();
  f.host.personalRoute = async () => ({ handled: true, endVoice: true, text: 'I’ll give you some time.' });
  try {
    await f.call.start({id:'voice-quiet-check-in',capture:f.capture,text:'Give me a minute.',complete:true});
    await tick();
    assert.equal(f.call.active, false);
    assert.ok(f.events.includes('cancel-mic'));
    assert.ok(!f.events.includes('begin-reply'));
  } finally { f.call.end(); }
});

test('continuous main speech survives 90 seconds and interruption discards old recognition', async () => {
  const events=[],jobs=[];
  const input=new SpeechInput({allowed:()=>true,wakeAllowed:()=>false,notify:e=>events.push(e),
    engine:{start:async()=>{},stop(){},transcribe:()=>new Promise(resolve=>jobs.push(resolve))}});
  try {
    input.start({id:'voice-session-04',mode:'conversation'});await tick();const slot=input.current;
    for(let i=0;i<100;i++)input.audio({id:slot.id,samples:Buffer.alloc(32000)});
    assert.equal(slot.total,0);assert.equal(slot.timeout,undefined);
    input.enqueue(slot,Buffer.alloc(4000));input.resetUtterance(slot.id);jobs[0]('Old echo transcript');await tick();
    assert.equal(events.some(e=>e.type==='final'),false);
    input.enqueue(slot,Buffer.alloc(4000));jobs[1]('New request');await tick();
    assert.equal(events.at(-1).text,'New request');
  } finally {input.cancel(true);}
});

test('the recognizer keeps pre-roll but discards queued transcripts while playback is unconfirmed', async () => {
  const events = [], jobs = [];
  const input = new SpeechInput({allowed:()=>true,notify:event=>events.push(event),
    engine:{start:async()=>{},stop(){},transcribe:()=>new Promise(resolve=>jobs.push(resolve))}});
  try {
    input.start({id:'check-in-echo',mode:'conversation',checkIn:true});
    await tick();
    const slot = input.current;
    input.enqueue(slot, Buffer.alloc(4000));
    assert.equal(jobs.length, 0);
    input.resetUtterance(slot.id);
    input.enqueue(slot, Buffer.alloc(4000));
    input.resetUtterance(slot.id, false);
    jobs.shift()('How are you?');
    await tick();
    assert.equal(events.some(event => event.type === 'final'), false);
  } finally { input.cancel(true); }
});

test('typed chat follows its voice preference, including local pursuit feedback', async () => {
  const source=fs.readFileSync(path.join(__dirname,'../src/renderer/js/chat.js'),'utf8')
    .replace("import { pick, fmt } from './util.js';",'const pick=x=>x[0],fmt=x=>x;')
    .replace("import { welcomePicker } from './welcome.js';",'const welcomePicker=()=>()=>"Hi";');
  const {Chat}=await import(uri(source));let delta;
  const heard = [];
  const spoken={enabled:true,config:{speakTypedReplies:false},stop(){},
    beginResponse(){heard.push('begin');},updateResponse(text, done){heard.push({text, done});},speak(text){heard.push(text);}};
  const chat=new Chat({voice:{spoken,play(){}},capri:{pulse(){}},brain:{lang:'en',t:{chat:{}}},
    panel:{current:{chat:{mode:'text'}},setChatBusy(){},setActions(){},chatTurn(){},stream(){},setFace(){}},
    host:{onChatDelta:fn=>delta=fn,personalRoute:async text=>text === 'Not now.'
      ? {handled:true, pursuitFeedback:true, text:'I’ll set the draft aside.'} : {handled:false},
    chatSend:async({id})=>{delta({id,text:'Hello.'});return {ok:true,text:'Hello.'};}}});
  chat.open=true;chat.persona=()=>'';await chat.send('Hi');
  assert.deepEqual(heard, []);
  spoken.config.speakTypedReplies = true;
  await chat.send('Hi again');
  assert.deepEqual(heard, ['begin', {text:'Hello.',done:undefined}, {text:'Hello.',done:true}]);
  await chat.send('Not now.');
  assert.equal(heard.at(-1), 'I’ll set the draft aside.');
});

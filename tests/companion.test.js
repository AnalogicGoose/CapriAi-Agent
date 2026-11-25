'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '../src/renderer/js', name), 'utf8');
const uri = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const load = () => import(uri(source('companion.js')));
async function fixture({saved, random = () => 0} = {}) {
  const {Companion} = await load();
  let now = new Date(2026, 9, 30, 8).getTime();
  const acts = [], writes = [];
  const capri = {mode:'idle', stance:'stand', head:() => ({x:100,y:100}), towardCenter:()=>1,
    perform:(name)=>acts.push(name), wake(){this.mode='idle';this.dormant=false;}, setMode(mode){this.mode=mode;},
    async summon(cursor){this.summoned=cursor;}};
  const storage = {getItem:()=>saved || null, setItem:(key,value)=>writes.push(value)};
  const companion = new Companion({capri, host:{cursor:async()=>({inside:true,x:300,y:200})}, storage,
    clock:()=>new Date(now), random, reduced:()=>false});
  return {companion,capri,acts,writes,advance:ms=>now+=ms,setDate:date=>now=date.getTime()};
}

test('daily routine uses local phases, runs once per phase and survives a restart', async()=>{
  const {routineAt}=await load();
  for(const [h,phase] of [[0,'night'],[6,'morning'],[12,'afternoon'],[18,'evening'],[23,'night']])
    assert.equal(routineAt(new Date(2026,9,30,h)),phase);
  const f=await fixture();f.advance(60001);assert.equal(f.companion.tick(),true);
  assert.deepEqual(f.acts,['idleStretch']);f.companion.tick();assert.equal(f.acts.length,1);
  const restarted=await fixture({saved:f.writes.at(-1)});restarted.advance(60001);restarted.companion.tick();assert.equal(restarted.acts.length,0);
  f.setDate(new Date(2026,9,30,19));f.companion.tick();assert.equal(f.acts.at(-1),'idleBreathe');
  f.setDate(new Date(2026,9,31,8));f.companion.tick();assert.equal(f.acts.at(-1),'idleStretch');
});

test('surprises are rare, rate limited across restarts and never burst after blocked time',async()=>{
  const f=await fixture();f.companion.configure({dailyRoutine:false});
  f.advance(20*60000-1);f.companion.tick();assert.equal(f.acts.length,0);
  f.advance(1);f.companion.tick();assert.deepEqual(f.acts,['spin']);
  f.advance(29*60000);f.companion.tick();assert.equal(f.acts.length,1);
  f.advance(60000);f.companion.tick();assert.equal(f.acts.length,2);
  const failedRoll=await fixture({random:()=>0.99});failedRoll.companion.configure({dailyRoutine:false});
  failedRoll.advance(24*3600000);failedRoll.companion.tick();failedRoll.companion.tick();assert.equal(failedRoll.acts.length,0);
  const restart=await fixture({saved:f.writes.at(-1)});assert.ok(restart.companion.nextSurprise>=restart.companion.state.surprise+30*60000);
});

test('autonomous behavior respects every protected state, preferences and reduced motion',async()=>{
  for(const field of ['hidden','stowed','dormant','fullscreen','gaming','busy','dragging','chatThinking','pointing','sky','act','groundRest']) {
    const f=await fixture();f.capri[field]=true;f.advance(3600000);assert.equal(f.companion.tick(),false,field);assert.deepEqual(f.acts,[]);
  }
  for(const mode of ['work','alert','sleep']) {const f=await fixture();f.capri.mode=mode;f.advance(3600000);f.companion.tick();assert.equal(f.acts.length,0);}
  const f=await fixture();f.advance(3600000);f.companion.reduced=()=>true;f.companion.tick();assert.equal(f.acts.length,0);
  f.companion.reduced=()=>false;f.companion.configure({dailyRoutine:false,surpriseAnimations:false});f.companion.tick();assert.equal(f.acts.length,0);
});

test('mood evolves gently, is bounded, persists and neutralizes when disabled',async()=>{
  const f=await fixture({saved:'{"energy":99,"warmth":-4,"updated":"bad"}'});
  assert.equal(f.companion.state.energy,1);assert.equal(f.companion.state.warmth,0);
  for(let i=0;i<15;i++)f.companion.interact();assert.equal(f.companion.mood,'playful');
  assert.ok(f.companion.state.warmth<=1);assert.ok(f.writes.length);
  f.capri.mode='work';assert.equal(f.companion.mood,'focused');f.capri.mode='idle';
  f.setDate(new Date(2026,9,31,1));f.companion.evolve();assert.equal(f.companion.mood,'sleepy');
  f.companion.configure({personality:false});assert.equal(f.companion.mood,'calm');
  f.companion.storage={setItem(){throw Error('unavailable');}};assert.doesNotThrow(()=>f.companion.save());
});

test('pointer dwell and foreground reactions have cooldowns, use geometry only and respect settings',async()=>{
  const f=await fixture();assert.equal(f.companion.pointer(100,100),false);f.advance(1200);
  assert.equal(f.companion.pointer(100,100),true);f.companion.pointer(100,100);assert.equal(f.acts.length,1);
  f.advance(30000);f.companion.pointer(1000,1000);assert.equal(f.companion.pointer(100,100),false);
  f.companion.desktop({fg:1});f.advance(60000);f.companion.desktop({fg:2});assert.equal(f.acts.at(-1),'idleListen');
  const count=f.acts.length;f.companion.desktop({fg:3});assert.equal(f.acts.length,count);
  f.companion.configure({cursorInteractions:false});f.advance(60000);f.companion.pointer(100,100);f.companion.desktop({fg:4});assert.equal(f.acts.length,count);
});

test('action requests execute locally, respect pause, recover wake and recheck asynchronous cursor results',async()=>{
  const f=await fixture();await f.companion.request('dance');assert.deepEqual(f.acts,['idleBounce']);
  await f.companion.request('nap');assert.equal(f.capri.mode,'sleep');await f.companion.request('wake');assert.equal(f.capri.mode,'idle');
  f.capri.gaming=true;assert.match(await f.companion.request('wave'),/finish/);assert.equal(f.acts.length,1);f.capri.gaming=false;
  f.companion.host.cursor=async()=>{f.capri.gaming=true;return {inside:true,x:1,y:1};};
  await f.companion.request('come');assert.equal(f.capri.summoned,undefined);
  f.capri.gaming=false;f.companion.reduced=()=>true;await f.companion.request('dance');assert.equal(f.acts.length,1);
  f.capri.dormant=true;await f.companion.request('wake');assert.equal(f.capri.dormant,false);
});

test('typed and reviewed voice transcripts share strict local command routing',async()=>{
  const {companionRequest,Chat}=await import(uri(source('chat.js').replace("import { welcomePicker } from './welcome.js';", "const welcomePicker=()=>()=>'Hey. What is on your mind?';").replace("import { pick, fmt } from './util.js';",'const pick=x=>x[0],fmt=x=>x;')));
  for(const [text,action] of [['Capri, could you wave please?','wave'],['baila','dance'],['estírate','stretch'],['take a nap','nap'],['wake up','wake'],['ven aquí','come'],['how are you feeling?','mood'],['/actions','help']])assert.equal(companionRequest(text),action);
  for(const text of ['do not dance','what if I say wave?','tell me how to dance','make Firefox dance','"wave"','wave and close Firefox'])assert.equal(companionRequest(text),null,text);
  let routed=0,executed=0,reply,busy;
  const chat=new Chat({capri:{companion:{async request(action){executed++;assert.equal(action,'wave');return 'Hi!';}}},
    panel:{setChatBusy:value=>busy=value,chatTurn(){},stream:text=>reply=text},brain:{},voice:{},
    host:{onChatDelta(){},personalRoute(){routed++;throw Error('Gesture must not need a model');}}});
  chat.open=true;await chat.send('wave');assert.equal(executed,1);assert.equal(routed,0);assert.equal(reply,'Hi!');assert.equal(busy,false);assert.equal(chat.turn,0);
});

test('all companion toggles cross the settings boundary as booleans only',()=>{
  const {settingsPatch}=require('../src/main/settings-policy');
  for(const key of ['idleAnimations','cursorInteractions','personality','dailyRoutine','surpriseAnimations']) {
    assert.deepEqual(settingsPatch({[key]:false}),{[key]:false});assert.throws(()=>settingsPatch({[key]:'false'}));
  }
});

test('Stella floats: she is available, and a local "come here" goes to her body (not refused)',async()=>{
  const f=await fixture();f.capri.stance='float';
  assert.equal(f.companion.available(),true,'float counts as available');
  f.advance(60001);assert.equal(f.companion.tick(),true,'daily routine gestures run (Stella maps them to a breath)');
  const calls=[];f.capri.bodyAction=async(action,options)=>{calls.push([action,options]);return 'done';};
  assert.equal(await f.companion.request('come'),'Here I am.');
  assert.deepEqual(calls,[['come',{cursor:{inside:true,x:300,y:200}}]]);
  assert.equal(f.capri.summoned,undefined,'not the old summon path');
  f.capri.bodyAction=async()=>'I’m tucked away right now — bring me back first.';
  assert.match(await f.companion.request('come'),/tucked away/,'her honest reply passes through');
  const old=await fixture();old.capri.stance='float';delete old.capri.bodyAction;
  assert.equal(await old.companion.request('come'),'Here I am.');assert.ok(old.capri.summoned,'summon without a body action');
  assert.equal(f.companion.reply('wave'),'Hi! A little wave for you.');assert.equal(f.companion.reply('come'),null);
});

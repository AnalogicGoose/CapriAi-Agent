'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=name=>fs.readFileSync(path.join(__dirname,'../src/renderer/js',name),'utf8');
const uri=text=>`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const motion={matches:false};
global.matchMedia=()=>motion;
test('direct posture requests support English and Spanish and reject negation, examples and other targets',async()=>{
  const chat=await import(uri(source('chat.js').replace("import { welcomePicker } from './welcome.js';", "const welcomePicker=()=>()=>'Hey. What is on your mind?';").replace("import { pick, fmt } from './util.js';",'const pick=x=>x[0],fmt=x=>x;')));
  for(const text of ['sit','sit down','Stella, could you sit down please?','take a seat','siéntate','sentate un rato'])assert.equal(chat.postureRequest(text),true,text);
  for(const text of ['stand up','get up','please stand','Stella, levántate','ponete de pie'])assert.equal(chat.postureRequest(text),false,text);
  for(const text of ['do not sit down','can you sit? I am just asking','tell me how to sit','make Firefox sit down','what if I say sit down?'])assert.equal(chat.postureRequest(text),null,text);
});

test('chat applies posture locally and releases busy state even when a move fails',async()=>{
  const {Chat}=await import(uri(source('chat.js').replace("import { welcomePicker } from './welcome.js';", "const welcomePicker=()=>()=>'Hey. What is on your mind?';").replace("import { pick, fmt } from './util.js';",'const pick=x=>x[0],fmt=x=>x;')));
  const poses=[],replies=[],busy=[];
  const chat=new Chat({stella:{requestPosture:async sit=>{poses.push(sit);return 'Taking a little seat.';}},
    panel:{setChatBusy:on=>busy.push(on),chatTurn(){},stream:text=>replies.push(text)},
    voice:{},brain:{lang:'en',t:{chat:{}}},host:{onChatDelta(){},personalRoute(){throw Error('Must not call the AI route');}}});
  chat.open=true;await chat.send('sit down');assert.deepEqual(poses,[true]);assert.equal(chat.turn,0);assert.deepEqual(busy,[true,false]);
  chat.stella.requestPosture=async()=>{throw Error('interrupted');};
  await chat.send('stand up');assert.equal(chat.turn,0);assert.match(replies.at(-1),/didn’t finish/);
});



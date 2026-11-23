'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAgentBrowser}=require('../src/main/agent-browser');
const {DesktopTools,launchBrowser}=require('../src/main/desktop-tools');
const {EventEmitter}=require('node:events');

test('external browser adapter uses the system launcher for pages and videos without claiming playback',async()=>{
  const urls=[];
  const desktop=new DesktopTools({preferredBrowser:()=> 'system',openExternal:async url=>urls.push(url)});
  const browser=createAgentBrowser({openUrl:(...args)=>desktop.openUrl(...args)});
  const result=await browser.open('https://music.youtube.com/');
  assert.equal(result.type,'website');assert.equal(result.launchRequested,true);
  const video=await browser.play({videoId:'abcdefghijk',title:'A video',channel:'Creator'});
  assert.equal(video.playing,false);assert.equal(video.title,'A video');
  assert.match(video.note,/playback have not been verified/);
  assert.deepEqual(urls,['https://music.youtube.com/','https://www.youtube.com/watch?v=abcdefghijk&autoplay=1']);
  browser.stop();assert.equal(urls.length,2);
});

test('invalid URLs/videos and cancelled requests never reach the external browser',async()=>{
  const browser=createAgentBrowser({openUrl:()=>assert.fail('must not launch')});
  await assert.rejects(browser.open('file:///C:/secret'));
  await assert.rejects(browser.play({videoId:'bad&arg=x'}),/Invalid/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(browser.open('https://example.com/',controller.signal));
  await assert.rejects(browser.play({videoId:'abcdefghijk'},controller.signal));
});

test('external launch errors propagate without an embedded-browser fallback',async()=>{
  const browser=createAgentBrowser({openUrl:async()=>{throw Error('Launch failed');}});
  await assert.rejects(browser.open('https://example.com/'),/Launch failed/);
  await assert.rejects(browser.play({videoId:'abcdefghijk'}),/Launch failed/);
});

test('Firefox dispatch requests a tab in the normal profile without a shell or private window',async()=>{
  const calls=[];
  const spawn=(...args)=>{calls.push(args);const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;};
  await launchBrowser('C:\\Apps\\firefox.exe','https://music.youtube.com/',spawn);
  assert.deepEqual(calls,[['C:\\Apps\\firefox.exe',['-new-tab','https://music.youtube.com/'],{shell:false,windowsHide:true,detached:true,stdio:'ignore'}]]);
  await launchBrowser('C:\\Apps\\chrome.exe','https://example.com/',spawn);
  assert.deepEqual(calls[1][1],['https://example.com/']);
});

test('Capri prefers Firefox over the Windows default, honors explicit choices and never silently falls back',async()=>{
  const calls=[];
  const desktop=new DesktopTools({openExternal:async url=>calls.push(['system',url]),
    executables:()=>[{label:'Firefox',file:'C:\\Apps\\firefox.exe'},{label:'Google Chrome',file:'C:\\Apps\\chrome.exe'}],
    launch:async(...args)=>calls.push(args)});
  assert.equal((await desktop.openUrl('https://example.com/')).browser,'Firefox');
  await desktop.openUrl('https://example.com/','Google Chrome');
  await desktop.openUrl('https://example.com/','system');
  assert.deepEqual(calls,[['C:\\Apps\\firefox.exe','https://example.com/'],['C:\\Apps\\chrome.exe','https://example.com/'],['system','https://example.com/']]);
  desktop.executables=()=>[];
  await assert.rejects(desktop.openUrl('https://example.com/'),/verified browser executable/);
  assert.equal(calls.length,3);
});

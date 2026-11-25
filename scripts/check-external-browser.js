'use strict';
// Isolated Electron execution with browser dispatch intercepted; no live tabs.
const {app,BrowserWindow,shell}=require('electron');
const assert=require('node:assert/strict');
const {DesktopTools}=require('../src/main/desktop-tools');
const {createAgentBrowser}=require('../src/main/agent-browser');
const {ActionAgent}=require('../src/main/action-agent');
const {CodexTools}=require('../src/main/codex-tools');
app.whenReady().then(async()=>{
  const original=shell.openExternal,urls=[];
  shell.openExternal=async url=>{urls.push(url);};
  try {
    const desktop=new DesktopTools({openExternal:url=>shell.openExternal(url),executables:()=>[{label:'Firefox',file:'C:\\Apps\\firefox.exe'}],launch:async(file,url)=>{assert.equal(file,'C:\\Apps\\firefox.exe');urls.push(url);}});
    const browser=createAgentBrowser({openUrl:(...args)=>desktop.openUrl(...args)});
    const item={videoId:'abcdefghijk',title:'Observed video',channel:'Creator',url:'https://www.youtube.com/watch?v=abcdefghijk'};
    const actions=new ActionAgent({settings:()=>({}),desktop,browser,web:{youtube:async()=>({type:'youtube',items:[item]})}});
    const tools=new CodexTools({actions,settings:()=>({})});
    const signal=new AbortController().signal;
    const run=(tool,query='',text='play and open the observed video')=>tools.run('stella_desktop_step',{tool,query,index:0,browser:''},{text,signal,check(){}});
    const lookup=await run('youtube_latest','creator');
    assert.equal(lookup.completed,true,lookup.text);
    const playback=await run('play_video');
    assert.equal(playback.completed,true,playback.text);
    assert.equal(playback.observations.at(-1).playing,false);
    assert.match(playback.text,/playback have not been verified/);
    const source=await run('open_result');
    assert.equal(source.completed,true,source.text);assert.equal(source.observations[0].type,'website');
    await actions.openResult(lookup.links[0].ref);
    const music=await run('open_media','music','play music');
    assert.equal(music.completed,true,music.text);
    const anime=await run('open_media','anime',"let's watch anime");
    assert.equal(anime.completed,true,anime.text);assert.equal(anime.observations[0].preferredProfile,'Gabriel');assert.equal(anime.observations[0].profileSelectionVerified,false);
    assert.deepEqual(urls,[item.url+'&autoplay=1',item.url,item.url,'https://music.youtube.com/','https://www.crunchyroll.com/']);
    actions.cancel();assert.equal(BrowserWindow.getAllWindows().length,0);
    console.log('PASS: Electron/Codex tool bridge dispatches video, search result, source button and YouTube Music to Firefox by default (including Crunchyroll/Gabriel); no embedded window or false playback claim. Dispatch intercepted; live browser behavior unverified.');
  } finally {shell.openExternal=original;}
  app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});

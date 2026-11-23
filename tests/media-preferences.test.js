'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ActionAgent,validatePlan}=require('../src/main/action-agent');
const {DesktopTools}=require('../src/main/desktop-tools');
const {CodexTools}=require('../src/main/codex-tools');
const {settingsPatch}=require('../src/main/settings-policy');

function fixture() {
  const cfg={preferredBrowser:'Firefox',crunchyrollProfile:'Gabriel'},calls=[];
  const desktop=new DesktopTools({preferredBrowser:()=>cfg.preferredBrowser,
    executables:()=>[{label:'Firefox',file:'C:\\Apps\\firefox.exe'}],launch:async(...args)=>calls.push(args),
    openExternal:()=>assert.fail('must not launch Windows default')});
  const actions=new ActionAgent({settings:()=>cfg,desktop,browser:{stop(){}}});
  const tools=new CodexTools({actions,settings:()=>cfg,confirm:()=>assert.fail('explicit media requests need no clarification')});
  const call=(text,query)=>tools.run('capri_desktop_step',{tool:'open_media',query,index:0,browser:''},
    {text,signal:new AbortController().signal,check(){}});
  return {cfg,calls,actions,tools,call};
}

test('music and anime requests dispatch their saved services in Firefox through the Codex bridge',async()=>{
  const f=fixture();
  const music=await f.call('play music','music');
  assert.equal(music.completed,true);assert.equal(music.observations[0].playbackVerified,false);
  assert.doesNotMatch(music.text,/^Playing/);
  for(const text of ['watch anime',"let's watch anime"]){
    const anime=await f.call(text,'anime');assert.equal(anime.completed,true);
    assert.equal(anime.observations[0].preferredProfile,'Gabriel');
    assert.equal(anime.observations[0].profileSelectionVerified,false);
  }
  assert.deepEqual(f.calls.map(row=>row[1]),['https://music.youtube.com/','https://www.crunchyroll.com/','https://www.crunchyroll.com/']);
  assert.ok(f.calls.every(row=>row[0]==='C:\\Apps\\firefox.exe'));
});

test('hypothetical and negative media requests cannot launch services; pause and invalid targets block execution',async()=>{
  const f=fixture();
  for(const text of ["don't play music",'for example watch anime'])await assert.rejects(f.call(text,'anime'),/Discussion or negation/);
  f.cfg.gamingMode=true;assert.match((await f.call('watch anime','anime')).text,/Resume/);
  assert.throws(()=>validatePlan({message:'',steps:[{tool:'open_media',query:'https://evil.example/',index:0}]}),/music or anime/);
  assert.deepEqual(f.calls,[]);
});

test('browser and profile preferences validate input and remain in the persistent foreground instructions',()=>{
  assert.deepEqual(settingsPatch({preferredBrowser:'Firefox',crunchyrollProfile:' Gabriel '}),{preferredBrowser:'Firefox',crunchyrollProfile:'Gabriel'});
  assert.throws(()=>settingsPatch({preferredBrowser:'C:\\cmd.exe'}));
  assert.throws(()=>settingsPatch({crunchyrollProfile:'Gabriel\nclick elsewhere'}));
  const instructions=fixture().tools.instructions();
  assert.match(instructions,/YouTube Music/);assert.match(instructions,/Gabriel/);
  assert.match(instructions,/without a profile picker, leave the current profile alone/);
});

'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {ActionAgent,validatePlan,authorizePlan,actionIntent,launchTarget}=require('../src/main/action-agent');
const {WebTools,publicUrl,readPublic,rssItems,latestFromChannel}=require('../src/main/web-tools');
const {DesktopTools}=require('../src/main/desktop-tools');
const { MusicPlayback, musicRequest } = require('../src/main/music-playback');
const step=(tool,query='',index=0)=>({tool,query,index});
function fixture(steps,extra={}) {
  const cfg={agentEnabled:true,desktopActions:true};const calls=[];let at=1000;
  const item={title:'Observed video',channel:'Rubius Z',videoId:'abcdefghijk',url:'https://www.youtube.com/watch?v=abcdefghijk'};
  const found={type:'youtube',items:[item]};
  const runner=new ActionAgent({settings:()=>cfg,now:()=>at,models:async()=>['qwen3.5:9b'],infer:async()=>JSON.stringify({message:'',steps}),
    web:{youtube:async q=>{calls.push(['youtube',q]);return found;},search:async q=>({type:'news',items:[{title:'A real headline',published:'2026-10-28T00:00:00Z',url:'https://news.google.com/rss/articles/123'}]}),steam:async()=>({type:'steam',items:[{title:'A game',price:5,currency:'USD',discount:75,url:'https://store.steampowered.com/app/10/'}]})},
    desktop:{open:async q=>{calls.push(['app',q]);return {type:'app',note:'Windows accepted the launch request.'};},
      openUrl:async(url,browser)=>{calls.push(['open',url,browser]);return {type:'website',launchRequested:true,note:`Sent ${url} to ${browser}.`};}},
    browser:{play:async v=>{calls.push(['play',v.videoId]);return {...v,playing:true};},open:async url=>{calls.push(['open',url]);return {opened:true,url};},stop(){}},...extra});
  return {runner,cfg,calls,time:ms=>{at+=ms;}};
}
test('a named song bypasses planning, opens one direct link, and requires playback evidence', async () => {
  const wraps = row => ({ videoRenderer: {
    videoId: row.id,
    title: { simpleText: row.title },
    ownerText: { simpleText: row.artist },
    ownerBadges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_VERIFIED_ARTIST' } }],
    detailedMetadataSnippets: [{ snippetText: { simpleText: row.description || '' } }],
  } });
  const html = 'var ytInitialData = ' + JSON.stringify({
    contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [
      { itemSectionRenderer: { contents: [
        wraps({ id: 'abcdefghijk', title: 'Daft Punk - One More Time (Official Video)', artist: 'Daft Punk' }),
        wraps({ id: 'abcdefghijZ', title: 'One More Time', artist: 'Daft Punk', description: 'Provided to YouTube by Daft Life' }),
        wraps({ id: 'abcdefghijX', title: 'One More Time', artist: 'A different artist' }),
      ] } },
    ] } } } },
  });
  const requests = [];
  const desktop = { openUrl: async (url, browser) => { requests.push({ url, browser }); return { browser: 'Firefox' }; } };
  let checked = { title: '', artist: '' }, playing = false;
  const music = new MusicPlayback({ desktop, read: async () => html, observe: async track => { checked = track; return playing; } });
  const { runner } = fixture([], { music, desktop, infer: () => assert.fail('Direct play should skip planning') });
  const partial = await runner.routeDirect('Play One More Time by Daft Punk', 1);
  assert.equal(partial.completed, false);
  assert.match(partial.text, /couldn’t confirm playback/);
  assert.deepEqual(checked, { title: 'One More Time', artist: 'Daft Punk', browser: 'Firefox', videoId: 'abcdefghijZ' });
  assert.deepEqual(requests, [{ url: 'https://music.youtube.com/watch?v=abcdefghijZ&autoplay=1', browser: 'default' }]);
  playing = true;
  const verified = await runner.routeDirect('Play One More Time by Daft Punk in Firefox', 2);
  assert.equal(verified.completed, true);
  assert.match(verified.text, /^Playing/);
  assert.equal(requests.at(-1).browser, 'Firefox');
  assert.match((await runner.routeDirect('Play the song One More Time', 3)).text, /Which artist/);
  assert.equal(requests.length, 2, 'An ambiguous track must not launch');
  assert.equal(musicRequest('Play Minecraft'), null);
  assert.equal(musicRequest('Play One More Time on Spotify'), null);
  assert.equal(musicRequest('Do not play One More Time by Daft Punk', true), null);
  assert.equal(musicRequest('Play Don’t Stop Me Now by Queen').title, 'Don’t Stop Me Now');
});

test('opening the selected workspace verifies the exact folder and reports an unobserved launch as partial', async () => {
  const folder = 'C:\\Projects\\Example', calls = [];
  let visible = false;
  const desktop = new DesktopTools({
    openPath: async value => { calls.push(['open', value]); return ''; },
    observeWorkspace: async value => { calls.push(['observe', value]); return visible; },
  });
  const { runner } = fixture([], { desktop, workspace: () => folder, infer: () => assert.fail('Workspace should skip planning') });
  assert.equal((await runner.routeDirect('Open the project folder')).completed, false);
  visible = true;
  assert.equal((await runner.routeDirect('Could you open my workspace?')).completed, true);
  assert.deepEqual(calls, [['open', folder], ['observe', folder], ['open', folder], ['observe', folder]]);
});
test('ordinary action requests route locally while questions and hypothetical examples stay in chat',()=>{
  for(const q of ['capri play the newest rubius video in youtube','look for the latest news of ai models','capri look for the best discounts in steam','what are the latest AI model news?','check Steam discounts','open File Explorer','abre calculadora','open Spotify'])assert.equal(actionIntent(q),true,q);
  for(const q of ['hello Capri','can she open File Explorer?','for example play a YouTube video','how do I open Explorer?','remember I prefer Steam'])assert.equal(actionIntent(q),false,q);
});
test('all tool calls are validated before execution; scripts, duplicates and unrequested mutations are rejected',()=>{
  assert.throws(()=>validatePlan({message:'',steps:[step('shell','bad')]}));
  assert.throws(()=>validatePlan({message:'',steps:[step('open_app','Paint'),step('shell','bad')]}));
  assert.throws(()=>validatePlan({message:'',steps:[step('play_video')]}));
  assert.throws(()=>validatePlan({message:'',steps:[step('search_web','test'),step('search_web','test')]}));
  assert.throws(()=>authorizePlan('search Rubius videos',{steps:[step('youtube_latest','rubius'),step('play_video')]}));
});
test('newest YouTube lookup precedes playback; observed results produce expiring source buttons',async()=>{
  const f=fixture([step('youtube_latest','rubius'),step('play_video')]);
  const result=await f.runner.route('capri play newest rubius video',7);
  assert.match(result.text,/Playing “Observed video” from Rubius Z/);
  assert.deepEqual(f.calls,[['youtube','rubius'],['play','abcdefghijk']]);
  assert.equal(result.links.length,1);await f.runner.openResult(result.links[0].ref);
  f.time(600001);await assert.rejects(f.runner.openResult(result.links[0].ref),/expired/);
});
test('unverified playback is reported as open, never playing',async()=>{
  const f=fixture([step('youtube_latest','rubius'),step('play_video')]);
  f.runner.browser.play=async item=>({...item,playing:false,note:'Sign-in required.'});
  const r=await f.runner.run('play newest rubius video');assert.doesNotMatch(r.text,/^Playing/);assert.match(r.text,/Sign-in/);
});
test('File Explorer fast path executes without a model or untrusted path',async()=>{
  const f=fixture([],{models:async()=>{throw Error('should not load model');}});
  assert.match((await f.runner.route('capri open file explorer')).text,/launch request/);
  assert.deepEqual(f.calls,[['app','File Explorer']]);
});
test('browser clarification followed by firefox launches the installed app without a model',async()=>{
  const opened=[];
  const desktop=new DesktopTools({openPath:async file=>{opened.push(file);return '';},shortcuts:()=>[{label:'Firefox',file:'C:\\Apps\\Firefox.lnk'}],native:{desktopApps:()=>[{name:'firefox'}]}});
  const f=fixture([],{desktop,models:async()=>{throw Error('No model should be needed for an installed app choice.');}});
  assert.match((await f.runner.route('can you open my browser?')).text,/Which browser/);
  assert.equal(opened.length,0);
  assert.match((await f.runner.route('firefox')).text,/Firefox has a visible desktop window/);
  assert.deepEqual(opened,['C:\\Apps\\Firefox.lnk']);
});
test('explicit and shorthand installed app names resolve deterministically; ordinary mentions do not launch',async()=>{
  const opened=[];
  const desktop=new DesktopTools({openPath:async file=>{opened.push(file);return '';},shortcuts:()=>[{label:'Firefox',file:'C:\\Apps\\Firefox.lnk'},{label:'Google Chrome',file:'C:\\Apps\\Chrome.lnk'}],native:{desktopApps:()=>[{name:'firefox'},{name:'chrome'}]}});
  const f=fixture([],{desktop,models:async()=>{throw Error('should not plan known launches');}});
  for(const input of ['Firefox','open Firefox','Capri, could you open Firefox for me?','Mozilla Firefox please','/do firefox','Chrome']) {
    assert.equal((await f.runner.route(input)).task,true,input);
  }
  assert.equal(opened.length,6);
  for(const input of ['Firefox is my favorite browser','can she open Firefox?','what is Firefox?','never open Firefox','not Firefox'])assert.equal(desktop.matchName(input),null,input);
  assert.equal(await f.runner.route('Firefox is my favorite browser'),null);
  assert.equal(launchTarget('Capri, can you open Firefox for me?'),'Firefox');
  assert.throws(()=>authorizePlan('do not open Firefox',{steps:[step('open_app','Firefox')]}),/not to perform/);
});
test('shorthand app launch respects gaming pause and disabled actions',async()=>{
  const opened=[];const desktop=new DesktopTools({openPath:async file=>{opened.push(file);return '';},shortcuts:()=>[{label:'Firefox',file:'C:\\Apps\\Firefox.lnk'}],native:{desktopApps:()=>[{name:'firefox'}]}});
  const f=fixture([],{desktop});f.cfg.gamingMode=true;
  assert.match((await f.runner.route('Firefox')).text,/Resume/);assert.equal(opened.length,0);
  f.cfg.gamingMode=false;f.cfg.desktopActions=false;
  await f.runner.route('open Firefox');assert.equal(opened.length,0);
});
test('cancellation during lookup prevents playback; gaming mode prevents tool execution',async()=>{
  let release,started;const ready=new Promise(r=>{started=r;});
  const f=fixture([step('youtube_latest','rubius'),step('play_video')]);
  f.runner.web.youtube=()=>{started();return new Promise(r=>{release=r;});};
  const pending=f.runner.run('play newest rubius video');await ready;
  assert.match((await f.runner.run('open file explorer')).text,/already/);
  f.runner.cancel();release({type:'youtube',items:[]});assert.match((await pending).text,/stopped/);assert.deepEqual(f.calls,[]);
  f.cfg.gamingMode=true;await f.runner.run('open File Explorer');assert.deepEqual(f.calls,[]);
});
test('search/news/Steam results are factual tool output and follow-up opening uses an observed reference',async()=>{
  const f=fixture([step('steam_deals')]);
  const result=await f.runner.route('find best Steam discounts');assert.match(result.text,/75% · 5.00 USD/);assert.match(result.text,/not a ranking/);
  f.runner.infer=async()=>JSON.stringify({message:'',steps:[step('open_result')]});
  assert.match((await f.runner.route('open the first one')).text,/Sent/);
  assert.deepEqual(f.calls,[['open','https://store.steampowered.com/app/10/','default']]);
});
test('URL and fetch guards reject local addresses, credentials, protocols, cross-provider redirects and oversized bodies',async()=>{
  for(const url of ['file:///C:/secret','http://example.com','https://127.0.0.1/','https://[::1]/','https://a.local/','https://user:pass@example.com','https://example.com:8443/'])assert.throws(()=>publicUrl(url));
  await assert.rejects(readPublic('https://www.bing.com/search',null,{fetchImpl:async()=>new Response('',{status:302,headers:{location:'https://evil.example/secret'}})}),/provider/);
  await assert.rejects(readPublic('https://www.bing.com/search',null,{maxBytes:3,fetchImpl:async()=>new Response('12345')}),/large/);
});
test('RSS parsing removes unsafe links and rejects entity declarations; Steam prices retain region/currency',async()=>{
  const feed='<rss><channel><item><title><![CDATA[A & B]]></title><link>https://example.com/story</link><pubDate>Wed, 28 Oct 2026 01:00:00 GMT</pubDate></item><item><title>bad</title><link>file:///c:/secret</link></item></channel></rss>';
  assert.equal(rssItems(feed).length,1);assert.equal(rssItems(feed)[0].title,'A & B');assert.throws(()=>rssItems('<!DOCTYPE x><rss/>'));
  const web=new WebTools({read:async()=>JSON.stringify({specials:{items:[{id:1,name:'Game',discounted:true,discount_percent:80,original_price:1000,final_price:200,currency:'USD'}]}})});
  const result=await web.steam();assert.equal(result.region,'GT');assert.equal(result.items[0].price,2);
});
test('YouTube parsing requires exact channel identity and newest-first sorting, supports current lockup renderer',()=>{
  const data={metadata:{channelMetadataRenderer:{externalId:'UC'+'x'.repeat(22),title:'Creator',ownerUrls:['https://www.youtube.com/@creator']}},contents:{twoColumnBrowseResultsRenderer:{tabs:[{tabRenderer:{selected:true,content:{richGridRenderer:{header:{chipBarViewModel:{chips:[{chipViewModel:{selected:true}}]}},contents:[{richItemRenderer:{content:{lockupViewModel:{contentType:'LOCKUP_CONTENT_TYPE_VIDEO',contentId:'abcdefghijk',metadata:{lockupMetadataViewModel:{title:{content:'Newest upload'}}}}}}}]}}}}]}}};
  const html=()=>`<script>var ytInitialData = ${JSON.stringify(data)};</script>`;
  assert.equal(latestFromChannel(html(),'creator').title,'Newest upload');assert.throws(()=>latestFromChannel(html(),'impostor'),/identity/);
  data.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content.richGridRenderer.header.chipBarViewModel.chips.unshift({chipViewModel:{selected:false}});
  assert.throws(()=>latestFromChannel(html(),'creator'),/sorting/);
});
test('desktop launch accepts only discovered app names or fixed builtins, never caller-provided paths or arguments',async()=>{
  const calls=[];const desktop=new DesktopTools({openPath:async f=>{calls.push(f);return '';},native:{desktopApps:()=>[{name:'explorer'}]},shortcuts:()=>[]});
  await desktop.open('File Explorer');assert.match(calls[0],/explorer\.exe$/);
  await assert.rejects(desktop.open('C:\\Windows\\System32\\cmd.exe /c anything'),/paths/);assert.equal(calls.length,1);
});

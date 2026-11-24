'use strict';
const {WhisperEngine}=require('./whisper-engine');
const {SpeechSegmenter}=require('./speech-segmenter');
const {wakePhrase}=require('./wake-phrase');
const {commandPhrase}=require('./command-phrases');
const CHECK_IN_LIMIT_MS=40_000;
class SpeechInput {
  constructor({allowed,notify,engine,runtimeDir,wakeAllowed=()=>false,commandsAllowed=()=>false}){
    Object.assign(this,{allowed,notify,wakeAllowed,commandsAllowed});this.engine=engine||new WhisperEngine({runtimeDir});this.current=null;
  }
  start(request={}){
    if(!request||typeof request.id!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(request.id))return {ok:false,error:'invalid-request'};
    const mode=['wake','conversation','commands'].includes(request.mode)?request.mode:'dictation';
    if(!this.permitted({mode}))return {ok:false,error:'speech-paused'};
    if(this.current)return {ok:false,error:'speech-busy'};
    const checkIn=mode==='conversation'&&request.checkIn===true;
    const slot={id:request.id,mode,checkIn,inputBlocked:checkIn,
      phase:'starting',queue:[],running:false,total:0,revision:0,recent:[],abort:new AbortController()};
    this.current=slot;slot.segmenter=new SpeechSegmenter((pcm,meta)=>this.enqueue(slot,pcm,meta),{maxSamples:mode==='wake'||mode==='commands'?5*16000:20*16000});
    if(slot.checkIn)slot.timeout=setTimeout(()=>{if(this.current===slot)this.cancel();},CHECK_IN_LIMIT_MS);
    this.engine.start(progress=>this.emit(slot,{type:'setup',percent:progress.percent})).then(()=>{
      if(this.current!==slot)return;
      if(!this.permitted(slot)){this.cancel();return;}
      slot.phase='listening';if(mode==='dictation')slot.timeout=setTimeout(()=>this.cancel(),95000);
      this.emit(slot,{type:'ready',mode,language:'auto',engine:'Whisper large-v3-turbo',device:this.engine.device});
    }).catch(error=>{
      if(this.current!==slot)return;
      this.emit(slot,{type:'error',text:error.message==='speech-download-failed'?'speech-download-failed':'speech-unavailable'});this.cancel();
    });
    return {ok:true,id:slot.id};
  }
  emit(slot,event){if(this.current===slot)this.notify({id:slot.id,...event});}
  // Commands-only listening has its own rule (a walkthrough or reminder window), which holds in fullscreen and Gaming mode.
  permitted(slot){return slot.mode==='commands'?this.commandsAllowed():slot.mode==='wake'||slot.wakeActivated?this.wakeAllowed():this.allowed();}
  audio({id,samples}={}){
    const slot=this.current;
    if(!slot||slot.id!==id||slot.phase!=='listening')return;
    if(!this.permitted(slot)){this.cancel();return;}
    if(!(samples instanceof ArrayBuffer)&&!ArrayBuffer.isView(samples))return;
    const pcm=Buffer.from(samples.buffer||samples,samples.byteOffset||0,samples.byteLength);
    if(!pcm.length||pcm.length>32000||pcm.length%2)return;
    if(slot.mode==='dictation'){slot.total+=pcm.length/2;if(slot.total>90*16000){this.stop(id);return;}}
    if(slot.mode==='conversation'){slot.recent.push(Buffer.from(pcm));while(slot.recent.reduce((n,b)=>n+b.length,0)>16000&&slot.recent.length>1)slot.recent.shift();}
    if(slot.inputBlocked)return;
    const rms=slot.segmenter.add(Buffer.from(pcm));this.emit(slot,{type:'level',level:Math.min(100,Math.round(rms*500))});
  }
  enqueue(slot,pcm,meta={complete:true}){
    if(this.current!==slot||slot.inputBlocked)return;
    if(slot.queue.length>=3){this.emit(slot,{type:'error',text:'speech-too-fast'});this.cancel();return;}
    slot.queue.push({pcm,...meta,revision:slot.revision});this.drain(slot);
  }
  async drain(slot){
    if(slot.running)return;slot.running=true;
    try{
      while(this.current===slot&&slot.queue.length){
        const {pcm,complete,revision}=slot.queue.shift();if(slot.mode!=='wake'&&slot.mode!=='commands')this.emit(slot,{type:'processing'});
        const text=await this.engine.transcribe(pcm,slot.abort.signal);
        if(this.current!==slot)return;
        if(revision!==slot.revision)continue;
        if(!this.permitted(slot)){this.cancel();return;}
        if(slot.mode==='wake'){
          const wake=wakePhrase(text);
          if(!wake)continue; // Ambient transcripts are discarded here, never sent to the renderer or Codex.
          slot.mode='dictation';slot.wakeActivated=true;slot.total=0;
          slot.segmenter.maxSamples=20*16000;
          slot.timeout=setTimeout(()=>this.cancel(),95000);
          this.emit(slot,{type:'wake',text:wake.text,complete});
        }else if(slot.mode==='commands'){
          const command=commandPhrase(text);
          if(!command)continue; // Same rule as wake: any other transcript is dropped here, never emitted or logged.
          this.emit(slot,{type:'command',...command});
        }else if(text)this.emit(slot,{type:'final',text:text.slice(0,slot.mode==='conversation'?1501:slot.wakeActivated?501:500),complete});
      }
    }catch{if(this.current===slot){this.emit(slot,{type:'error',text:'recognizer-failed'});this.cancel();}}
    finally{slot.running=false;if(this.current===slot&&slot.phase==='stopping'&&!slot.queue.length)this.finish(slot);}
  }
  conversation(id){
    const slot=this.current;
    if(!slot||slot.id!==id||!slot.wakeActivated||!this.permitted(slot))return {ok:false,error:'speech-unavailable'};
    slot.mode='conversation';slot.total=0;clearTimeout(slot.timeout);return {ok:true};
  }
  promoteCheckIn(id){
    const slot=this.current;
    if(!slot?.checkIn||slot.id!==id||!this.permitted(slot))return;
    clearTimeout(slot.timeout);slot.checkIn=false;
    this.emit(slot,{type:'check-in-promoted'});
  }
  resetUtterance(id,listening=true,preRollMs=500){
    const slot=this.current;if(!slot||slot.id!==id||slot.mode!=='conversation')return;
    slot.revision++;slot.queue=[];slot.inputBlocked=!listening;
    slot.segmenter=new SpeechSegmenter((pcm,meta)=>this.enqueue(slot,pcm,meta));
    if(listening&&preRollMs>0){
      const pcm=Buffer.concat(slot.recent);
      if(pcm.length)slot.segmenter.add(pcm.subarray(Math.max(0,pcm.length-Math.min(500,preRollMs)*32)));
    }
  }
  stop(id){
    const slot=this.current;if(!slot||slot.id!==id)return {ok:true};
    if(slot.phase==='starting'){this.cancel();return {ok:true};}
    if(slot.phase==='stopping')return {ok:true};
    slot.phase='stopping';clearTimeout(slot.timeout);slot.segmenter.flush();this.emit(slot,{type:'stopping'});
    if(!slot.running&&!slot.queue.length)this.finish(slot);return {ok:true};
  }
  finish(slot,cancelled=false){
    if(this.current!==slot)return;
    clearTimeout(slot.timeout);this.current=null;slot.queue=[];slot.segmenter.reset();
    if(!(this.wakeAllowed()||this.commandsAllowed())||slot.phase==='starting')this.engine.stop();
    this.notify({id:slot.id,type:'stopped',cancelled});
  }
  cancel(cold=false){const slot=this.current;if(!slot){this.engine.stop();return;}slot.abort.abort();this.finish(slot,true);if(cold)this.engine.stop();}
}
module.exports={SpeechInput};

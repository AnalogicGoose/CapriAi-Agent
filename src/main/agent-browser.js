'use strict';
const { publicUrl } = require('./web-tools');

// Use the user's normal browser/profile. Capri owns no web window or session.
function createAgentBrowser({openUrl}) {
  async function open(url,signal) {
    signal?.throwIfAborted();
    return openUrl(publicUrl(url),'default',signal);
  }
  return {
    open,
    async play(item,signal) {
      if(!/^[\w-]{11}$/.test(item.videoId))throw Error('Invalid observed video.');
      const url=`https://www.youtube.com/watch?v=${item.videoId}&autoplay=1`;
      const result=await open(url,signal);
      return {...result,opened:true,playing:false,url,title:item.title,channel:item.channel};
    },
    // Cancellation stops pending Capri work, not the user's browser or media.
    stop(){},
  };
}
module.exports={createAgentBrowser};

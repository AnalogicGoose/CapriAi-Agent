'use strict';

const { initialData, readPublic } = require('./web-tools');

const key = text => String(text || '').normalize('NFKD').replace(/[’']/g, '').replace(/\p{M}/gu, '').toLowerCase()
  .match(/[\p{L}\p{N}]+/gu)?.join(' ') || '';
const unquote = text => text.trim().replace(/^["“]|["”]$/g, '').trim();

function trackQuery(query, by) {
  const parts = by.exec(query);
  const title = unquote(parts?.[1] || query);
  const artist = parts ? unquote(parts[2]) : '';
  if (!key(title) || title.length > 150 || artist.length > 100 || (parts && !key(artist)) ||
      /^(?:(?:some|any|more|my|a|the)\s+)?(?:music|songs?|playlist|something|anything|it|(?:that|this|same|first|second|next|previous|latest)(?:\s+(?:one|result|video|song|track))?)$/i.test(title)) return null;
  return { title, artist };
}

function musicRequest(value, allowBare = false) {
  if (typeof value !== 'string' || value.length > 300 || /[\r\n;]|https?:\/\/|\b(?:and then|instead of|and (?:open|launch|play|pause|close|don't))\b/i.test(value.replace(/’/g, "'"))) return null;
  const command = /^(?:(?:hey\s+)?(?:stella|stela|capri)[,\s]+)?(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:please\s+)?(play|pon|reproduce)\s+(.+?)\s*[.!?]*$/i.exec(value.trim());
  if (!command) return null;
  const song = command[2].replace(/,?\s+(?:please|por favor)$/i, '');
  const browser = /\s+(?:in|en|using)\s+(Firefox|(?:Google )?Chrome|(?:Microsoft )?Edge|Brave|(?:the )?Windows default browser)$/i.exec(song);
  let query = browser ? song.slice(0, browser.index) : song;
  const service = /\s+(?:via|on|en)\s+YouTube Music$/i.exec(query);
  if (service) query = query.slice(0, service.index);
  if (/\s+(?:on|via|en)\s+(?:spotify|youtube|apple music|deezer|tidal|amazon music|soundcloud|crunchyroll|steam|xbox|playstation)\b/i.test(query)) return null;
  const marker = /^(?:(?:the|a) (?:song|track)(?: called)?|song|track|la canci[oó]n|el tema)\s+/i.exec(query);
  if (marker) query = query.slice(marker[0].length);
  const by = command[1].toLowerCase() === 'play' ? /^(.*?)\s+by\s+(.+)$/i : /^(.*?)\s+de\s+(.+)$/i;
  if (!allowBare && !marker && !by.test(query) && !service && !/^["“].+["”]$/.test(query)) return null;
  const track = trackQuery(query, by);
  if (!track) return null;
  const labels = { chrome: 'Google Chrome', edge: 'Microsoft Edge', firefox: 'Firefox', brave: 'Brave' };
  const requested = browser?.[1].toLowerCase().replace(/^(?:google|microsoft) /, '');
  return { ...track, browser: requested ? (labels[requested] || 'system') : 'default' };
}

function conversationalMusicRequest(text, query, history = [], interpreted = false) {
  const source = text.trim().replace(/’/g, "'");
  const otherService = /\b(?:on|via|using|through|en)\s+(?:spotify|apple music|deezer|tidal|amazon music|soundcloud|(?:regular )?youtube(?! music))\b/i;
  if (/\b(?:if i (?:ask|say)|for example|hypothetically|pretend|what if|how (?:do|can|would) (?:i|you)|(?:don't|do not|never) (?:play|put on|put .{1,120} on)|no (?:pongas|reproduzcas))\b/i.test(source) ||
      otherService.test(source)) throw Error('This message does not request YouTube Music playback.');
  const direct = musicRequest(text, true);
  if (!query.trim()) {
    if (direct) return { request: direct, needsConfirmation: false };
    throw Error('Which song should I play?');
  }
  const parsed = !/[\r\n]|https?:\/\//i.test(query) && trackQuery(query.trim(), /^(.*?)\s+by\s+(.+)$/i);
  if (!parsed) throw Error('Which song should I play?');
  const titleIn = value => Boolean(key(parsed.title)) && ` ${key(value)} `.includes(` ${key(parsed.title)} `);
  const artistIn = value => Boolean(key(parsed.artist)) && ` ${key(value)} `.includes(` ${key(parsed.artist)} `);
  const previous = history;
  const assistant = previous.at(-1);
  const prompt = assistant?.role === 'assistant' ? assistant.content : '';
  const priorUser = previous.findLast(row => row.role === 'user')?.content || '';
  const playbackCue = /\b(?:play|put on|listen|pon\w*|reproduc\w*|escuch\w*)\b/i;
  const activeRequest = /\b(?:play|pon(?:la|lo)?|reproduce|put on|put .{1,120} on|let's (?:hear|listen)|(?:want|wanna|would love|would like|feel like) (?:to )?(?:hear|listen)|(?:can|could) (?:i|we) (?:hear|listen)|escuchemos|me gustar[ií]a escuchar|quiero escuchar)\b/i.test(source) &&
    !/^(?:i (?:like|love|enjoy|usually|often|play|listen to)|we usually)\b/i.test(source);
  const songQuestion = /\b(?:what|which|qu[eé]|cu[aá]l)\b[^?]{0,80}\b(?:song|track|canci[oó]n)\b[^?]{0,100}\?/i.test(prompt) &&
    /\b(?:you (?:want|like)|should i|shall i|(?:want|like) me|(?:quieres|gustar[ií]a|pongo))\b/i.test(prompt) && playbackCue.test(prompt);
  const offerAccepted = /^(?:yes|yeah|yep|sure|okay|go ahead|s[ií]|dale|that one|the one you suggested)[.!\s]*$/i.test(source) &&
    titleIn(prompt) && /\?\s*$/.test(prompt) && playbackCue.test(prompt) &&
    /\b(?:want me|like me|should i|shall i|can i|how about i|quieres que|te (?:pongo|gustar[ií]a))\b/i.test(prompt);
  const pointsBack = /\b(?:that (?:song|track|one)|the (?:song|track) (?:we|you|i) (?:just )?(?:mentioned|suggested|talked about)|play it|put it on|esa canci[oó]n|ponla)\b/i.test(source);
  const artistAnswer = titleIn(prompt) && artistIn(source) && playbackCue.test(priorUser) &&
    /\b(?:which|what|cu[aá]l|qu[eé])\b[^?]{0,80}\b(?:artist|version|artista|versi[oó]n)\b[^?]{0,100}\?/i.test(prompt);
  if (!titleIn(source) && !artistAnswer && !(previous.some(row => titleIn(row.content)) && (interpreted || offerAccepted || (activeRequest && pointsBack)))) {
    throw Error('Which song should I play?');
  }
  if (!titleIn(source) && otherService.test(priorUser)) throw Error('You previously specified a different music service.');
  const browser = /\b(?:in|en|using)\s+(Firefox|(?:Google )?Chrome|(?:Microsoft )?Edge|Brave|(?:the )?Windows default browser)\b/i.exec(source);
  const browserName = browser && musicRequest(`play a track called sample in ${browser[1]}`)?.browser;
  return {
    request: { title: parsed.title, artist: parsed.artist && [source, ...previous.map(row => row.content)].some(artistIn) ? parsed.artist : '',
      browser: browserName || direct?.browser || 'default' },
    needsConfirmation: !(interpreted || activeRequest || (songQuestion && titleIn(source)) || offerAccepted || artistAnswer),
  };
}

function tracksFromSearch(html) {
  const sections = initialData(html).contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const text = value => value?.runs?.map(row => row.text).join('') || value?.simpleText || '';
  return sections.flatMap(section => section.itemSectionRenderer?.contents || [])
    .map(row => row.videoRenderer).filter(Boolean).slice(0, 20).flatMap(row => {
      const owner = text(row.ownerText);
      const official = row.ownerBadges?.some(badge => badge.metadataBadgeRenderer?.style === 'BADGE_STYLE_TYPE_VERIFIED_ARTIST');
      const description = (row.detailedMetadataSnippets || []).map(snippet => text(snippet.snippetText)).join(' ');
      const distributed = /^Provided to YouTube by\b/i.test(description);
      if (!owner || !/^[\w-]{11}$/.test(row.videoId) || !(official || (distributed && / - Topic$/i.test(owner)))) return [];
      const artist = owner.replace(/ - Topic$/i, '').trim();
      const raw = text(row.title);
      const prefix = /^(.+?)\s+[-–—]\s+(.+)$/.exec(raw);
      const title = (prefix && key(prefix[1]) === key(artist) ? prefix[2] : raw)
        .replace(/\s*[([](?:official (?:music )?(?:video|audio))\s*[)\]]$/i, '').trim();
      return title && title.length <= 160 && artist.length <= 100
        ? [{ id: row.videoId, title, artist, distributed }] : [];
    });
}

class MusicPlayback {
  constructor({ desktop, observe, read = readPublic }) {
    Object.assign(this, { desktop, observe, read });
  }
  async play(request, signal) {
    signal.throwIfAborted();
    const search = new URL('https://www.youtube.com/results');
    const terms = [request.title, request.artist].filter(Boolean).join(' ');
    search.searchParams.set('search_query', terms);
    let tracks = [];
    try {
      const lookup = AbortSignal.any([signal, AbortSignal.timeout(4000)]);
      tracks = tracksFromSearch(await this.read(search.href, lookup)).filter(track =>
        key(track.title) === key(request.title) && (!request.artist || key(track.artist) === key(request.artist)));
    } catch { signal.throwIfAborted(); }
    const artists = [...new Set(tracks.map(track => track.artist))];
    if (artists.length > 1) return { type: 'music', playing: false, note: `Which artist for “${request.title}”? I found ${artists.slice(0, 4).join(', ')}.` };
    const track = tracks.find(row => row.distributed) || tracks[0];
    if (!track) {
      const results = new URL('https://music.youtube.com/search');
      results.searchParams.set('q', terms);
      const receipt = await this.desktop.openUrl(results.href, request.browser, signal);
      return { ...receipt, type: 'music', playing: false, note: `Opened YouTube Music results for “${terms}”. I couldn’t match one official track to play.` };
    }
    const url = `https://music.youtube.com/watch?v=${track.id}&autoplay=1`;
    const receipt = await this.desktop.openUrl(url, request.browser, signal);
    const playing = Boolean(await this.observe?.({ title: track.title, artist: track.artist, browser: receipt.browser, videoId: track.id }, signal));
    signal.throwIfAborted();
    return { ...receipt, type: 'music', title: track.title, artist: track.artist, playing, playbackVerified: playing,
      note: playing ? `Playing “${track.title}” by ${track.artist}.`
        : `Opened “${track.title}” by ${track.artist} in YouTube Music. I couldn’t confirm playback.` };
  }
}

module.exports = { MusicPlayback, musicRequest, conversationalMusicRequest, tracksFromSearch };

'use strict';

const ADDRESS = /^(?:(?:hey[,\s]+)?capri[,!:.\s]+|(?:by the way|for context|actually|just so you know|you know|well|yeah|yep|por cierto)[,\s]+)+/i;
const FIRST_PERSON = /^(?:i (?:really |usually |regularly |currently |also )?(?:like|love|enjoy|prefer|dislike|own|have|use|play|watch|read|train|practice|practise|collect|work|study|build|make)\b|i(?:'m| am) (?:into|working|studying|building|making|learning|a |an )\b|i(?:'ve| have) got\b|my (?:name|favorite|favourite|job|hobby|pc|computer|phone|laptop)\b|me (?:gusta[n]?|encanta[n]?)\b|(?:prefiero|tengo|uso|juego|veo|leo|entreno|practico|colecciono|trabajo|estudio)\b|estoy (?:trabajando|estudiando|creando|aprendiendo)\b|mi (?:nombre|trabajo|pasatiempo|favorit[oa])\b)/i;
const HYPOTHETICAL = /\b(?:if|imagine|suppose|pretend|for example|hypothetically|said|quoted|por ejemplo|imagina|supongamos|dijo)\b/i;
const PRIVATE = /\b(?:password|passcode|pin|secret|token|api[ _-]?key|private[ _-]?key|seed phrase|recovery phrase|address|social security|credit card|bank account|diagnosis|contrase[ñn]a|direcci[oó]n|diagn[oó]stico)\b|\bsk-[\w-]{16,}|\b\d{7,}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i;
const TRANSIENT = /^(?:i(?: have(?: got)?|'ve got) (?:to|just|already|a (?:question|request|problem|feeling|headache|cold))\b|i (?:have|work|study|play|watch|read|train|practice) .*\b(?:today|tonight|yesterday|tomorrow|right now|this morning|this afternoon)\b|i (?:like|love|enjoy|prefer) (?:that|this|it|you|what you did)\b|tengo (?:que|una pregunta|un problema)\b)/i;
const CLAUSE = /(?:(?<=[.!?])\s+|[\n;]+|[, ]+(?:and|but|also|y|pero|además)\s+(?=(?:i\b|i'm\b|my\b|me\b|tengo\b|uso\b|juego\b|trabajo\b|estudio\b)))/i;
const CONTEXTUAL_KINDS = Object.freeze({
  interest: 'I like',
  activity: 'I spend time on',
  possession: 'I own',
  project: 'I’m working on',
});

function eligibleStatement(text) {
  return typeof text === 'string' && text.length <= 3000 && !HYPOTHETICAL.test(text) && !PRIVATE.test(text) &&
    !/\b(?:don't|do not|never) (?:save|remember|store)\b|\b(?:no lo guardes|no lo recuerdes)\b/i.test(text.replace(/[’]/g, "'")) &&
    !/["“”`]|^\s*(?:\/|>)/.test(text);
}

function statements(text) {
  if (!eligibleStatement(text)) return [];
  return text.replace(/[’]/g, "'").replace(ADDRESS, '').split(CLAUSE)
    .map(part => part.trim().replace(ADDRESS, '').replace(/[.!]+$/, ''))
    .filter(part => part.length >= 7 && part.length <= 240 && FIRST_PERSON.test(part) &&
      !TRANSIENT.test(part) && !/[?？]/.test(part) && !/\b(?:used to|might|maybe|perhaps|forget|never remember|don't save)\b/i.test(part))
    .slice(0, 8);
}

function topicKey(value) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(' ') || '';
}

function mentionsTopic(text, topic) {
  return Boolean(topic) && ` ${topicKey(text)} `.includes(` ${topic} `);
}

function contextualFacts(source, details) {
  if (!Array.isArray(details) || details.length < 1 || details.length > 6) throw Error('Invalid personal details.');
  if (!eligibleStatement(source) || /[?？]|^(?:tell me|recommend|explain|forget|remember|talk less|do not|don't|i (?:used to|don't|do not|no longer|might|may))\b/i.test(source.trim().replace(ADDRESS, '').replace(/’/g, "'"))) {
    return [];
  }
  const canonical = text => text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  return details.map(fact => {
    const { kind, detail } = fact || {};
    const value = typeof detail === 'string' ? detail.trim() : '';
    if (!Object.hasOwn(CONTEXTUAL_KINDS, kind) || value.length < 2 || value.length > 160 ||
        !eligibleStatement(value) || /[\r\n]|^(?:it|yes|yeah|sure|no|nope|that|this|nothing|maybe|sometimes|sí|eso)$/i.test(value) ||
        !canonical(source).includes(canonical(value)) || !mentionsTopic(source, topicKey(value))) {
      return null;
    }
    return { text: `${CONTEXTUAL_KINDS[kind]} ${value}`, detail: value };
  }).filter(Boolean);
}

function answerDetail(question, reply) {
  if (typeof question !== 'string' || typeof reply !== 'string' || statements(reply).length) return null;
  const asked = question.trim().split(/(?<=[.!?])\s+/).at(-1);
  if (!asked.endsWith('?') || !/(?:^|[\s¿])(?:what|which|qu[eé]|cu[aá]l(?:es)?)(?=\s)/i.test(asked) ||
      /\b(?:today|tonight|tomorrow|yesterday|hoy|mañana|ayer)\b/i.test(asked)) return null;
  const detail = reply.trim().replace(ADDRESS, '').split(/(?<=[.!?])\s+/)[0].replace(/[.!]+$/, '')
    .replace(/^mostly\s+|,?\s+mostly$/gi, '').trim();
  if (detail.length < 2 || detail.length > 100 ||
      /[;\r\n]|^(?:i\b|i['’]m\b|no\b|not\b|none\b|nothing\b|never\b|my\b|maybe\b|it\b|that\b|this\b|actually\b)|\b(?:i don't know|i was joking|today|tonight|yesterday|tomorrow|right now)\b/i.test(detail)) return null;
  if (/\b(?:are you (?:working on|building|developing|making)|est[aá]s (?:trabajando|haciendo|creando))\b/i.test(asked)) return { kind: 'project', detail };
  if (/\b(?:do you (?:own|have|use)|are you using|tienes|usas)\b/i.test(asked)) return { kind: 'possession', detail };
  if (/\b(?:favou?rite|do you (?:like|love|enjoy|prefer)|are you into|te gusta[n]?|prefieres|favorit[oa])\b/i.test(asked)) return { kind: 'interest', detail };
  if (/\b(?:do you (?:play|practise|practice|train|watch|read|collect|study|spend time on)|are your hobbies|juegas|practicas|estudias)\b/i.test(asked)) {
    return { kind: 'activity', detail };
  }
  return null;
}

const MEMORY_RELATIONS = [
  ['platform', /^(?:play(?: games)?|game) on (.+)$/i],
  ['interest', /^(?:like|love|enjoy|prefer) (.+)$/i],
  ['possession', /^(?:own|have|have got) (?:a |an |the )?(.+)$/i],
  ['project', /^(?:(?:am )?(?:working|work) on|(?:am )?(?:building|making|developing)|build|make|develop) (.+)$/i],
  ['activity', /^(?:play|practice|practise|train|collect|study|spend time on) (.+)$/i],
];

function memorySubject(text) {
  const clause = text.trim().replace(/’/g, "'").replace(/[.!]+$/, '')
    .replace(/^i(?:'m)\s+/i, 'I am ').replace(/^i(?:'ve got)\s+/i, 'I have ');
  const statement = /^i\s+(?:(?:now|mostly|mainly|usually|currently|really)\s+)*(.*)$/i.exec(clause);
  if (!statement) return null;
  for (const [kind, pattern] of MEMORY_RELATIONS) {
    const match = pattern.exec(statement[1]);
    if (match) return { kind, key: topicKey(match[1]) };
  }
  return null;
}

function memoryCorrection(input) {
  if (!eligibleStatement(input)) return null;
  const text = input.trim().replace(/’/g, "'").replace(ADDRESS, '').split(/(?<=[.!?])\s+/)[0].replace(/[.!]+$/, '');
  if (/[?？\r\n]|\b(?:maybe|might|perhaps)\b/i.test(text)) return null;
  const transition = /^i used to (.+?)\s*,?\s+(?:but\s+)?(?:now|these days)\s+(i(?:\s|').+)$/i.exec(text);
  const platform = /^i switched from (?:playing|gaming) on (.+?) to (?:playing|gaming) on (.+)$/i.exec(text);
  if (!transition && !platform) return null;
  const before = memorySubject(transition ? `I ${transition[1]}` : `I play on ${platform[1]}`);
  const replacement = transition ? transition[2] : `I play on ${platform[2]}`;
  const after = memorySubject(replacement);
  if (!before?.key || !after?.key || before.kind !== after.kind || before.key === after.key || replacement.length > 240) return null;
  return { before, after, replacement };
}

function topicRequest(input) {
  const text = input.trim().replace(/[’]/g, "'").replace(ADDRESS, '')
    .replace(/^(?:(?:please|can you|could you|would you|por favor|puedes)\s+)+/i, '').replace(/[.!?]+$/, '');
  const less = /^(?:(?:let's )?(?:talk|hear|say) less about|(?:stop|quit) (?:bringing up|talking about|mentioning)|(?:don't|do not) (?:bring up|talk about|mention)|i (?:don't|do not) care about|habla menos (?:de|sobre)|no (?:menciones|hables de)|no me interesa)\s+(.+)$/i.exec(text);
  const more = /^(?:(?:you can )?(?:bring up|talk about|mention) (.+?) again|vuelve a mencionar (.+))$/i.exec(text);
  const breakFrom = /^(?:i(?:'m| am) taking a break from|i(?:'m| am) on a break from|me estoy tomando un descanso (?:de|del))\s+(.+)$/i.exec(text);
  const backTo = /^(?:i(?:'m| am) back (?:to|into)|volv[ií] a)\s+(.+)$/i.exec(text);
  const forget = /^(?:forget(?: about)?|olvida(?: lo de)?)\s+(.+)$/i.exec(text);
  let topic = (less?.[1] || more?.[1] || more?.[2] || breakFrom?.[1] || backTo?.[1] || forget?.[1])?.trim();
  if (!forget) topic = topic?.replace(/,?\s+(?:for now|for a while|por ahora)$/i, '');
  if (breakFrom || backTo) topic = topic?.replace(/^(?:watching|playing|reading|following|talking about)\s+/i, '');
  if (!topic || topic.length > 100 || PRIVATE.test(topic) || /[?\r\n]/.test(topic) || !topicKey(topic)) return null;
  if (/^(?:it|about it|lo|eso|todo)$/i.test(topic)) return null;
  return { action: less || breakFrom ? 'less' : more || backTo ? 'more' : 'forget', topic };
}

module.exports = { statements, contextualFacts, answerDetail, memorySubject, memoryCorrection, eligibleStatement,
  CONTEXTUAL_KINDS, topicKey, mentionsTopic, topicRequest };

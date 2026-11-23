'use strict';

const { eligibleStatement, mentionsTopic, topicKey } = require('./personal-context');

const MAX_TOPICS = 60;
const TITLE = /^(?:let's (?:talk|chat) about|can we talk about|we were talking about|as for|for) (.+?)(?:\s*,\s*|$)/i;
const POINT = /^(?:we (?:were (?:actually )?(?:comparing|discussing|debating|talking about)|compared|discussed|left off)|i (?:want(?:ed)? to compare|was comparing)|let's (?:compare|discuss))\b/i;
const POSITION = /^(?:(?:i(?:'m| am) (?:(?:actually|only|currently|just|now) )*(?<position>caught up through|through|up to|on|at|watching))|i (?:just )?(?:finished|watched|read)|(?<limit>no spoilers (?:past|beyond|after)))\s+(?<unit>(?:season \d{1,3}[, ]+)?(?:episode|chapter) \d{1,5})(?:\s+now|\s+of\s+(?<topic>.+))?$/i;

function title(value) {
  const name = value?.trim();
  if (!name || name.length > 100 || !eligibleStatement(name) || !topicKey(name) ||
      /[?\r\n]|^(?:it|that|this|something else|another topic|what we discussed)$/i.test(name)) return null;
  return name;
}

function readTurn(text) {
  if (!eligibleStatement(text)) return { topics: [], patch: {} };
  const topics = new Map(), patch = {};
  const addTopic = value => {
    const name = title(value);
    if (name) topics.set(topicKey(name), name);
  };
  for (const part of text.trim().replace(/’/g, "'").split(/(?<=[.!?])\s+|[\n;]+|,\s+(?=(?:we were|we left|no spoilers)\b)/i)) {
    const clause = part.replace(/[.!]+$/, '').trim().replace(/^actually[,\s]+/i, '');
    const named = TITLE.exec(clause);
    if (named) addTopic(named[1]);
    const rest = named && clause.length > named[0].length ? clause.slice(named[0].length) : clause;
    const prefix = !named && /^([^,]+),\s+(.*)$/.exec(rest);
    const prefixedPosition = prefix && POSITION.exec(prefix[2])?.groups;
    const position = prefixedPosition || POSITION.exec(rest)?.groups;
    if (position) {
      if (prefixedPosition) addTopic(prefix[1]);
      addTopic(position.topic);
      const unit = position.unit.toLowerCase();
      if (position.limit) patch.spoiler_limit = `Through ${unit}`;
      else patch.progress = /^(?:on|at|watching|up to)$/i.test(position.position || '')
        ? `Before ${unit}` : `Through ${unit}`;
    }
    if (rest.length <= 280 && !/[?？]/.test(rest) && POINT.test(rest)) patch.point = rest;
  }
  return { topics: [...topics.values()], patch };
}

class TopicRecaps {
  constructor(db, now, retentionDays) {
    Object.assign(this, { db, now, retentionDays });
    db.exec(`CREATE TABLE IF NOT EXISTS topic_recaps (
      key TEXT PRIMARY KEY, topic TEXT NOT NULL, point TEXT, progress TEXT, spoiler_limit TEXT, updated_at TEXT NOT NULL
    )`);
  }
  prune() {
    const days = this.retentionDays();
    if (!Number.isInteger(days) || days <= 0) return;
    this.db.prepare('DELETE FROM topic_recaps WHERE updated_at < ?')
      .run(new Date(this.now().getTime() - days * 86_400_000).toISOString());
  }
  list() {
    this.prune();
    return this.db.prepare('SELECT * FROM topic_recaps ORDER BY updated_at DESC, rowid DESC LIMIT ?').all(MAX_TOPICS);
  }
  match(query) {
    return this.list().filter(row => mentionsTopic(query, row.key));
  }
  context(query) {
    return this.match(query).slice(0, 2).map(row => ({
      topic: row.topic, point: row.point, progress: row.progress, spoilerLimit: row.spoiler_limit,
    }));
  }
  get(topic) {
    this.prune();
    return this.db.prepare('SELECT * FROM topic_recaps WHERE key=?').get(topicKey(topic));
  }
  forget(topic) {
    return Boolean(this.db.prepare('DELETE FROM topic_recaps WHERE key=?').run(topicKey(topic)).changes);
  }
  clear() { this.db.exec('DELETE FROM topic_recaps'); }
  save(topic, patch) {
    this.prune();
    this.db.prepare(`INSERT INTO topic_recaps(key,topic,point,progress,spoiler_limit,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET point=COALESCE(excluded.point,topic_recaps.point),
      progress=COALESCE(excluded.progress,topic_recaps.progress),
      spoiler_limit=COALESCE(excluded.spoiler_limit,topic_recaps.spoiler_limit),updated_at=excluded.updated_at`)
      .run(topicKey(topic), topic, patch.point || null, patch.progress || null, patch.spoiler_limit || null, this.now().toISOString());
    this.db.prepare('DELETE FROM topic_recaps WHERE key NOT IN (SELECT key FROM topic_recaps ORDER BY updated_at DESC,rowid DESC LIMIT ?)')
      .run(MAX_TOPICS);
    return this.get(topic);
  }
  capture(text, history) {
    const { topics, patch } = readTurn(text);
    const names = topics.length ? topics : this.match(text).map(row => row.topic);
    const changing = Object.keys(patch).length > 0;
    if (!names.length && changing) {
      for (const row of history.filter(row => row.role === 'user').slice(-2).reverse()) {
        if (/\b(?:different topic|change the subject|something else)\b/i.test(row.content)) break;
        const prior = readTurn(row.content).topics;
        names.push(...(prior.length ? prior : this.match(row.content).map(row => row.topic)));
        if (names.length) break;
      }
    }
    if (names.length !== 1) return null;
    return changing ? this.save(names[0], patch) : this.get(names[0]);
  }
  learn(topic, point, message, history) {
    const name = title(topic);
    if (!name || typeof point !== 'string' || point.length > 280 || !eligibleStatement(point) ||
        !eligibleStatement(message) || !point.trim() || /[?？]/.test(point) ||
        !message.split(/(?<=[.!?])\s+/).some(clause =>
          !/[?？]/.test(clause) && clause.toLowerCase().includes(point.toLowerCase()))) return null;
    const userText = [message, ...history.filter(row => row.role === 'user').slice(-2).map(row => row.content)];
    const key = topicKey(name);
    if (!userText.some(text => mentionsTopic(text, key))) return null;
    return this.save(name, { point: point.trim() });
  }
}

module.exports = { TopicRecaps };

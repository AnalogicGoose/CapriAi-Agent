'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { statements, contextualFacts, topicKey, mentionsTopic, memorySubject, memoryCorrection } = require('./personal-context');
const { TopicRecaps } = require('./topic-recaps');

function fact(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw Error('Use 1–1000 characters per memory.');
  // Credentials belong in a password manager, never in assistant memory.
  if (/\b(password|contrase[ñn]a|api[ _-]?key|access[ _-]?token|private[ _-]?key|seed phrase|recovery phrase)\b|sk-[a-z0-9_-]{16,}|-----BEGIN .*PRIVATE KEY/i.test(text)) {
    throw Error('Please keep credentials and recovery secrets in a password manager.');
  }
  return text.trim();
}

class MemoryStore {
  constructor(file, { now = () => new Date(), retentionDays = () => 90 } = {}) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.now = now;
    this.retentionDays = retentionDays;
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA secure_delete=ON;
      PRAGMA journal_mode=DELETE;
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL,
        source TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        confirmed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS quiet_topics (
        key TEXT PRIMARY KEY, topic TEXT NOT NULL, updated_at TEXT NOT NULL);
      `);
    // Profile facts share normal edit/delete/retention controls, but can be
    // recalled without a keyword match. Existing memories stay ordinary.
    if (!this.db.prepare('PRAGMA table_info(memories)').all().some(column => column.name === 'profile')) {
      this.db.exec('ALTER TABLE memories ADD COLUMN profile INTEGER NOT NULL DEFAULT 0 CHECK(profile IN (0,1));');
    }
    this.recaps = new TopicRecaps(this.db, this.now, this.retentionDays);
    this.db.exec('PRAGMA user_version=5;');
    this.prune();
  }
  prune() {
    this.recaps.prune();
    // Operational journal contains codes only, never goals, titles or model output.
    this.db.prepare('DELETE FROM agent_events WHERE created_at < ?').run(new Date(this.now().getTime() - 7 * 86400000).toISOString());
    const days = this.retentionDays();
    if (Number.isInteger(days) && days > 0) {
      const cutoff = new Date(this.now().getTime() - days * 86400000).toISOString();
      this.db.prepare('DELETE FROM memories WHERE updated_at < ?').run(cutoff);
    }
  }
  audit(kind, status) {
    if (!['decision', 'action'].includes(kind) || !['wait', 'suggest', 'propose_close', 'cancelled', 'unavailable', 'cancelled-or-failed', 'still-running', 'closed'].includes(status)) throw Error('Invalid agent journal code.');
    this.prune();
    this.db.prepare('INSERT INTO agent_events(kind,status,created_at) VALUES (?,?,?)').run(kind, status, this.now().toISOString());
    this.db.exec('DELETE FROM agent_events WHERE id NOT IN (SELECT id FROM agent_events ORDER BY id DESC LIMIT 500)');
  }
  remember(text, source = 'explicit', { profile = false } = {}) {
    text = fact(text);
    if (!['explicit', 'conversation-confirmed', 'conversation-stated', 'user-edit'].includes(source)) throw Error('Invalid memory source.');
    this.prune();
    const existing = this.db.prepare('SELECT * FROM memories WHERE text = ?').get(text);
    if (existing) {
      if (profile && !existing.profile) this.db.prepare('UPDATE memories SET profile=1 WHERE id=?').run(existing.id);
      return this.get(existing.id);
    }
    const at = this.now().toISOString();
    const result = this.db.prepare('INSERT INTO memories(text,source,created_at,updated_at,confirmed_at,profile) VALUES (?,?,?,?,?,?)')
      .run(text, source, at, at, at, profile ? 1 : 0);
    return this.get(Number(result.lastInsertRowid));
  }
  get(id) { this.prune(); return this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id); }
  edit(id, text) {
    text = fact(text);
    this.prune();
    const at = this.now().toISOString();
    this.db.prepare('UPDATE memories SET text=?,source=?,updated_at=?,confirmed_at=? WHERE id=?')
      .run(text, 'user-edit', at, at, id);
    return this.get(id);
  }
  forget(id) { return Number(this.db.prepare('DELETE FROM memories WHERE id=?').run(id).changes); }
  applyChanges(changes, expected) {
    this.prune();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of expected) {
        const current = this.get(row.id);
        if (!current || current.text !== row.text || current.updated_at !== row.updated_at || current.profile !== row.profile) throw Error('A saved memory changed during review. Please try again.');
      }
      for (const change of changes) {
        if (change.kind === 'add') this.remember(change.text, 'explicit');
        else if (change.kind === 'edit') this.edit(change.id, change.text);
        else if (change.kind === 'forget') this.forget(change.id);
        else throw Error('Invalid memory change.');
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  clear() {
    this.recaps.clear();
    this.db.exec('DELETE FROM memories; DELETE FROM quiet_topics; VACUUM;');
  }
  quietTopics() {
    return this.db.prepare('SELECT key, topic FROM quiet_topics ORDER BY updated_at DESC, key').all();
  }
  setQuiet(topic, quiet) {
    if (!quiet) return Boolean(this.db.prepare('DELETE FROM quiet_topics WHERE key=?').run(topicKey(topic)).changes);
    return Boolean(this.db.prepare(`INSERT INTO quiet_topics(key, topic, updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET topic=excluded.topic, updated_at=excluded.updated_at`)
      .run(topicKey(topic), topic, this.now().toISOString()).changes);
  }
  learn(text) {
    const correction = memoryCorrection(text);
    if (correction) return this.applyCorrection(correction, statements(text));
    return this.learnFacts(statements(text));
  }
  applyCorrection({ before, after, replacement }, otherFacts) {
    this.prune();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const candidates = this.db.prepare('SELECT id, text, profile FROM memories ORDER BY profile DESC, id').all()
        .map(row => ({ ...row, subject: memorySubject(row.text) }))
        .filter(row => row.subject?.kind === before.kind);
      const old = candidates.filter(row => row.subject.key === before.key);
      const current = candidates.find(row => row.subject.key === after.key);
      const target = current || old[0];
      const saved = target ? this.edit(target.id, replacement) : this.remember(replacement, 'conversation-stated');
      if (old.some(row => row.profile) && !saved.profile) {
        this.db.prepare('UPDATE memories SET profile=1 WHERE id=?').run(saved.id);
      }
      for (const row of old) {
        if (row.id !== saved.id) this.forget(row.id);
      }
      const learned = this.learnFacts(otherFacts.filter(text => {
        const subject = memorySubject(text);
        return subject?.kind !== after.kind || (subject.key !== after.key && subject.key !== before.key);
      }));
      this.db.exec('COMMIT');
      return { added: Number(!target) + learned.added, facts: [saved.text, ...learned.facts] };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  learnInContext(text, details) {
    const stated = statements(text);
    const fromContext = contextualFacts(text, details);
    return this.learnFacts(fromContext.filter(row =>
      !stated.some(clause => mentionsTopic(clause, topicKey(row.detail)))).map(row => row.text));
  }
  learnFacts(clauses) {
    if (!clauses.length) return { added: 0, facts: [] };
    this.prune();
    const existing = this.db.prepare('SELECT id, text FROM memories WHERE lower(text)=lower(?) LIMIT 1');
    const refresh = this.db.prepare("UPDATE memories SET updated_at=? WHERE id=? AND source='conversation-stated'");
    let added = 0;
    const facts = new Set();
    for (const clause of new Set(clauses)) {
      const row = existing.get(clause);
      if (row) {
        refresh.run(this.now().toISOString(), row.id);
        facts.add(row.text);
      } else {
        facts.add(this.remember(clause, 'conversation-stated').text);
        added++;
      }
    }
    return { added, facts: [...facts] };
  }
  personalContext(query) {
    const quietTopics = this.quietTopics();
    const visible = row => !quietTopics.some(({ key }) => mentionsTopic(row.text, key) && !mentionsTopic(query, key));
    const rows = [...this.search(query, 12).filter(visible).slice(0, 5),
      ...this.profile(6).filter(visible).slice(0, 3), ...this.list(32).filter(visible).slice(0, 6)];
    const facts = [];
    for (const row of rows) {
      if (facts.some(fact => fact.id === row.id)) continue;
      const entry = { id: row.id, text: row.text, updatedAt: row.updated_at };
      if (Buffer.byteLength(JSON.stringify([...facts, entry])) <= 2400) facts.push(entry);
    }
    return { facts, quietTopics: quietTopics.slice(0, 12).map(row => row.topic) };
  }
  matchingTopic(key) {
    this.prune();
    return this.db.prepare('SELECT * FROM memories').all().filter(row => mentionsTopic(row.text, key));
  }
  list(limit = 100) {
    this.prune();
    return this.db.prepare('SELECT * FROM memories ORDER BY updated_at DESC,id DESC LIMIT ?').all(Math.min(1000, Math.max(1, limit)));
  }
  profile(limit = 3) {
    this.prune();
    return this.db.prepare('SELECT * FROM memories WHERE profile=1 ORDER BY id LIMIT ?').all(Math.min(6, Math.max(1, limit)));
  }
  search(query, limit = 5) {
    this.prune();
    const words = [...new Set(String(query).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])]
      .filter(w => !new Set(['what', 'about', 'tell', 'remember', 'recall', 'the', 'and', 'that', 'you', 'your', 'know', 'does', 'have', 'with', 'que', 'para', 'como', 'sobre', 'recuerda']).has(w)).slice(0, 12);
    if (!words.length) return [];
    const where = words.map(() => "lower(text) LIKE ? ESCAPE '\\'").join(' OR ');
    const args = words.map(w => `%${w.replace(/[\\%_]/g, '\\$&')}%`);
    return this.db.prepare(`SELECT * FROM memories WHERE ${where} ORDER BY updated_at DESC,id DESC LIMIT 100`)
      .all(...args).map(row => ({ row, score: words.filter(w => row.text.toLowerCase().includes(w)).length }))
      .sort((a, b) => b.score - a.score).slice(0, limit).map(({ row }) => row);
  }
  export() {
    this.prune();
    return JSON.stringify({ version: 1, exported_at: this.now().toISOString(), memories:
      this.db.prepare('SELECT * FROM memories ORDER BY id').all(), quiet_topics: this.quietTopics().map(row => row.topic),
      topic_recaps: this.recaps.list() }, null, 2);
  }
  close() { this.db.close(); }
}

// Conservative, local-only candidate detection. No transcript, embeddings or extraction call.
// Every candidate (including seemingly ordinary facts) needs explicit confirmation.
function candidate(text) {
  if (typeof text !== 'string' || text.length > 1000 || /[?？]|\b(if|imagine|suppose|pretend|example)\b/i.test(text)) return null;
  if (/^(?:my (?:name|birthday|favorite|favourite|job|address|partner|wife|husband|diagnosis)\b|i (?:prefer|like|love|live|work|study|have|am allergic)\b|mi (?:nombre|cumplea[ñn]os|favorito|trabajo|direcci[oó]n)\b|(?:prefiero|me gusta|vivo|trabajo|estudio|soy al[eé]rgic)\b)/i.test(text.trim())) {
    return fact(text);
  }
  return null;
}

module.exports = { MemoryStore, candidate, fact };

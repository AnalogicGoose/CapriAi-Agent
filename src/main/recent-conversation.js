'use strict';

const { DatabaseSync } = require('node:sqlite');
const { mentionsTopic } = require('./personal-context');

const MAX_EXCHANGES = 12;
const MAX_BYTES = 30_000;
const MAX_AGE_MS = 7 * 86_400_000;
const messages = (user, reply) => [{ role: 'user', content: user }, { role: 'assistant', content: reply }];

class RecentConversation {
  constructor(file, now = Date.now) {
    this.now = now;
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS exchanges (
        id INTEGER PRIMARY KEY, at INTEGER NOT NULL, user TEXT NOT NULL, reply TEXT NOT NULL
      );`);
  }
  prune() {
    this.db.prepare('DELETE FROM exchanges WHERE at <= ?').run(this.now() - MAX_AGE_MS);
  }
  read() {
    this.prune();
    const exchanges = this.db.prepare('SELECT user, reply FROM exchanges ORDER BY id').all();
    let history = exchanges.flatMap(row => messages(row.user, row.reply));
    while (Buffer.byteLength(JSON.stringify(history)) > MAX_BYTES) history = history.slice(2);
    return history;
  }
  append(user, reply) {
    if (Buffer.byteLength(JSON.stringify(messages(user, reply))) > MAX_BYTES) return;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.prune();
      this.db.prepare('INSERT INTO exchanges(at, user, reply) VALUES(?, ?, ?)').run(this.now(), user, reply);
      this.db.prepare('DELETE FROM exchanges WHERE id NOT IN (SELECT id FROM exchanges ORDER BY id DESC LIMIT ?)').run(MAX_EXCHANGES);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  clear() { this.db.exec('DELETE FROM exchanges'); }
  forgetTopic(key) {
    this.prune();
    const matches = this.db.prepare('SELECT id, user, reply FROM exchanges').all()
      .filter(row => mentionsTopic(row.user, key) || mentionsTopic(row.reply, key));
    if (matches.length) this.db.prepare(`DELETE FROM exchanges WHERE id IN (${matches.map(() => '?').join(',')})`)
      .run(...matches.map(row => row.id));
    return matches.length;
  }
  close() { this.db.close(); }
}

module.exports = { RecentConversation };

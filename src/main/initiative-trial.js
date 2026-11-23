'use strict';

const DAY = 86_400_000;
const FEEDBACK = ['welcome', 'bad-timing', 'repetitive'];

class InitiativeTrial {
  constructor(db, now = Date.now) {
    Object.assign(this, { db, now });
    db.exec(`CREATE TABLE IF NOT EXISTS initiative_trial (
      id INTEGER PRIMARY KEY CHECK(id=1), started_at INTEGER NOT NULL, ended_at INTEGER, resumed INTEGER NOT NULL,
      scheduler TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS initiative_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, trial INTEGER NOT NULL, at INTEGER NOT NULL, topic_key TEXT,
      outcome TEXT NOT NULL, reason TEXT NOT NULL, message TEXT NOT NULL, model_calls INTEGER NOT NULL,
      latency INTEGER NOT NULL, feedback TEXT, rated_at INTEGER
    );`);
    this.prune();
  }
  prune() {
    this.db.prepare('DELETE FROM initiative_decisions WHERE at < ?').run(this.now() - 7 * DAY);
  }
  status() {
    const row = this.db.prepare('SELECT started_at,ended_at,resumed FROM initiative_trial WHERE id=1').get();
    if (!row) return { phase: 'live', startedAt: null, endsAt: null };
    const endsAt = row.ended_at ?? row.started_at + DAY;
    const phase = row.resumed ? 'live' : this.now() < endsAt ? 'running' : 'review';
    return { phase, startedAt: row.started_at, endsAt };
  }
  start() {
    if (this.status().phase !== 'live') return false;
    this.prune();
    this.db.prepare(`INSERT INTO initiative_trial VALUES(1,?,NULL,0,'{}')
      ON CONFLICT(id) DO UPDATE SET started_at=excluded.started_at,ended_at=NULL,resumed=0,scheduler='{}'`).run(this.now());
    return true;
  }
  end() {
    if (this.status().phase !== 'running') return false;
    this.db.prepare('UPDATE initiative_trial SET ended_at=? WHERE id=1').run(this.now());
    return true;
  }
  resume() {
    return Boolean(this.db.prepare('UPDATE initiative_trial SET resumed=1 WHERE id=1 AND resumed=0').run().changes);
  }
  state(startedAt, value) {
    if (value !== undefined) {
      this.db.prepare('UPDATE initiative_trial SET scheduler=? WHERE id=1 AND started_at=?').run(JSON.stringify(value), startedAt);
      return;
    }
    const row = this.db.prepare('SELECT scheduler FROM initiative_trial WHERE id=1 AND started_at=?').get(startedAt);
    return row ? JSON.parse(row.scheduler) : {};
  }
  record(trial, snapshot) {
    const current = this.status();
    if (current.phase !== 'running' || current.startedAt !== trial) return false;
    const { key = null, outcome, reason, message = '', modelCalls = 0, latency = 0 } = snapshot;
    this.db.prepare(`INSERT INTO initiative_decisions(trial,at,topic_key,outcome,reason,message,model_calls,latency)
      VALUES(?,?,?,?,?,?,?,?)`).run(trial, this.now(), key, outcome, reason, message, modelCalls, latency);
    return true;
  }
  decisions(before = Number.MAX_SAFE_INTEGER) {
    this.prune();
    return this.db.prepare(`SELECT id,at,outcome,reason,message,model_calls,latency,feedback FROM initiative_decisions
      WHERE trial=? AND id<? ORDER BY id DESC LIMIT 8`).all(this.status().startedAt, before);
  }
  summary() {
    this.prune();
    return this.db.prepare(`SELECT outcome,count(*) AS count,sum(model_calls) AS calls,
      round(avg(CASE WHEN model_calls>0 THEN latency END)) AS average_latency
      FROM initiative_decisions WHERE trial=? GROUP BY outcome`).all(this.status().startedAt);
  }
  rate(id, feedback) {
    if (!Number.isSafeInteger(id) || !FEEDBACK.includes(feedback)) return false;
    return Boolean(this.db.prepare(`UPDATE initiative_decisions SET feedback=?,rated_at=?
      WHERE id=? AND trial=? AND outcome IN ('proposed','repeat') AND at >= ?`)
      .run(feedback, this.now(), id, this.status().startedAt, this.now() - 7 * DAY).changes);
  }
  avoids(key) {
    return Boolean(this.db.prepare(`SELECT 1 FROM initiative_decisions WHERE topic_key=? AND feedback='repetitive'
      AND rated_at>=? LIMIT 1`).get(key, this.now() - DAY));
  }
  extraDelay() {
    const row = this.db.prepare('SELECT feedback FROM initiative_decisions WHERE rated_at>=? ORDER BY rated_at DESC,id DESC LIMIT 1')
      .get(this.now() - DAY);
    return row?.feedback === 'bad-timing' ? 5 * 60_000 : 0;
  }
}

module.exports = { InitiativeTrial };

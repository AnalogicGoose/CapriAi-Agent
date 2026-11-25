'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { permissions } = require('./pc-context');
const { fact } = require('./memory');
const { publicUrl } = require('./web-tools');
const { settingsPatch } = require('./settings-policy');
const key = text => text.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const clean = (text, max = 1000) => {
  const value = fact(text);
  if (value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw Error('Use a short single line for each routine field.');
  return value;
};
const SETTINGS = ['muted', 'volume', 'scale', 'lang', 'wander', 'possess', 'windowTracking', 'idleAnimations',
  'cursorInteractions', 'personality', 'dailyRoutine', 'surpriseAnimations', 'ttsEnabled'];
const ACTIONS = ['app', 'url', 'setting', 'command', 'task'];
const EFFECTS = ['capri_body', 'capri_input', 'capri_settings_change', 'capri_desktop_step', 'capri_close_app', 'capri_control'];
const READS = ['capri_screen', 'capri_context', 'capri_apps', 'capri_settings_read', 'capri_approval', 'capri_window_controls'];
function steps(value) {
  if (!Array.isArray(value) || !value.length || value.length > 8) throw Error('A routine needs one to eight ordered steps.');
  const result = value.map(step => {
    if (!step || Object.keys(step).sort().join(',') !== 'action,instruction,target,value' || !ACTIONS.includes(step.action)
        || typeof step.target !== 'string' || typeof step.value !== 'string') throw Error('Invalid routine step.');
    const row = { action: step.action, instruction: clean(step.instruction, 400), target: step.target ? clean(step.target) : '', value: step.value };
    if (step.value.length > 300 || /[\x00-\x1f\x7f]/.test(step.value)) throw Error('Invalid routine step value.');
    if (row.action === 'task') { if (row.target || row.value) throw Error('A flexible task uses an instruction and empty target/value.'); }
    else if (!row.target) throw Error('A concrete routine step needs a target.');
    if (row.action === 'app' && (row.target.length > 120 || row.value)) throw Error('An app step needs an app name and empty value.');
    if (row.action === 'url') { row.target = publicUrl(row.target); if (row.value.length > 80) throw Error('Use a browser name or empty value.'); }
    if (row.action === 'command' && row.value !== '0') throw Error('A command step requires an expected exit code of 0.');
    if (row.action === 'setting') {
      if (!SETTINGS.includes(row.target)) throw Error('That preference cannot be delegated to a routine.');
      const patch = settingsPatch({ [row.target]: JSON.parse(row.value) });
      row.value = JSON.stringify(patch[row.target]);
    }
    return row;
  });
  if (Buffer.byteLength(JSON.stringify(result)) > 12000) throw Error('Keep the routine under 12000 UTF-8 bytes.');
  return result;
}
function direct(text) {
  return key(text).replace(/^(?:hey\s+)?(?:stella|stela|capri)(?:[,!:.]\s*|\s+|$)/, '').replace(/^(?:(?:please|can you|could you|would you|por favor|puedes)\s+)+/, '');
}
function recoveryTarget(text) {
  if (typeof text !== 'string' || text.length > 200) return undefined;
  const polite = /\b(?:can you|could you|would you|puedes)\b/i.test(text);
  const value = direct(text).replace(polite ? /[.!?]+$/ : /[.!]+$/, '').replace(/\s+(?:please|por favor)$/, '');
  const match = /^(?:resume|retry|continue|reanuda|reintenta|contin[uú]a)\s+(?:(?:my|the|that|last|failed|la|mi|esa|[úu]ltima)\s+)*(?:routine|rutina)(?:\s+([^?]+))?$/.exec(value);
  if (match) return (match[1] || '').replace(/^["“](.*)["”]$/, '$1');
  return undefined;
}
function teachingOnly(text) {
  const value = direct(text);
  return /^(?:remember|save|learn|teach|recuerda|guarda|aprende)\b/.test(value)
    && /\b(?:routine|workflow|process|rutina|proceso)\b|\bwhen i (?:say|ask)\b/.test(value)
    || /^(?:create|update|edit|change|rename|crea|actualiza|edita|cambia|renombra)\b/.test(value)
      && /\b(?:routine|workflow|rutina)\b|\bprocess\s+(?:named|called)\b|\bproceso\s+(?:llamado|con nombre)\b/.test(value)
    || /^when i (?:say|ask)\b/.test(value);
}
function teaching(text, name, id = 0, removing = false) {
  const value = direct(text);
  if (/^(?:if|imagine|pretend|what|how|should|don't|do not|never|no\b|si\b|imagina)/.test(value)) return false;
  const verb = removing ? /^(?:delete|remove|forget|borra|elimina|olvida)\b/ : /^(?:remember|save|learn|teach|create|update|edit|change|rename|recuerda|guarda|aprende|crea|actualiza|edita|cambia|renombra)\b|^when i (?:say|ask)\b/;
  return verb.test(value) && (/\b(?:routine|workflow|process|rutina|proceso)\b|\bwhen i (?:say|ask)\b/.test(value)) &&
    (value.includes(key(name)) || id > 0 && new RegExp(`(?:#|routine\\s+|rutina\\s+)${id}\\b`).test(value));
}

class ReusableRoutines {
  constructor({ goals, settings, confirm = async () => false, now = Date.now }) {
    Object.assign(this, { goals, settings, confirm, now }); this.db = goals.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS companion_routines (
      id INTEGER PRIMARY KEY AUTOINCREMENT, scope_id INTEGER NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL,
      steps TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      last_used_at INTEGER, UNIQUE(scope_id,name_key));
      CREATE TABLE IF NOT EXISTS companion_routine_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT, routine_id INTEGER NOT NULL, scope_id INTEGER NOT NULL,
        version INTEGER NOT NULL, status TEXT NOT NULL, finished_steps INTEGER NOT NULL DEFAULT 0,
        results TEXT NOT NULL DEFAULT '[]', started_at INTEGER NOT NULL, finished_at INTEGER);`);
    // An interrupted application cannot claim the previous process is still running.
    this.db.prepare("UPDATE companion_routine_runs SET status='stopped',finished_at=? WHERE status='running'").run(this.now());
  }
  scope() { return this.goals.projects.scope() ?? 0; }
  enabled() {
    const c = this.settings(), p = permissions(c.privacy);
    return c.routinesEnabled !== false && c.agentEnabled !== false && !c.gamingMode && p.memoryEnabled && p.memoryRecall;
  }
  readable() { if (!this.enabled()) throw Error('Enable Memory, recall and routines, and resume Stella before using a saved routine.'); }
  pruneRecords() {
    const days = permissions(this.settings().privacy).retentionDays;
    if (days > 0) {
      this.db.prepare('DELETE FROM companion_routines WHERE MAX(updated_at,COALESCE(last_used_at,0))<?').run(this.now() - days * 86400000);
      this.db.prepare('DELETE FROM companion_routine_runs WHERE started_at<?').run(this.now() - days * 86400000);
    }
    this.db.exec(`DELETE FROM companion_routines WHERE scope_id!=0 AND scope_id NOT IN (SELECT id FROM companion_projects);
      DELETE FROM companion_routine_runs WHERE routine_id NOT IN (SELECT id FROM companion_routines);
      DELETE FROM companion_routine_runs WHERE id NOT IN (SELECT id FROM companion_routine_runs ORDER BY id DESC LIMIT 100)`);
  }
  rows() {
    this.goals.prune();
    return this.db.prepare('SELECT * FROM companion_routines WHERE scope_id IN (0,?) ORDER BY name_key,id').all(this.scope());
  }
  lookup(query = '', review = false) {
    if (!review) this.readable();
    if (typeof query !== 'string' || query.length > 120) throw Error('Use a routine name or #ID.');
    const rows = this.rows(), id = /^#?(\d+)$/.exec(query.trim());
    if (!query.trim()) return { routines: rows.map(({ id, name, scope_id, version }) => ({ id, name, scope_id, version })) };
    const matches = rows.filter(row => id ? row.id === Number(id[1]) : row.name_key === key(query));
    if (matches.length > 1) throw Error('More than one routine has that name. Choose its #ID.');
    return { routine: matches[0] ? { ...matches[0], steps: JSON.parse(matches[0].steps) } : null };
  }
  invocation(text) {
    if (typeof text !== 'string' || text.length > 200) return null;
    const politeRun = /^(?:(?:hey\s+)?(?:stella|stela|capri)[,!:.]?\s*)?(?:please\s+)?(?:can|could|would) you\s+(?:please\s+)?(?:run|start|execute|do|use)\b/i.test(text.trim());
    const raw = direct(text).replace(politeRun ? /[.!?]+$/ : /[.!]+$/, '');
    if (/\?|^(?:if|what|how|why|should|don't|do not|never|imagine|pretend|no\b)/.test(raw) || raw.startsWith('/')) return null;
    let name = raw.replace(/^(?:run|start|execute|do|use|inicia|ejecuta|haz|usa)\s+/, '')
      .replace(/^(?:(?:my|the|mi|la)\s+)?(?:routine|workflow|process|rutina|proceso)\s+/, '').trim();
    name = name.replace(/^["“](.*)["”]$/, '$1').replace(/\s+(?:please|por favor|again|now)$/, '');
    const id = /^(?:routine\s+)?#(\d+)$/.exec(name);
    const original = key(text).replace(politeRun ? /[.!?]+$/ : /[.!]+$/, '').replace(/^["“](.*)["”]$/, '$1');
    const exact = this.rows().filter(row => [raw.replace(/^["“](.*)["”]$/, '$1'), original].includes(row.name_key));
    const matches = exact.length ? exact : this.rows().filter(row => id ? row.id === Number(id[1]) : row.name_key === name);
    if (matches.length > 1) throw Error('More than one routine has that name. Use run routine #ID.');
    const result = matches[0] ? { ...matches[0], steps: JSON.parse(matches[0].steps) } : null;
    if (result) this.readable();
    return result;
  }
  async save(args, { text, check, interpreted = false }, observed) {
    if (!args || Object.keys(args).sort().join(',') !== 'id,name,scope,steps' || !Number.isSafeInteger(args.id) || args.id < 0 || !['global', 'project'].includes(args.scope)) throw Error('Invalid routine save.');
    const name = clean(args.name, 80), definition = steps(args.steps), scope = args.scope === 'global' ? 0 : this.scope();
    if (name.startsWith('/') || /^[0-9#]+$/.test(name) || /[?]/.test(name)) throw Error('Choose a short spoken name, not a command or question.');
    if (args.scope === 'project' && !scope) throw Error('Choose a project before saving a project routine.');
    if (!interpreted && !teaching(text, name, args.id)) throw Error('Learning a routine requires a direct current teaching request naming the process.');
    const c = this.settings();
    if (c.routinesEnabled === false || c.gamingMode || !permissions(c.privacy).memoryEnabled) throw Error('Enable Memory and routines, and resume Stella before saving.');
    const old = args.id ? observed.get(args.id) : null;
    if (args.id && (!old || old.scope_id !== scope)) throw Error('Look up this routine in the current project before editing it.');
    if (old && !interpreted && !key(text).includes(old.name_key) && !new RegExp(`(?:#|routine\\s+|rutina\\s+)${old.id}\\b`).test(key(text))) throw Error('Name the existing routine or its #ID when editing it.');
    const selection = this.scope();
    const verify = () => {
      check(); const cfg = this.settings();
      if (cfg.gamingMode || cfg.routinesEnabled === false || !permissions(cfg.privacy).memoryEnabled || this.scope() !== selection) throw Error('Routine permission or project changed.');
      if (old) {
        const current = this.db.prepare('SELECT * FROM companion_routines WHERE id=?').get(args.id);
        if (!current || current.version !== old.version || current.steps !== old.steps || current.name !== old.name || current.scope_id !== old.scope_id) throw Error('Routine changed; look it up again.');
      }
    };
    verify();
    if (permissions(c.privacy).memoryConfirmChanges && !await this.confirm('Save this reusable routine?', JSON.stringify({ name, scope: args.scope, steps: definition }, null, 2))) return { saved: false, reason: 'User cancelled.' };
    verify(); this.goals.prune();
    if (this.db.prepare('SELECT id FROM companion_routines WHERE name_key=? AND scope_id IN (0,?) AND id!=?').get(key(name), selection, args.id)) throw Error('A routine with this name is already available. Look it up to edit it.');
    if (!args.id && this.db.prepare('SELECT count(*) AS n FROM companion_routines').get().n >= 50) throw Error('The routine list is full. Delete an old routine first.');
    let id = args.id;
    if (old) this.db.prepare('UPDATE companion_routines SET name=?,name_key=?,steps=?,version=version+1,updated_at=? WHERE id=?')
      .run(name, key(name), JSON.stringify(definition), this.now(), id);
    else id = Number(this.db.prepare('INSERT INTO companion_routines(scope_id,name,name_key,steps,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(scope, name, key(name), JSON.stringify(definition), this.now(), this.now()).lastInsertRowid);
    return { saved: true, id, name, version: this.db.prepare('SELECT version FROM companion_routines WHERE id=?').get(id).version,
      note: 'Saved only. Say the name or run the routine to execute it; this does not schedule it.' };
  }
  async remove(id, { text, check, interpreted = false }, observed) {
    const row = observed.get(id);
    if (!row || !this.rows().some(value => value.id === id) || !interpreted && !teaching(text, row.name, id, true)) throw Error('Look up the routine and explicitly request its deletion.');
    const scope = this.scope();
    if (permissions(this.settings().privacy).memoryConfirmChanges && !await this.confirm('Forget this routine?', row.name)) return { deleted: false };
    check();
    const current = this.db.prepare('SELECT * FROM companion_routines WHERE id=?').get(id);
    if (this.scope() !== scope || !current || current.version !== row.version) throw Error('Routine or project changed.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM companion_routine_runs WHERE routine_id=?').run(id);
      this.db.prepare('DELETE FROM companion_routines WHERE id=?').run(id); this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { deleted: true, name: row.name };
  }
  begin(text) {
    const target = recoveryTarget(text);
    if (target !== undefined) return this.recover(target, text);
    const row = this.invocation(text);
    return row ? new RoutineSession({ store: this, row, request: text }) : null;
  }
  start(target, request) {
    if (!target) return { message: 'Which saved routine should I run?' };
    const { routine: row } = this.lookup(target);
    if (!row) return { message: 'I couldn’t find that saved routine in this project.' };
    return new RoutineSession({ store: this, row, request });
  }
  recover(target, request) {
    if (!this.enabled()) return { message: 'Enable Memory, recall and routines before resuming a routine.' };
    const scope = this.scope();
    const rows = this.rows();
    const id = /^#?(\d+)$/.exec(target);
    const matches = rows.filter(row => id ? row.id === Number(id[1]) : row.name_key === target);
    if (matches.length > 1) return { message: 'More than one routine has that name. Use “Resume routine #ID”.' };
    const named = matches[0];
    if (target && !named) return { message: 'I couldn’t find that saved routine in this project.' };
    const latest = named
      ? this.db.prepare('SELECT * FROM companion_routine_runs WHERE scope_id=? AND routine_id=? ORDER BY id DESC LIMIT 1').get(scope, named.id)
      : this.db.prepare('SELECT * FROM companion_routine_runs WHERE scope_id=? ORDER BY id DESC LIMIT 1').get(scope);
    const saved = rows.find(row => row.id === latest?.routine_id);
    if (!saved) return { message: 'There’s no recent routine run to resume in this project. You can start a saved routine by name.' };
    if (latest.status === 'completed') return { message: `“${saved.name}” already finished. Say “Run ${saved.name}” to start a new run.` };
    if (latest.status === 'running') return { message: `“${saved.name}” is already running.` };
    if (latest.version !== saved.version) return { message: `“${saved.name}” changed since that run. Say “Run ${saved.name}” to use the updated steps.` };
    const row = { ...saved, steps: JSON.parse(saved.steps) };
    const index = latest.finished_steps;
    const results = JSON.parse(latest.results).slice(0, index);
    if (!Number.isInteger(index) || index < 0 || index >= row.steps.length || results.length !== index ||
        results.some((result, i) => result.step !== i + 1 || result.action !== row.steps[i].action ||
          result.result !== stepResult[row.steps[i].action])) {
      return { message: `I couldn’t verify where “${saved.name}” stopped. Review its run history with /routines runs.` };
    }
    return new RoutineSession({ store: this, row, request, recovery: { index, results } });
  }
  async route(text, patch) {
    const match = /^\/routines(?:\s+(.*))?$/i.exec(text.trim());
    if (!match) return null;
    const arg = (match[1] || 'list').trim(), reply = text => ({ handled: true, text });
    if (/^(on|off)$/i.test(arg)) { patch({ routinesEnabled: arg.toLowerCase() === 'on' }); return reply('Reusable routines ' + arg.toLowerCase() + '.'); }
    if (/^list$/i.test(arg)) return reply(JSON.stringify(this.lookup('', true), null, 2));
    if (/^export$/i.test(arg)) return reply(JSON.stringify({ version: 1, routines: this.rows().map(row => ({ ...row, steps: JSON.parse(row.steps) })) }, null, 2));
    if (/^runs$/i.test(arg)) return reply(JSON.stringify(this.db.prepare('SELECT id,routine_id,version,status,finished_steps,results,started_at,finished_at FROM companion_routine_runs WHERE scope_id=? ORDER BY id DESC LIMIT 20').all(this.scope()), null, 2));
    const show = /^show\s+(.+)$/i.exec(arg);
    if (show) return reply(JSON.stringify(this.lookup(show[1], true), null, 2));
    const forget = /^delete\s+#?(\d+)$/i.exec(arg);
    if (forget) {
      const row = this.rows().find(row => row.id === Number(forget[1]));
      if (!row) return reply('Routine not found in the current scope.');
      const result = await this.remove(row.id, { text: `Delete routine #${row.id}`, check() {} }, new Map([[row.id, row]]));
      return reply(result.deleted ? 'Routine and its run history deleted. Project files were not changed.' : 'Deletion cancelled.');
    }
    return reply('Use /routines list; show <name or #ID>; runs; export; delete <id>; on|off. Say “Run <name>” to start over or “Resume routine <name>” to continue from its first unfinished step.');
  }
}

const stepResult = { command: 'command-exited-zero', setting: 'setting-changed', task: 'actions-observed-outcome-unverified',
  app: 'launch-request-accepted', url: 'launch-request-accepted' };

class RoutineSession {
  constructor({ store, row, request, recovery }) {
    Object.assign(this, { store, row, request }); this.scope = store.scope();
    this.index = recovery?.index ?? 0; this.active = false; this.proofs = [];
    this.results = recovery?.results ?? []; this.status = 'running'; this.resumed = Boolean(recovery);
    this.workspace = store.goals.projects.workspace();
    this.id = Number(store.db.prepare("INSERT INTO companion_routine_runs(routine_id,scope_id,version,status,finished_steps,results,started_at) VALUES(?,?,?,'running',?,?,?)")
      .run(row.id, this.scope, row.version, this.index, JSON.stringify(this.results), store.now()).lastInsertRowid);
  }
  validate() {
    this.store.readable(); this.store.goals.prune();
    if (this.status !== 'running') throw Error('This routine is already ' + this.status + '.');
    const current = this.store.db.prepare('SELECT * FROM companion_routines WHERE id=?').get(this.row.id);
    if (!current || current.version !== this.row.version || current.scope_id !== this.row.scope_id || current.name !== this.row.name || current.steps !== JSON.stringify(this.row.steps) || this.store.scope() !== this.scope
      || this.store.goals.projects.workspace() !== this.workspace) throw Error('Routine definition, project or permission changed. Start again with the current routine.');
    if (this.store.db.prepare('SELECT status FROM companion_routine_runs WHERE id=?').get(this.id)?.status !== 'running') throw Error('The saved routine run was stopped or deleted.');
  }
  descriptor() { return { id: this.row.id, name: this.row.name, version: this.row.version, steps: this.row.steps,
    first_step: this.index + 1, resumed: this.resumed,
    note: 'The current user invoked this exact named definition. Perform only these steps with existing foreground tools. This is not blanket permission or a schedule.' }; }
  step() { return this.active ? this.row.steps[this.index] : null; }
  effectiveText() {
    const step = this.step();
    if (!step) return this.request;
    const canonical = { app: `Open app ${step.target}.`, url: `Open ${step.target} in ${step.value || 'default'} browser.`, setting: `Change your settings: ${step.target} = ${step.value}.`, command: `Run ${step.target}.`, task: '' }[step.action];
    return `${step.instruction}\n${canonical}`;
  }
  authorize(name, args) {
    this.validate();
    if (!EFFECTS.includes(name)) return;
    const step = this.step(); if (!step) throw Error('Start the next routine step before performing an action.');
    if (step.action === 'task') {
      if (name === 'capri_settings_change' && Object.keys(JSON.parse(args.patch)).some(key => !SETTINGS.includes(key))) throw Error('Routines cannot change access, memory, startup or routine controls.');
      return;
    }
    if (step.action === 'app' && name === 'capri_desktop_step' && args.tool === 'open_app' && key(args.query) === key(step.target)) return;
    if (step.action === 'url' && name === 'capri_desktop_step' && args.tool === 'open_url' && publicUrl(args.query) === step.target && key(args.browser || 'default') === key(step.value || 'default')) return;
    if (step.action === 'setting' && name === 'capri_settings_change') {
      const patch = JSON.parse(args.patch);
      if (Object.keys(patch).length === 1 && JSON.stringify(patch[step.target]) === step.value) return;
    }
    throw Error('That action does not match the active saved routine step.');
  }
  observeTool(name, result) {
    if (!this.active || ![...EFFECTS, 'capri_screen', 'capri_context'].includes(name)) return;
    const failed = result?.completed === false || result?.changed === false || result?.ok === false ||
      (name === 'capri_control' && result?.dispatched !== true);
    if (failed) {
      this.failStep(result.text || result.reason); return;
    }
    const success = name === 'capri_desktop_step' ? result?.completed === true : name === 'capri_settings_change' ? result?.changed === true : Boolean(result);
    if (success) this.proofs.push({ kind: 'local-tool', tool: name, success: true });
  }
  failStep(reason) {
    if (this.status !== 'running' || !this.active) return;
    this.reason = typeof reason === 'string' ? reason.slice(0, 200) : 'The tool did not complete this step.';
    this.results.push({ step: this.index + 1, action: this.step().action, result: 'tool-failed' });
    this.stop('failed');
  }
  observeNative(item, workspace) {
    if (this.status !== 'running') return 'Routine stopped; no further steps may run.';
    this.validate();
    if (!this.active) return 'Start a routine step before native work.';
    const step = this.step();
    if (item.type === 'commandExecution') {
      if (!Number.isInteger(item.exitCode) || !['completed', 'failed'].includes(item.status)) return null;
      if (item.exitCode !== 0) {
        this.results.push({ step: this.index + 1, action: step.action, result: 'command-exited-nonzero', exitCode: item.exitCode });
        this.reason = `The command exited ${item.exitCode}.`;
        this.stop('failed'); return `Routine “${this.row.name}” stopped at step ${this.index + 1}: command exited ${item.exitCode}.`;
      }
      if (step.action === 'command') {
        let relative = '..';
        try { if (typeof item.cwd === 'string' && path.isAbsolute(item.cwd) && typeof workspace === 'string') relative = path.relative(fs.realpathSync(workspace), fs.realpathSync(item.cwd)); } catch { return null; }
        if (typeof item.command !== 'string' || item.command.trim().replace(/\s+/g, ' ') !== step.target.trim().replace(/\s+/g, ' ') || path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) return null;
      }
      this.proofs.push({ kind: 'native-command', success: true, exitCode: 0 });
    } else if (step.action === 'task' && ['fileChange', 'mcpToolCall', 'webSearch', 'imageView'].includes(item.type)) {
      if (item.status === 'failed') { this.stop('failed'); return 'Routine stopped after a failed native step.'; }
      if (item.status === 'completed') this.proofs.push({ kind: item.type, success: true });
    }
    return null;
  }
  async advance(action, detail, { check, confirm, progress = () => {} }) {
    if (action === 'status') { this.store.readable(); return this.receipt(); }
    if (action === 'stop') { this.reason = detail.trim(); this.stop('stopped'); this.store.readable(); return this.receipt(); }
    this.validate(); check();
    if (action === 'next') {
      if (this.active || this.index >= this.row.steps.length) throw Error('Finish the current routine step first.');
      const step = this.row.steps[this.index];
      // Concrete consequential commands get the existing native review surface;
      // other consequential effects still use capri_approval and normal policies.
      if (step.action === 'command' && /(?:^|[;&|]\s*)(?:remove-item|rm|rmdir|del|erase|format(?:\.com)?|shutdown|stop-process|taskkill)(?:\s|$)|(?:^|[;&|]\s*)git\s+(?:push|reset|clean)\b|\bcurl\b.*(?:--data|-d\b|-X\s*POST)/i.test(step.target)) {
        if (!await confirm('Run this routine command?', `Routine: ${this.row.name}\nCommand: ${step.target}\nWorkspace: ${this.workspace || 'current Codex workspace'}`)) { this.stop('stopped'); return this.receipt(); }
        check(); this.validate();
      }
      this.active = true; this.proofs = [];
      progress(`Routine “${this.row.name}”: step ${this.index + 1} of ${this.row.steps.length}.`);
      return { ...this.receipt(), step: this.index + 1, instruction: step,
        note: 'Execute with existing tools, then complete this step using actual receipts. Do not skip failed steps or invent outcomes.' };
    }
    if (action !== 'complete' || !this.active) throw Error('No active routine step to complete.');
    const step = this.step();
    const needed = { app: 'capri_desktop_step', url: 'capri_desktop_step', setting: 'capri_settings_change', command: 'native-command' }[step.action];
    if (!this.proofs.some(proof => needed ? proof.tool === needed || proof.kind === needed : proof.success)) throw Error('No matching successful execution receipt for this step. Perform and check it first.');
    this.results.push({ step: this.index + 1, action: step.action, result: stepResult[step.action] });
    this.index++; this.active = false;
    if (this.index === this.row.steps.length) { this.status = 'completed'; this.store.db.prepare('UPDATE companion_routines SET last_used_at=? WHERE id=?').run(this.store.now(), this.row.id); }
    this.persist(); return this.receipt();
  }
  persist() {
    this.store.db.prepare('UPDATE companion_routine_runs SET status=?,finished_steps=?,results=?,finished_at=? WHERE id=?')
      .run(this.status, this.index, JSON.stringify(this.results), this.status === 'running' ? null : this.store.now(), this.id);
  }
  stop(status = 'stopped') { if (this.status === 'running') { this.status = status; this.persist(); } }
  receipt() { return { routine: this.row.name, runId: this.id, status: this.status, finished_steps: this.index, total_steps: this.row.steps.length, results: this.results, ...(this.reason ? { reason: this.reason } : {}),
    note: 'Receipts describe actual actions, command exits or setting changes. Launch acceptance does not prove page loading; flexible-task outcomes are not independently verified. Earlier effects may remain after stopping.' }; }
}

module.exports = { ReusableRoutines, RoutineSession, ACTIONS, SETTINGS, EFFECTS, READS, teachingOnly };

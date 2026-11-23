'use strict';

// Validates model-produced drawings and walkthroughs. Output is plain text only; nothing here is ever rendered as markup.
const MARK_KINDS = ['ring', 'arrow', 'label', 'number', 'spotlight', 'underline'];
const CARD_KINDS = ['note', 'steps', 'table'];
const ACTIONS = ['click', 'type', 'scroll', 'look'];
const LIMITS = { marks: 12, cards: 2, markText: 60, noteText: 400, noteTitle: 60, stepItems: 8, stepItem: 80, tableColumns: 5, tableRows: 8, tableCell: 40, walkSteps: 12, say: 160 };

const fail = (path, why) => { throw Error(`${path}: ${why}`); };
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const clean = s => s.replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim();
function str(v, path, max, { required = true } = {}) {
  if (v === undefined || v === null) return required ? fail(path, 'required') : undefined;
  if (typeof v !== 'string') fail(path, 'must be a string');
  const s = clean(v);
  if (required && !s) fail(path, 'must not be empty');
  if (s.length > max) fail(path, `at most ${max} characters`);
  return s;
}
function list(v, path, max, { required = false } = {}) {
  if (v === undefined || v === null) return required ? fail(path, 'required') : [];
  if (!Array.isArray(v)) fail(path, 'must be an array');
  if (v.length > max) fail(path, `at most ${max} items`);
  return v;
}
const num = (v, path) => Number.isFinite(v) ? v : fail(path, 'must be a finite number');

function target(t, path, { allowSnapshot = true, allowName = false } = {}) {
  if (!isObj(t)) fail(path, 'must be an object');
  if (t.type === 'control') return { type: 'control', id: str(t.id, `${path}.id`, 200) };
  if (t.type === 'text') {
    const out = { type: 'text', text: str(t.text, `${path}.text`, 200) };
    if (t.nth !== undefined) { if (!Number.isInteger(t.nth) || t.nth < 1 || t.nth > 50) fail(`${path}.nth`, 'must be an integer from 1 to 50'); out.nth = t.nth; }
    return out;
  }
  if (t.type === 'snapshot') {
    if (!allowSnapshot) fail(path, 'snapshot targets are not allowed here');
    const out = { type: 'snapshot', snapshotId: str(t.snapshotId, `${path}.snapshotId`, 100) };
    for (const k of ['x', 'y', 'width', 'height']) out[k] = num(t[k], `${path}.${k}`);
    if (out.width <= 0 || out.height <= 0) fail(`${path}.width`, 'width and height must be positive');
    return out;
  }
  if (t.type === 'name') {
    if (!allowName) fail(path, 'name targets are only allowed in walkthroughs');
    const out = { type: 'name', name: str(t.name, `${path}.name`, 200) };
    const role = str(t.role, `${path}.role`, 60, { required: false });
    if (role) out.role = role;
    return out;
  }
  return fail(`${path}.type`, 'unknown target type');
}
const validateTarget = (t, opts = {}) => target(t, 'target', opts);

function mark(m, i) {
  const p = `marks[${i}]`;
  if (!isObj(m)) fail(p, 'must be an object');
  if (!MARK_KINDS.includes(m.kind)) fail(`${p}.kind`, `must be one of ${MARK_KINDS.join(', ')}`);
  const out = { id: str(m.id, `${p}.id`, 40, { required: false }) || `m${i + 1}`, kind: m.kind, target: target(m.target, `${p}.target`) };
  if (m.kind === 'arrow') { if (m.to === undefined || m.to === null) fail(`${p}.to`, 'required for arrow'); out.to = target(m.to, `${p}.to`); }
  const text = str(m.text, `${p}.text`, LIMITS.markText, { required: false });
  if (text) out.text = text;
  return out;
}

function card(c, i) {
  const p = `cards[${i}]`;
  if (!isObj(c)) fail(p, 'must be an object');
  if (!CARD_KINDS.includes(c.kind)) fail(`${p}.kind`, `must be one of ${CARD_KINDS.join(', ')}`);
  const out = { kind: c.kind, title: str(c.title, `${p}.title`, LIMITS.noteTitle, { required: false }) || '' };
  if (c.kind === 'note') out.text = str(c.text, `${p}.text`, LIMITS.noteText);
  else if (c.kind === 'steps') out.items = list(c.items, `${p}.items`, LIMITS.stepItems, { required: true }).map((s, j) => str(s, `${p}.items[${j}]`, LIMITS.stepItem));
  else {
    out.columns = list(c.columns, `${p}.columns`, LIMITS.tableColumns, { required: true }).map((s, j) => str(s, `${p}.columns[${j}]`, LIMITS.tableCell));
    out.rows = list(c.rows, `${p}.rows`, LIMITS.tableRows).map((r, j) => {
      if (!Array.isArray(r)) fail(`${p}.rows[${j}]`, 'must be an array');
      if (r.length > out.columns.length) fail(`${p}.rows[${j}]`, `at most ${out.columns.length} cells`);
      return r.map((s, k) => str(s === undefined || s === null ? '' : s, `${p}.rows[${j}][${k}]`, LIMITS.tableCell, { required: false }));
    });
  }
  return out;
}

function validateDraw(args) {
  if (!isObj(args)) fail('args', 'must be an object');
  const marks = list(args.marks, 'marks', LIMITS.marks).map(mark);
  const cards = list(args.cards, 'cards', LIMITS.cards).map(card);
  return { clear: args.clear === true, marks, cards };
}

function validateWalkthrough(args) {
  if (!isObj(args)) fail('args', 'must be an object');
  const steps = list(args.steps, 'steps', LIMITS.walkSteps, { required: true }).map((s, i) => {
    const p = `steps[${i}]`;
    if (!isObj(s)) fail(p, 'must be an object');
    if (!ACTIONS.includes(s.action)) fail(`${p}.action`, `must be one of ${ACTIONS.join(', ')}`);
    const out = { target: target(s.target, `${p}.target`, { allowSnapshot: i === 0, allowName: true }), say: str(s.say, `${p}.say`, LIMITS.say), action: s.action };
    const app = str(s.expectApp, `${p}.expectApp`, 100, { required: false });
    if (app) out.expectApp = app;
    return out;
  });
  if (!steps.length) fail('steps', 'at least one step required');
  return { title: str(args.title, 'title', 80), steps };
}

module.exports = { MARK_KINDS, CARD_KINDS, LIMITS, validateTarget, validateDraw, validateWalkthrough };

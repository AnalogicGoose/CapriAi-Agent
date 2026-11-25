// Her control room: quick tiles on top, then one-line sections that fold open in place (settings-schema.js).
// Saving goes through settingsHost (settings-preload.js); the main process still validates every change.
import { SettingsQueue } from './settings-queue.js';
import { QUICK, SECTIONS } from './settings-schema.js';

const host = window.settingsHost;
const content = document.querySelector('#content');
let state, openSection = null, view = null, busy = false, previewStyle = 'neutral';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const text = (value, s = state) => typeof value === 'function' ? value(s) : value;
const pathGet = (object, key) => key.split('.').reduce((value, part) => value?.[part], object);
const ROWS = [...QUICK, ...SECTIONS.flatMap(section => section.rows)];
const BY_KEY = new Map(ROWS.flatMap(row => [[row.key, row], ...(row.toggles || []).map(t => [t.key, t])]).filter(([key]) => key));
const shown = row => !row.visible || row.visible(state);
const value = row => row.get ? row.get(state) : pathGet(state.config, row.key);

const ICONS = {
  sound: '<path d="M4 10v4h4l5 4V6L8 10H4Z"/><path d="M16.5 9a4 4 0 0 1 0 6"/>',
  memory: '<rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9 10h6M9 14h4"/>',
  reminders: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7M10 20a2 2 0 0 0 4 0"/>',
  behavior: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  codex: '<path d="m9 15 6-6m-6-2 2-2a5 5 0 0 1 7 7l-2 2m-7-4-3 3a5 5 0 0 0 7 7l2-2"/>',
  app: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
  speaker: '<path d="M4 10v4h4l5 4V6L8 10H4Z"/><path d="M16.5 9a4 4 0 0 1 0 6"/>',
  muted: '<path d="M4 10v4h4l5 4V6L8 10H4Z"/><path d="m16 10 4 4m0-4-4 4"/>',
};
const icon = (name, size = 15) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const switchControl = (row, label) => {
  const attr = row.action ? `data-action-switch="${row.action}"` : `data-key="${esc(row.key)}"`;
  return `<label class="orbit-switch"><input type="checkbox" ${attr} ${value(row) === true ? 'checked' : ''} aria-label="${esc(label)}"><span></span></label>`;
};
const selectControl = (row, label) => {
  const current = value(row), options = text(row.options);
  return `<select class="field" data-key="${esc(row.key)}" aria-label="${esc(label)}">${options.map(([v, t]) =>
    `<option value="${esc(v)}" ${String(v) === String(current ?? '') ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
};
const buttons = row => (row.buttons || []).filter(shown).map(b => {
  const v = b.value ? `data-value="${b.value(state)}"` : '';
  return `<button class="pill ${b.danger ? 'is-danger' : ''} ${b.primary ? 'is-primary' : ''}" data-action="${b.action}" ${v}>${esc(text(b.label))}</button>`;
}).join('');

function control(row, label) {
  switch (row.control) {
    case 'switch': return buttons(row) + switchControl(row, label);
    case 'segment': return `<div class="orbit-segment" role="group" aria-label="${esc(label)}">${row.options.map(([v, t]) =>
      `<button data-segment="${row.key}" data-value="${v}" aria-pressed="${Math.abs((value(row) ?? 0) - v) < .01}">${t}</button>`).join('')}</div>`;
    case 'select': return selectControl(row, label);
    case 'slider': {
      const muted = state.config[row.mute] === true, percent = Math.round((value(row) ?? 0) * 100);
      return `<button class="orbit-icon orbit-icon--30 mute" data-toggle="${row.mute}" aria-pressed="${muted}" aria-label="Mute" title="${muted ? 'Unmute' : 'Mute'}">${icon(muted ? 'muted' : 'speaker', 14)}</button>` +
        `<input type="range" data-key="${row.key}" min="0" max="100" value="${percent}" aria-label="${esc(label)}"><output>${percent}%</output>`;
    }
    case 'text': return `<input class="field" type="text" maxlength="${row.key === 'crunchyrollProfile' ? 80 : 2000}" data-key="${esc(row.key)}" value="${esc(value(row))}" aria-label="${esc(label)}" spellcheck="false">`;
    case 'buttons': return buttons(row);
    case 'toggles': return `<div class="see-chips">${row.toggles.map(t => `<label class="see-chip"><input type="checkbox" data-key="${esc(t.key)}" ${pathGet(state.config, t.key) === true ? 'checked' : ''}><span>${esc(t.label)}</span></label>`).join('')}</div>`;
    case 'preview': return `<select class="field" data-key="previewStyle" aria-label="Voice style">${row.options.map(([v, t]) =>
      `<option value="${v}" ${v === previewStyle ? 'selected' : ''}>${t}</option>`).join('')}</select><button class="pill" data-action="${row.action}">Play</button>`;
    case 'status': return `<span class="value ${state.integration?.lastSeen ? 'is-ok' : ''}">${esc(row.value(state))}</span>`;
    case 'info': return `<span class="value mono">${esc(row.value(state))}</span>`;
    default: return '';
  }
}

function rowHtml(row) {
  if (row.control === 'reminders') return reminderRows();
  const label = text(row.label);
  const stack = ['toggles', 'text'].includes(row.control) ? ' row--stack' : '';
  return `<div class="row${stack}" ${row.tip ? `title="${esc(row.tip)}"` : ''}><span class="row__label">${esc(label)}</span><div class="row__control">${control(row, label)}</div></div>`;
}

function reminderRows() {
  const list = state.reminders || [];
  if (!list.length) return '<p class="empty">Nothing yet. Ask her to remind you of something.</p>';
  return list.map(item => `<div class="row row--reminder"><span class="row__label">${esc(item.text)}<small>${esc(item.next)} · ${esc(item.repeat)}</small></span><div class="row__control">` +
    (item.movable ? `<input type="time" class="field" data-reminder-time="${esc(item.id)}" value="${esc(String(item.next).slice(11, 16))}" aria-label="New time for ${esc(item.text)}">` +
      `<button class="pill" data-reminder-move="${esc(item.id)}" data-date="${esc(String(item.next).slice(0, 10))}">Move</button>` : '') +
    `<button class="pill" data-reminder-cancel="${esc(item.id)}">Cancel</button></div></div>`).join('');
}

function quickHtml() {
  const [gaming, size, desktop] = QUICK;
  return `<div class="quick">` +
    `<div class="tile ${value(gaming) ? 'is-on' : ''}" title="${esc(gaming.tip)}"><span class="tile__text"><b>${gaming.label}</b><small>Hide &amp; pause</small></span>${switchControl(gaming, gaming.label)}</div>` +
    `<div class="tile"><span class="tile__text"><b>${size.label}</b></span>${control(size, size.label)}</div>` +
    `<div class="tile tile--wide"><span class="tile__text"><b>${desktop.label}</b><small>${desktop.tip}</small></span>${buttons(desktop)}</div></div>`;
}

function sectionHtml(section) {
  const open = openSection === section.id;
  const head = `<button class="section__head" data-section="${section.id}" aria-expanded="${open}"><span class="section__icon">${icon(section.icon)}</span>` +
    `<span class="section__label">${esc(section.label)}</span><span class="section__summary">${esc(section.summary(state))}</span><span class="chev" aria-hidden="true">›</span></button>`;
  if (!open) return `<section class="section">${head}</section>`;
  const rows = section.rows.filter(row => !row.deeper && shown(row)).map(rowHtml).join('');
  const deeper = Object.entries(section.deepers || {}).filter(([id]) => section.rows.some(row => row.deeper === id && shown(row)))
    .map(([id, label]) => `<button class="row row--deeper" data-deeper="${id}"><span class="row__label">${esc(label)}</span><span class="chev" aria-hidden="true">›</span></button>`).join('');
  return `<section class="section is-open">${head}<div class="section__body">${rows}${deeper}</div></section>`;
}

function deeperHtml() {
  const section = SECTIONS.find(s => s.deepers?.[view]);
  const rows = section.rows.filter(row => row.deeper === view && shown(row)).map(rowHtml).join('');
  return `<div class="subview"><button class="subview__back" data-back aria-label="Back to ${esc(section.label)}"><span aria-hidden="true">‹</span> ${esc(section.label)}</button>` +
    `<h2 class="subview__title">${esc(section.deepers[view])}</h2><div class="section__body">${rows}</div></div>`;
}

function render() {
  if (!state) return;
  const scrollTop = content.scrollTop, place = `${openSection}/${view}`, samePlace = content.dataset.page === place;
  const active = document.activeElement;
  const focused = content.contains(active) && active?.dataset ? {
    key: active.dataset.key, segment: active.dataset.segment, action: active.dataset.actionSwitch,
    draft: active.type === 'text' ? active.value : null, start: active.selectionStart, end: active.selectionEnd,
  } : null;
  content.dataset.page = place;
  document.querySelector('#status').textContent = state.config.gamingMode ? 'Taking a break' : 'Here with you';
  document.body.classList?.toggle('is-paused', state.config.gamingMode === true);
  content.innerHTML = quickHtml() + (view ? deeperHtml() : `<div class="sections">${SECTIONS.map(sectionHtml).join('')}</div>`);
  if (samePlace) content.scrollTop = scrollTop;
  if (focused && samePlace) {
    const replacement = [...content.querySelectorAll('[data-key], [data-segment], [data-action-switch]')].find(el =>
      focused.key ? el.dataset.key === focused.key : focused.segment ? el.dataset.segment === focused.segment : focused.action && el.dataset.actionSwitch === focused.action);
    if (replacement) {
      if (focused.draft !== null && replacement.type === 'text') {
        replacement.value = focused.draft;
        replacement.setSelectionRange(focused.start, focused.end);
      }
      replacement.focus({ preventScroll: true });
    }
  }
}

function notice(message, error = false) { document.querySelector('#notice').textContent = message; document.querySelector('.statusbar').classList.toggle('error', error); }
const transactions = new SettingsQueue({
  onBusy(active) {
    busy = active;
    if (active) { document.body.setAttribute('aria-busy', 'true'); notice('Saving…'); }
    else document.body.removeAttribute('aria-busy');
  },
  onResult(result, { redraw = true } = {}) {
    if (result?.state) state = result.state; else if (result?.config) state = result;
    if (redraw && transactions.pending === 1) render();
    notice(result?.message || 'Saved.');
  },
  onError(error) {
    notice(String(error.message || error).replace(/^Error invoking remote method .*?: Error: /, ''), true);
    if (transactions.pending === 1) render();
  },
});
const perform = (task, options) => transactions.run(task, options);
const patchKey = (key, v) => perform(() => host.patch(key.startsWith('privacy.') ? { privacy: { [key.slice(8)]: v } } : { [key]: v }));

document.addEventListener('click', event => {
  const target = event.target;
  const section = target.closest('[data-section]');
  if (section) { openSection = openSection === section.dataset.section ? null : section.dataset.section; render(); return; }
  const deeper = target.closest('[data-deeper]');
  if (deeper) { view = deeper.dataset.deeper; render(); content.scrollTop = 0; return; }
  if (target.closest('[data-back]')) { view = null; render(); return; }
  const segment = target.closest('[data-segment]');
  if (segment) { if (segment.dataset.value !== undefined) patchKey(segment.dataset.segment, Number(segment.dataset.value)); return; }
  const toggle = target.closest('[data-toggle]');
  if (toggle) { const key = toggle.dataset.toggle; patchKey(key, !(state.config[key] === true)); return; }
  const cancel = target.closest('[data-reminder-cancel]');
  if (cancel) { const id = Number(cancel.dataset.reminderCancel); perform(() => host.action('reminder-cancel', id)); return; }
  const move = target.closest('[data-reminder-move]');
  if (move) {
    const id = Number(move.dataset.reminderMove), time = content.querySelector(`[data-reminder-time="${id}"]`)?.value;
    if (!time) { notice('Pick a time first.', true); return; }
    perform(() => host.action('reminder-move', { id, at: time, date: move.dataset.date })); return;
  }
  const action = target.closest('[data-action]');
  if (action) {
    const name = action.dataset.action, raw = action.dataset.value;
    perform(() => host.action(name, name === 'voice-preview' ? previewStyle : raw === undefined ? undefined : raw === 'true'));
  }
});
document.addEventListener('input', event => {
  if (event.target.dataset?.key === 'volume') event.target.nextElementSibling.textContent = `${event.target.value}%`;
});
document.addEventListener('change', event => {
  const el = event.target;
  if (el.dataset.actionSwitch) { const name = el.dataset.actionSwitch, checked = el.checked; perform(() => host.action(name, checked)); return; }
  const key = el.dataset.key;
  if (!key) return;
  if (key === 'previewStyle') { previewStyle = el.value; return; }
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (key === 'volume') v = Number(v) / 100;
  else if (BY_KEY.get(key)?.parse) v = BY_KEY.get(key).parse(v);
  patchKey(key, v);
});
document.querySelector('#close').addEventListener('click', () => host.action('close'));
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (view) { view = null; render(); } else host.action('close');
});
host.onUpdate(next => { state = next; if (!busy && !content.contains(document.activeElement)) render(); });
try { state = await host.state(); render(); document.documentElement.dataset.settingsReady = 'true'; }
catch (error) { notice(error.message, true); }

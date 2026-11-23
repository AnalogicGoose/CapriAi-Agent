'use strict';
const path = require('node:path');

// One transparent, click-through, content-protected window per display that has guide content.
// Scenes come from guide-scene.js layoutScene (DIP, relative to each display's top-left).
const defaultPage = path.join(__dirname, '..', 'renderer', 'guide.html');
const defaultPreload = path.join(__dirname, '..', 'guide-preload.js');

const hasContent = (s) => Boolean(s && ((s.marks && s.marks.length) || (s.cards && s.cards.length)));
const sameBounds = (a, b) => ['x', 'y', 'width', 'height'].every((k) => a[k] === b[k]);
const buttonIds = (s) => new Set((s?.cards || []).flatMap((c) => (Array.isArray(c.buttons) ? c.buttons : []).map((b) => b?.id)).filter((id) => typeof id === 'string'));

function createGuideLayer({ BrowserWindow, screen, preload = defaultPreload, page = defaultPage }) {
  const layers = new Map(); // displayId -> { win, bounds, scene, ready }
  const listeners = new Set();

  function drop(displayId) {
    const entry = layers.get(displayId);
    if (!entry) return;
    layers.delete(displayId);
    if (!entry.win.isDestroyed()) entry.win.destroy();
  }

  function create(displayId, bounds) {
    const win = new BrowserWindow({ ...bounds,
      frame: false, transparent: true, show: false, focusable: false, skipTaskbar: true,
      alwaysOnTop: true, hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false,
      backgroundColor: '#00000000',
      webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } });
    win.setIgnoreMouseEvents(true);
    win.setContentProtection(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    const entry = { win, bounds: { ...bounds }, scene: null, ready: false };
    win.on('closed', () => { if (layers.get(displayId) === entry) layers.delete(displayId); });
    // Only this window's own webContents may report card actions, and only for buttons it was given.
    win.webContents.ipc.on('guide:card-action', (event, actionId) => {
      if (layers.get(displayId) !== entry || win.isDestroyed() || event?.sender !== win.webContents) return;
      if (typeof actionId !== 'string' || !buttonIds(entry.scene).has(actionId)) return;
      for (const fn of listeners) fn(displayId, actionId);
    });
    layers.set(displayId, entry);
    entry.loading = win.loadFile(page).then(() => {
      if (win.isDestroyed() || layers.get(displayId) !== entry) return;
      entry.ready = true;
      win.webContents.send('guide:scene', entry.scene);
      win.showInactive();
    }, (error) => {
      if (layers.get(displayId) === entry) drop(displayId);
      throw error;
    });
    return entry;
  }

  function render(sceneMap) {
    const displays = new Map(screen.getAllDisplays().map((d) => [d.id, d]));
    const wanted = new Map();
    for (const [id, s] of sceneMap || []) if (hasContent(s) && displays.has(id)) wanted.set(id, s);
    for (const id of [...layers.keys()]) if (!wanted.has(id)) drop(id);
    const pending = [];
    for (const [id, s] of wanted) {
      const bounds = displays.get(id).bounds;
      let entry = layers.get(id);
      if (entry && entry.win.isDestroyed()) { layers.delete(id); entry = null; }
      if (!entry) entry = create(id, bounds);
      else if (!sameBounds(entry.bounds, bounds)) { entry.win.setBounds({ ...bounds }); entry.bounds = { ...bounds }; }
      entry.scene = s;
      if (entry.ready) entry.win.webContents.send('guide:scene', s);
      else pending.push(entry.loading);
    }
    return Promise.all(pending).then(() => {});
  }

  function clear() {
    for (const id of [...layers.keys()]) drop(id);
  }

  function setCardInteractive(displayId, on) {
    const entry = layers.get(displayId);
    if (!entry || entry.win.isDestroyed()) return;
    if (on) entry.win.setIgnoreMouseEvents(false);
    else entry.win.setIgnoreMouseEvents(true, { forward: true });
  }

  function onCardAction(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { render, clear, setCardInteractive, onCardAction };
}

module.exports = { createGuideLayer };

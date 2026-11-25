'use strict';
const path = require('node:path');
const { BrowserWindow, ipcMain, screen } = require('electron');
const { settingsPatch } = require('./settings-policy');
const { validateReminderAction } = require('./reminder-settings');

function createSettingsWindow({ state, patch, action }) {
  let window, shown = false;
  const trusted = event => window && !window.isDestroyed() && event.sender === window.webContents;
  const reveal = () => { if (!shown && window && !window.isDestroyed()) { shown = true; window.show(); window.focus(); } };
  ipcMain.handle('settings:state', event => { if (!trusted(event)) throw Error('Settings window required.'); return state(); });
  // The page says when its controls are drawn, so the window never appears as an empty frame.
  ipcMain.on('settings:ready', event => { if (trusted(event)) reveal(); });
  ipcMain.handle('settings:patch', async (event, input) => {
    if (!trusted(event)) throw Error('Settings window required.');
    patch(settingsPatch(input, screen.getAllDisplays())); return state();
  });
  ipcMain.handle('settings:action', async (event, name, value) => {
    if (!trusted(event)) throw Error('Settings window required.');
    if (name === 'close') { window.hide(); return; }
    if (!['gaming', 'visibility', 'startup', 'sounds-folder', 'voice-preview', 'memory-export', 'memory-delete', 'memory-open', 'remember-chat', 'clear-recent-chat', 'interests-open', 'reviews-open', 'curiosity-open', 'routines-open', 'initiative-start', 'initiative-open', 'initiative-resume', 'project-choose', 'project-off', 'reminder-cancel', 'reminder-move', 'refresh', 'restart', 'quit'].includes(name)) throw Error('Unknown action.');
    if (['gaming', 'startup', 'remember-chat'].includes(name) && typeof value !== 'boolean') throw Error('Invalid switch.');
    if (name.startsWith('reminder-')) value = validateReminderAction(name, value);
    const result = await action(name, value);
    if (['memory-open', 'interests-open', 'reviews-open', 'curiosity-open', 'routines-open', 'initiative-open'].includes(name)) window.hide();
    return { state: state(), message: typeof result === 'string' ? result : '' };
  });
  return {
    open() {
      if (!window || window.isDestroyed()) {
        const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
        // Small opaque frameless window: Windows 11 rounds its corners and draws the shadow natively.
        // (A transparent window repaints its cursor on every hover transition, which made it flicker.)
        const width = Math.min(380, area.width), height = Math.min(620, area.height);
        window = new BrowserWindow({ width, height, minWidth: Math.min(340, area.width), minHeight: Math.min(400, area.height),
          x: area.x + Math.max(0, Math.round((area.width - width) / 2)), y: area.y + Math.max(0, Math.round((area.height - height) / 2)),
          title: 'Stella — Control room', frame: false, backgroundColor: '#0d0b26', resizable: true, maximizable: false,
          autoHideMenuBar: true, show: false, icon: path.resolve(__dirname, '../../assets/icons/stella.ico'),
          webPreferences: { preload: path.resolve(__dirname, '../settings-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
        });
        shown = false;
        window.setMenu(null);
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        window.webContents.on('will-navigate', e => e.preventDefault());
        window.loadURL('capri://app/src/renderer/settings.html');
        // If the page never reports (an error while drawing), still show it rather than nothing.
        window.webContents.once('did-finish-load', () => setTimeout(reveal, 1500));
        window.on('closed', () => { window = null; });
      } else { window.show(); window.focus(); this.update(); }
    },
    update() { if (window && !window.isDestroyed()) window.webContents.send('settings:updated', state()); },
  };
}
module.exports = { createSettingsWindow };

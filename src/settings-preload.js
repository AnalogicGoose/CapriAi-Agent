'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('settingsHost', {
  state: () => ipcRenderer.invoke('settings:state'),
  ready: () => ipcRenderer.send('settings:ready'),
  patch: input => ipcRenderer.invoke('settings:patch', input),
  action: (name, value) => ipcRenderer.invoke('settings:action', name, value),
  onUpdate: fn => { ipcRenderer.on('settings:updated', (_event, state) => fn(state)); },
});

'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('guideHost', {
  onScene: fn => {
    const listener = (_event, scene) => fn(scene);
    ipcRenderer.on('guide:scene', listener);
    return () => ipcRenderer.removeListener('guide:scene', listener);
  },
  cardAction: id => ipcRenderer.send('guide:card-action', String(id)),
});

'use strict';

// Preload mínimo (D179): sandbox ligado, sem Node na página. Expõe só o necessário por contextBridge.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('skinsDesktop', {
  isDesktop: true,
  getAppInfo: () => ipcRenderer.invoke('desktop:getAppInfo'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:checkForUpdates'),
});

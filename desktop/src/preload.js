'use strict';

// Preload mínimo (D179): sandbox ligado, sem Node na página. Expõe só o necessário por contextBridge.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('skinsDesktop', {
  isDesktop: true,
  getAppInfo: () => ipcRenderer.invoke('desktop:getAppInfo'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:checkForUpdates'),
  // Atualização dentro do app (D188). O renderer só envia { action, seq }; nunca uma URL.
  getUpdateState: () => ipcRenderer.invoke('desktop:getUpdateState'),
  respondToUpdate: (action, seq) => ipcRenderer.invoke('desktop:updateRespond', { action, seq }),
  // O callback recebe só o estado (nunca o `event` do ipcRenderer). Devolve a função que cancela a inscrição.
  onUpdateState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop:updateState', listener);
    return () => ipcRenderer.removeListener('desktop:updateState', listener);
  },
});

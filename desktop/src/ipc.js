'use strict';

// IPC (D179): só canais fixos, e só atendem páginas da origem do app.
const { ipcMain } = require('electron');
const { isSameOrigin } = require('./lib/navigationPolicy');

function registerIpc({ getAppOrigin, getAppInfo, checkForUpdates }) {
  const guard = (event) => {
    const url = event.senderFrame && event.senderFrame.url;
    if (!isSameOrigin(url, getAppOrigin())) {
      throw new Error('Origem não autorizada.');
    }
  };

  ipcMain.handle('desktop:getAppInfo', (event) => {
    guard(event);
    return getAppInfo();
  });

  if (typeof checkForUpdates === 'function') {
    ipcMain.handle('desktop:checkForUpdates', async (event) => {
      guard(event);
      return checkForUpdates();
    });
  }
}

module.exports = { registerIpc };

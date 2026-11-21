'use strict';

// IPC (D179): só canais fixos, e só atendem páginas da origem do app.
const { ipcMain } = require('electron');
const { isSameOrigin } = require('./lib/navigationPolicy');

function registerIpc({ getAppOrigin, getAppInfo }) {
  ipcMain.handle('desktop:getAppInfo', (event) => {
    const url = event.senderFrame && event.senderFrame.url;
    if (!isSameOrigin(url, getAppOrigin())) {
      throw new Error('Origem não autorizada.');
    }
    return getAppInfo();
  });
}

module.exports = { registerIpc };

'use strict';

// IPC (D179, D188): só canais fixos, e só atendem páginas da origem do app.
const { ipcMain } = require('electron');
const { isSameOrigin } = require('./lib/navigationPolicy');
const { parseRespondPayload } = require('./lib/updateState');

const UPDATE_STATE_CHANNEL = 'desktop:updateState';

// Envio do estado da atualização ao renderer (main -> renderer). Só envia se a janela está numa página da origem do
// app (não na tela de carregamento nem numa página de erro); nesse caso o renderer busca o estado ao montar.
function createStatePublisher({ getWebContents, getAppOrigin }) {
  return function publishState(state) {
    const webContents = getWebContents();
    if (!webContents || (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed())) return false;
    if (!isSameOrigin(webContents.getURL(), getAppOrigin())) return false;
    webContents.send(UPDATE_STATE_CHANNEL, state);
    return true;
  };
}

function registerIpc({
  getAppOrigin,
  getAppInfo,
  checkForUpdates,
  getUpdateState,
  respondToUpdate,
  getMainWebContents = () => null,
}) {
  const guard = (event) => {
    const url = event.senderFrame && event.senderFrame.url;
    if (!isSameOrigin(url, getAppOrigin())) {
      throw new Error('Origem não autorizada.');
    }
  };

  // Os canais de atualização exigem, além da origem, que o remetente seja a janela principal.
  const guardMainWindow = (event) => {
    guard(event);
    const main = getMainWebContents();
    if (!main || event.sender !== main) throw new Error('Remetente não autorizado.');
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

  if (typeof getUpdateState === 'function') {
    ipcMain.handle('desktop:getUpdateState', (event) => {
      guardMainWindow(event);
      return getUpdateState();
    });
  }

  if (typeof respondToUpdate === 'function') {
    ipcMain.handle('desktop:updateRespond', (event, payload) => {
      guardMainWindow(event);
      const parsed = parseRespondPayload(payload); // só { action, seq }; campos extras (como `url`) são descartados
      if (!parsed) return { accepted: false, state: getUpdateState ? getUpdateState() : null };
      return respondToUpdate(parsed);
    });
  }
}

module.exports = { registerIpc, createStatePublisher, UPDATE_STATE_CHANNEL };

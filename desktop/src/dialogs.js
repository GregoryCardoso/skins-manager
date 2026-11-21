'use strict';

// Diálogos nativos do app desktop (D178, D179). Cada função devolve a escolha do usuário como texto.
const { dialog } = require('electron');
const { translate } = require('./i18n');

async function ask({ parent, language, type = 'error', titleKey, message, detail, buttons }) {
  // buttons: [{ id, label }]; o último é o botão de cancelar/fechar.
  const options = {
    type,
    title: translate(language, titleKey),
    message,
    detail: detail || undefined,
    buttons: buttons.map((button) => button.label),
    defaultId: 0,
    cancelId: buttons.length - 1,
    noLink: true,
  };
  const result = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  return buttons[result.response].id;
}

// Erro de inicialização do backend (fatal, timeout ou saída antes do ready). `browserUrl`: só quando o
// start-app.bat está com a pasta de dados aberta (DATA_DIR_LOCKED).
function showStartFailure({ parent, language, code, message, browserUrl }) {
  let text = message;
  if (!text) text = translate(language, code === 'START_TIMEOUT' ? 'startFailure.timeout' : 'startFailure.exited');
  const buttons = [{ id: 'open-data', label: translate(language, 'common.openDataFolder') }];
  if (browserUrl) buttons.push({ id: 'open-browser', label: translate(language, 'common.openInBrowser') });
  buttons.push({ id: 'close', label: translate(language, 'common.close') });
  return ask({ parent, language, titleKey: 'startFailure.title', message: translate(language, 'startFailure.message'), detail: text, buttons });
}

// A 3001 já é o Skins Manager aberto pelo start-app.bat (D174).
function showAlreadyOpen({ parent, language, port }) {
  return ask({
    parent,
    language,
    type: 'info',
    titleKey: 'alreadyOpen.title',
    message: translate(language, 'alreadyOpen.message', { port }),
    detail: translate(language, 'alreadyOpen.detail'),
    buttons: [
      { id: 'open-browser', label: translate(language, 'common.openInBrowser') },
      { id: 'close', label: translate(language, 'common.close') },
    ],
  });
}

function showNoFreePort({ parent, language }) {
  return ask({
    parent,
    language,
    titleKey: 'noPort.title',
    message: translate(language, 'noPort.message'),
    detail: translate(language, 'noPort.detail'),
    buttons: [{ id: 'close', label: translate(language, 'common.close') }],
  });
}

// Estourou o limite de reinícios (D178).
function showCrashLoop({ parent, language, dataDir }) {
  return ask({
    parent,
    language,
    titleKey: 'crashLoop.title',
    message: translate(language, 'crashLoop.message'),
    detail: translate(language, 'crashLoop.detail', { dataDir }),
    buttons: [
      { id: 'retry', label: translate(language, 'crashLoop.retry') },
      { id: 'open-logs', label: translate(language, 'common.openLogsFolder') },
      { id: 'close', label: translate(language, 'common.close') },
    ],
  });
}

function showStageMissing({ language }) {
  return ask({
    language,
    titleKey: 'stageMissing.title',
    message: translate(language, 'stageMissing.message'),
    buttons: [{ id: 'close', label: translate(language, 'common.close') }],
  });
}

function showRenderGone({ parent, language }) {
  return ask({
    parent,
    language,
    titleKey: 'renderGone.title',
    message: translate(language, 'renderGone.message'),
    buttons: [{ id: 'close', label: translate(language, 'common.close') }],
  });
}

module.exports = { showStartFailure, showAlreadyOpen, showNoFreePort, showCrashLoop, showStageMissing, showRenderGone };

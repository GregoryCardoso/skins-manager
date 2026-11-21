'use strict';

// Janela principal e segurança do Electron (D179).
const path = require('path');
const { app, BrowserWindow, session, shell } = require('electron');
const { classify } = require('./lib/navigationPolicy');

const LOADING_PAGE = path.join(__dirname, 'loading.html');
const RENDER_GONE_WINDOW_MS = 60 * 1000;

// Navegação (will-navigate, will-redirect, janelas novas) e recursos que a página não deve ter.
// `getAppOrigin` devolve `http://localhost:<porta>` (ou null antes do backend subir).
function installGlobalGuards({ getAppOrigin, logger }) {
  const openExternal = (url) => {
    // Só chega aqui o que a política classificou como 'external' (https:// e steam://rungame/730).
    shell.openExternal(url).catch((err) => logger.error(`Falha ao abrir link externo: ${err && err.message ? err.message : err}`));
  };

  const decide = (url) => {
    const origin = getAppOrigin();
    return origin ? classify(url, origin) : 'block';
  };

  app.on('web-contents-created', (event, contents) => {
    contents.on('will-attach-webview', (attachEvent) => attachEvent.preventDefault());

    const guard = (navEvent, url) => {
      const action = decide(url);
      if (action === 'allow') return;
      navEvent.preventDefault();
      if (action === 'external') openExternal(url);
      else logger.info(`Navegação bloqueada: ${url}`);
    };
    contents.on('will-navigate', (navEvent, url) => guard(navEvent, url));
    contents.on('will-redirect', (navEvent, url) => guard(navEvent, url));

    // Nunca abre janela nova; o que for externo vai para o navegador padrão.
    contents.setWindowOpenHandler(({ url }) => {
      const action = decide(url);
      if (action === 'external') openExternal(url);
      else logger.info(`Janela nova bloqueada: ${url}`);
      return { action: 'deny' };
    });
  });
}

function installSessionSecurity() {
  const { defaultSession } = session;
  defaultSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
  defaultSession.setPermissionCheckHandler(() => false);
}

function createMainWindow({ logger, onRenderGoneTwice, now = () => Date.now() }) {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Skins Manager',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  win.removeMenu();
  win.once('ready-to-show', () => win.show());

  // F5 / Ctrl+R recarregam; Ctrl+Shift+I só fora do empacotado (sem menu, não há atalhos prontos).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key).toLowerCase();
    if (key === 'f5' || (input.control && !input.shift && key === 'r')) {
      event.preventDefault();
      win.webContents.reload();
    } else if (!app.isPackaged && input.control && input.shift && key === 'i') {
      event.preventDefault();
      win.webContents.toggleDevTools();
    }
  });

  // Processo da página caiu: recarrega uma vez; de novo em 1 minuto -> avisa (D178).
  let lastRenderGoneAt = null;
  win.webContents.on('render-process-gone', (event, details) => {
    logger.error(`Processo da janela caiu (${details && details.reason}).`);
    const at = now();
    const repeated = lastRenderGoneAt !== null && at - lastRenderGoneAt < RENDER_GONE_WINDOW_MS;
    lastRenderGoneAt = at;
    if (repeated) onRenderGoneTwice();
    else win.webContents.reload();
  });

  return win;
}

function showLoading(win) {
  return win.loadFile(LOADING_PAGE);
}

function focusWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

module.exports = { createMainWindow, installGlobalGuards, installSessionSecurity, showLoading, focusWindow, openExternalUrl: (url) => shell.openExternal(url) };

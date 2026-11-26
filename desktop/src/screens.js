'use strict';

// Telas de início e de erro dentro da própria janela (12.10, parte 2; substitui o uso direto de dialogs.js).
// As funções têm as mesmas assinaturas de dialogs.js e devolvem Promise<id do botão>. Se não há janela, ou se a página
// (loading.html) não abre em `readyTimeoutMs`, cai no diálogo nativo de dialogs.js. `showStageMissing` fica nativo
// (acontece antes da janela e só no modo dev).
const path = require('path');
const { translate } = require('./i18n');
const { isAllowedChoice, isScreenSender } =require('./lib/screenPolicy');

const SCREEN_STATE_CHANNEL = 'desktop:screenState';
const LOADING_FILE = path.join(__dirname, 'loading.html');
const READY_TIMEOUT_MS = 3000;
const LOADING_STATE = Object.freeze({ kind: 'loading', buttons: [] });

function createScreens({ dialogs, loadingFile = LOADING_FILE, readyTimeoutMs = READY_TIMEOUT_MS, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, isLoadingUrl = (url) => isScreenSender(url, loadingFile), logger = null }) {
  let current = null; // estado mostrado agora (null = carregamento)
  let resolver = null; // resolve a Promise da tela que espera uma escolha
  let ready = false; // a página já pediu o estado depois da última navegação
  let readyTimer = null;
  let theme = null;

  const alive = (win) => win && !(typeof win.isDestroyed === 'function' && win.isDestroyed());
  const log = (text) => {
    if (logger && typeof logger.info === 'function') logger.info(text);
  };

  function onLoadingPage(win) {
    try {
      return Boolean(isLoadingUrl(win.webContents.getURL()));
    } catch (err) {
      return false;
    }
  }

  function push(win) {
    if (!alive(win) || !win.webContents || (typeof win.webContents.isDestroyed === 'function' && win.webContents.isDestroyed())) return;
    try {
      win.webContents.send(SCREEN_STATE_CHANNEL, current || LOADING_STATE);
    } catch (err) {
      // a página pede o estado sozinha ao abrir
    }
  }

  function buildState({ language, kind = 'error', titleKey, message, detail, technical, buttons }) {
    return {
      kind,
      lang: language,
      theme,
      title: translate(language, titleKey),
      message,
      detail: detail || undefined,
      technical: technical || undefined,
      technicalLabel: translate(language, 'common.technicalDetails'),
      regionLabel: kind === 'error' ? translate(language, 'screen.errorRegion') : translate(language, titleKey),
      buttons: buttons.map((button, index) => ({ id: button.id, label: button.label, primary: index === 0 })),
    };
  }

  // Chamado pela página (desktop:screenState). Ela estar pedindo o estado = a página abriu.
  function getState() {
    ready = true;
    clearTimeoutFn(readyTimer);
    readyTimer = null;
    return current || LOADING_STATE;
  }

  // Chamado pela página (desktop:screenChoice). Só aceita o que o estado atual oferece e enquanto alguém espera.
  function choose(id) {
    if (!resolver || !isAllowedChoice(current, id)) return { ok: false };
    const finish = resolver;
    resolver = null;
    finish(id);
    return { ok: true };
  }

  function show(win, state, native) {
    if (!alive(win) || !isLoadingUrl) return native();
    if (resolver) {
      const previous = resolver; // uma tela nova substitui a que ficou esperando
      resolver = null;
      previous('close');
    }
    current = state;
    return new Promise((resolve) => {
      let done = false;
      const settle = (id) => {
        if (done) return;
        done = true;
        clearTimeoutFn(readyTimer);
        readyTimer = null;
        resolve(id);
      };
      const fallback = (reason) => {
        if (done) return;
        log(`Tela dentro da janela indisponível (${reason}); usando o diálogo nativo.`);
        resolver = null;
        current = null;
        clearTimeoutFn(readyTimer);
        readyTimer = null;
        done = true;
        Promise.resolve()
          .then(native)
          .then(resolve, () => resolve('close'));
      };
      resolver = settle;

      try {
        if (!win.isVisible()) win.show();
        if (!onLoadingPage(win)) {
          ready = false;
          Promise.resolve(win.loadFile(loadingFile)).catch((err) => fallback(err && err.message ? err.message : 'loadFile'));
        } else if (ready) {
          push(win);
        }
      } catch (err) {
        fallback(err && err.message ? err.message : 'erro');
        return;
      }
      if (!ready) {
        readyTimer = setTimeoutFn(() => fallback('a página não abriu a tempo'), readyTimeoutMs);
      }
    });
  }

  // Volta ao "Iniciando..." (por exemplo, depois de "Tentar de novo").
  function showLoading(win) {
    current = null;
    if (alive(win) && ready && onLoadingPage(win)) push(win);
  }

  return {
    setTheme(value) {
      theme = typeof value === 'string' ? value.toLowerCase() : null;
    },
    getState,
    choose,
    showLoading,

    showStartFailure({ parent, language, code, message, browserUrl }) {
      let text = message;
      if (!text) text = translate(language, code === 'START_TIMEOUT' ? 'startFailure.timeout' : 'startFailure.exited');
      const technical = [code, message].filter(Boolean).join('\n');
      const buttons = [
        { id: 'retry', label: translate(language, 'common.retry') },
        { id: 'open-logs', label: translate(language, 'common.openLogsFolder') },
        { id: 'open-data', label: translate(language, 'common.openDataFolder') },
      ];
      if (browserUrl) buttons.push({ id: 'open-browser', label: translate(language, 'common.openInBrowser') });
      buttons.push({ id: 'close', label: translate(language, 'common.close') });
      const state = buildState({ language, titleKey: 'startFailure.title', message: translate(language, 'startFailure.message'), detail: text, technical, buttons });
      return show(parent, state, () => dialogs.showStartFailure({ parent, language, code, message, browserUrl }));
    },

    showAlreadyOpen({ parent, language, port }) {
      const state = buildState({
        language,
        kind: 'info',
        titleKey: 'alreadyOpen.title',
        message: translate(language, 'alreadyOpen.message', { port }),
        detail: translate(language, 'alreadyOpen.detail'),
        buttons: [
          { id: 'open-browser', label: translate(language, 'common.openInBrowser') },
          { id: 'close', label: translate(language, 'common.close') },
        ],
      });
      return show(parent, state, () => dialogs.showAlreadyOpen({ parent, language, port }));
    },

    showNoFreePort({ parent, language }) {
      const state = buildState({
        language,
        titleKey: 'noPort.title',
        message: translate(language, 'noPort.message'),
        detail: translate(language, 'noPort.detail'),
        buttons: [{ id: 'close', label: translate(language, 'common.close') }],
      });
      return show(parent, state, () => dialogs.showNoFreePort({ parent, language }));
    },

    showCrashLoop({ parent, language, dataDir }) {
      const state = buildState({
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
      return show(parent, state, () => dialogs.showCrashLoop({ parent, language, dataDir }));
    },

    showRenderGone({ parent, language }) {
      const state = buildState({
        language,
        titleKey: 'renderGone.title',
        message: translate(language, 'renderGone.message'),
        buttons: [{ id: 'close', label: translate(language, 'common.close') }],
      });
      return show(parent, state, () => dialogs.showRenderGone({ parent, language }));
    },

    showStageMissing: (options) => dialogs.showStageMissing(options),
  };
}

module.exports = { createScreens, SCREEN_STATE_CHANNEL, LOADING_FILE, READY_TIMEOUT_MS };

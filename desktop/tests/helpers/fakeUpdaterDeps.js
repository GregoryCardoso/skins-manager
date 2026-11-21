'use strict';

// Dependências falsas para testar updater.js sem Electron nem rede.
const { EventEmitter } = require('events');

function makeAutoUpdater({ checkResult, checkError, downloadError } = {}) {
  const au = new EventEmitter();
  au.checkForUpdates = jest.fn(async () => {
    if (checkError) throw checkError;
    return checkResult;
  });
  au.downloadUpdate = jest.fn(async () => {
    if (downloadError) throw downloadError;
    return [];
  });
  au.quitAndInstall = jest.fn();
  return au;
}

function makeDeps(overrides = {}) {
  const calls = [];
  const autoUpdater = overrides.autoUpdater || makeAutoUpdater();
  const states = []; // cada estado publicado para a interface, em ordem
  const clock = { now: 1000 };
  const shell = { openExternal: jest.fn(async () => {}) };
  const win = { isDestroyed: () => false, setProgressBar: jest.fn() };
  autoUpdater.quitAndInstall.mockImplementation((...args) => calls.push(['quitAndInstall', ...args]));
  const deps = {
    app: { isPackaged: true, getVersion: () => '1.0.0', ...(overrides.app || {}) },
    shell,
    publishState: jest.fn((state) => states.push(state)),
    getWindow: () => win,
    stopBackend: jest.fn(async () => {
      calls.push(['stopBackend']);
    }),
    logger: { info: jest.fn(), error: jest.fn() },
    env: {},
    loadAutoUpdater: jest.fn(() => autoUpdater),
    fetchLatest: jest.fn(async () => ({})),
    // sem rede por padrão: as notas vêm do texto do feed (reserva); os testes de notas trocam isto
    fetchJson: jest.fn(async () => {
      throw new Error('sem rede');
    }),
    nowFn: () => clock.now,
    setTimeoutFn: jest.fn(() => ({ unref() {} })),
    ...(overrides.deps || {}),
  };
  return { deps, autoUpdater, shell, win, calls, states, clock };
}

// Deixa os fluxos em segundo plano (runDetached) terminarem.
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

// Responde ao modal como a interface faz: a ação com o `seq` do estado atual.
const answer = (updater, action) => updater.respond({ action, seq: updater.getState().seq });

// Verifica, aceita o download e espera terminar: deixa o estado em `ready`.
async function downloadToReady(updater) {
  await updater.check({ manual: true });
  answer(updater, 'download');
  await flush();
}

module.exports = { makeAutoUpdater, makeDeps, flush, answer, downloadToReady };

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
  const dialogs = {
    showUpdateAvailable: jest.fn(async () => 'later'),
    showUpdateReady: jest.fn(async () => 'on-quit'),
    showUpdateError: jest.fn(async () => 'close'),
    showPortableUpdate: jest.fn(async () => 'close'),
    ...(overrides.dialogs || {}),
  };
  const shell = { openExternal: jest.fn(async () => {}) };
  const win = { isDestroyed: () => false, setProgressBar: jest.fn() };
  autoUpdater.quitAndInstall.mockImplementation((...args) => calls.push(['quitAndInstall', ...args]));
  const deps = {
    app: { isPackaged: true, getVersion: () => '1.0.0', ...(overrides.app || {}) },
    shell,
    dialogs,
    getLanguage: async () => 'pt-BR',
    getWindow: () => win,
    stopBackend: jest.fn(async () => {
      calls.push(['stopBackend']);
    }),
    logger: { info: jest.fn(), error: jest.fn() },
    env: {},
    loadAutoUpdater: jest.fn(() => autoUpdater),
    fetchLatest: jest.fn(async () => ({})),
    setTimeoutFn: jest.fn(() => ({ unref() {} })),
    ...(overrides.deps || {}),
  };
  return { deps, autoUpdater, dialogs, shell, win, calls };
}

// Deixa os fluxos em segundo plano (runDetached) terminarem.
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

module.exports = { makeAutoUpdater, makeDeps, flush };

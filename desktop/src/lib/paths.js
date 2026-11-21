'use strict';

// Caminhos do app desktop. Puro: plataforma, ambiente e pastas chegam por parâmetro.
const path = require('path');
const os = require('os');

const APP_DIR_NAME = 'SkinsManager'; // igual a backend/src/config/paths.js (D171)

// %APPDATA%\SkinsManager (Windows) ou ~/.skins-manager (só desenvolvimento fora do Windows).
function resolveDataDir({ platform = process.platform, env = process.env, homedir = os.homedir() } = {}) {
  if (platform === 'win32') {
    const appData = typeof env.APPDATA === 'string' ? env.APPDATA.trim() : '';
    const base = appData !== '' ? appData : path.win32.join(homedir, 'AppData', 'Roaming');
    return path.win32.join(base, APP_DIR_NAME);
  }
  return path.posix.join(homedir, '.skins-manager');
}

// Subpastas e arquivos dentro da pasta de dados (D171). `join` segue o estilo do próprio `dataDir`.
function resolveDataPaths(dataDir) {
  const join = /^[A-Za-z]:\\/.test(dataDir) ? path.win32.join : path.posix.join;
  return {
    dataDir,
    dbPath: join(dataDir, 'inventory.sqlite'),
    logsDir: join(dataDir, 'logs'),
    electronDir: join(dataDir, 'electron'),
    lockPath: join(dataDir, 'skins-manager.lock'),
  };
}

// Onde estão o backend e o frontend: `desktop/.stage` em desenvolvimento, `<resources>/app` empacotado (7.4).
function resolveAppRoot({ isPackaged, resourcesPath, desktopDir }) {
  return isPackaged ? path.join(resourcesPath, 'app') : path.join(desktopDir, '.stage');
}

function resolveAppPaths(appRoot) {
  return {
    root: appRoot,
    backendEntry: path.join(appRoot, 'backend', 'server.js'),
    backendDir: path.join(appRoot, 'backend'),
    frontendIndex: path.join(appRoot, 'frontend', 'out', 'index.html'),
  };
}

module.exports = { resolveDataDir, resolveDataPaths, resolveAppRoot, resolveAppPaths, APP_DIR_NAME };

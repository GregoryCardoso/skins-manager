'use strict';

// Pasta de dados padrão (D171). Pura: recebe plataforma, ambiente e pasta do usuário por parâmetro.
const path = require('path');
const os = require('os');

const APP_DIR_NAME = 'SkinsManager';
const POSIX_DIR_NAME = '.skins-manager'; // fora do Windows (só CI/desenvolvimento)

function resolveDefaultDataDir({ platform = process.platform, env = process.env, homedir = os.homedir() } = {}) {
  if (platform === 'win32') {
    const appData = typeof env.APPDATA === 'string' ? env.APPDATA.trim() : '';
    const base = appData !== '' ? appData : path.win32.join(homedir, 'AppData', 'Roaming');
    return path.win32.join(base, APP_DIR_NAME);
  }
  return path.posix.join(homedir, POSIX_DIR_NAME);
}

module.exports = { resolveDefaultDataDir, APP_DIR_NAME };

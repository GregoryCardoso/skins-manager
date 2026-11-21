'use strict';

// Trava de instância sobre a pasta de dados (D173). Uma segunda instância sobre a mesma pasta é recusada;
// a trava de um processo morto (ou ilegível) é considerada velha e sobrescrita.
const fs = require('fs');
const path = require('path');
const { AppError } = require('../errors/AppError');

const LOCK_FILE_NAME = 'skins-manager.lock';

// Pura. `content`: texto do arquivo; `isAlive(pid)`: injetada. Devolve { stale: true } ou { stale: false, info }.
function assessExistingLock(content, isAlive) {
  let info;
  try {
    info = JSON.parse(String(content));
  } catch (err) {
    return { stale: true };
  }
  if (info === null || typeof info !== 'object' || !Number.isInteger(info.pid) || info.pid <= 0) return { stale: true };
  return isAlive(info.pid) ? { stale: false, info } : { stale: true };
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return Boolean(err && err.code === 'EPERM');
  }
}

function lockedMessage(info) {
  if (info && info.mode === 'desktop') return 'O Skins Manager já está aberto pelo app desktop.';
  const where = info && Number.isInteger(info.port) ? ` em http://localhost:${info.port}` : '';
  return `O Skins Manager já está aberto pelo start-app.bat${where}. Feche aquela janela.`;
}

// Cria a trava. Devolve { release }. Lança AppError DATA_DIR_LOCKED se outra instância viva a detém.
function acquireLock(dataDir, { pid = process.pid, port, mode = 'browser', version, now = new Date(), isAlive = isProcessAlive } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const lockPath = path.join(dataDir, LOCK_FILE_NAME);
  const payload = JSON.stringify({ pid, port, mode, startedAt: now.toISOString(), version });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      fs.writeFileSync(lockPath, payload, { flag: 'wx' });
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        try {
          // só remove se ainda for a nossa trava
          const current = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
          if (current && current.pid === pid) fs.rmSync(lockPath, { force: true });
        } catch (err) {
          // já removida ou ilegível: nada a fazer
        }
      };
      return { release, lockPath };
    } catch (err) {
      if (!err || err.code !== 'EEXIST') throw err;
    }
    let content = '';
    try {
      content = fs.readFileSync(lockPath, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') continue; // sumiu entre as chamadas: tenta de novo
      throw err;
    }
    const verdict = assessExistingLock(content, isAlive);
    if (!verdict.stale) {
      throw new AppError(409, 'DATA_DIR_LOCKED', lockedMessage(verdict.info));
    }
    fs.rmSync(lockPath, { force: true });
  }
  throw new AppError(409, 'DATA_DIR_LOCKED', 'Não foi possível obter a trava da pasta de dados. Tente de novo.');
}

module.exports = { acquireLock, assessExistingLock, isProcessAlive, LOCK_FILE_NAME };

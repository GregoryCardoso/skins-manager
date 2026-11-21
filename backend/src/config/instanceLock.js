'use strict';

// Trava de instância sobre a pasta de dados (D173). Uma segunda instância sobre a mesma pasta é recusada;
// a trava de um processo morto (ou ilegível) é considerada velha e sobrescrita.
const fs = require('fs');
const path = require('path');
const { AppError } = require('../errors/AppError');
const { APP_NAME } = require('./appInfo');

const LOCK_FILE_NAME = 'skins-manager.lock';
// Uma trava recém-criada pode ser de uma instância ainda subindo (migração, banco, listen): não é sondada.
const STARTUP_GRACE_MS = 30 * 1000;
const PROBE_TIMEOUT_MS = 1000;

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

// Pergunta à porta gravada na trava se quem responde é o Skins Manager (só 127.0.0.1, timeout curto).
// O PID pode ter sido reaproveitado por outro programa depois de queda ou falta de energia.
async function probeSkinsManager(info, { fetchFn = fetch, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  if (!info || !Number.isInteger(info.port) || info.port <= 0 || info.port > 65535) return false;
  try {
    const res = await fetchFn(`http://127.0.0.1:${info.port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res || !res.ok) return false;
    const body = await res.json();
    return Boolean(body && body.data && body.data.app === APP_NAME);
  } catch (err) {
    return false;
  }
}

// Remove a trava cujo PID está vivo mas que não é mais o Skins Manager (PID reaproveitado).
// Trava ilegível ou de PID morto fica para o acquireLock tratar. Devolve true se removeu.
async function removeStaleLockByProbe(dataDir, { isAlive = isProcessAlive, probe = probeSkinsManager, now = new Date(), pid = process.pid } = {}) {
  const lockPath = path.join(dataDir, LOCK_FILE_NAME);
  let info;
  try {
    info = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (err) {
    return false;
  }
  if (info === null || typeof info !== 'object' || !Number.isInteger(info.pid) || info.pid <= 0) return false;
  if (info.pid === pid || !isAlive(info.pid)) return false;
  const startedMs = Date.parse(info.startedAt);
  const ageMs = now.getTime() - startedMs;
  // Trava recente: não sonda (a outra instância pode ainda estar subindo). Idade levemente negativa também é
  // recente: duas instâncias abrindo juntas leem a trava uma da outra com o horário de quem a criou alguns ms
  // "no futuro". Só uma trava muito no futuro (relógio do Windows voltou) deixa de ser protegida e é sondada.
  if (Number.isFinite(ageMs) && ageMs > -STARTUP_GRACE_MS && ageMs < STARTUP_GRACE_MS) return false;
  if (await probe(info)) return false;
  fs.rmSync(lockPath, { force: true });
  return true;
}

// Versão assíncrona: primeiro descarta a trava de PID reaproveitado, depois adquire normalmente.
async function acquireLockVerified(dataDir, options = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  await removeStaleLockByProbe(dataDir, {
    isAlive: options.isAlive,
    probe: options.probe,
    now: options.now,
    pid: options.pid,
  });
  const { probe, ...rest } = options;
  return acquireLock(dataDir, rest);
}

function lockedMessage(info) {
  if (info && info.mode === 'desktop') return 'O Skins Manager já está aberto pelo app desktop.';
  const where = info && Number.isInteger(info.port) ? ` em http://localhost:${info.port}` : '';
  return `O Skins Manager já está aberto pelo start-app.bat${where}. Feche aquela janela.`;
}

// Cria a trava. Devolve { release }. Lança AppError DATA_DIR_LOCKED se outra instância viva a detém.
// Publica a trava já com o conteúdo completo: grava num temporário e cria a trava com link (atômico, falha com
// EEXIST se ela já existir). Com `wx` direto, outra instância podia ler o arquivo ainda vazio, achá-lo "ilegível"
// (velho) e apagá-lo, e as duas ficavam com a trava. Sem suporte a link (ex.: FAT32), volta ao `wx`.
function publishLockFile(lockPath, payload, pid) {
  const tmpPath = `${lockPath}.${pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, payload, { flag: 'wx' });
  try {
    fs.linkSync(tmpPath, lockPath);
  } catch (err) {
    if (err && err.code === 'EEXIST') throw err;
    fs.writeFileSync(lockPath, payload, { flag: 'wx' });
  } finally {
    fs.rmSync(tmpPath, { force: true });
  }
}

function acquireLock(dataDir, { pid = process.pid, port, mode = 'browser', version, now = new Date(), isAlive = isProcessAlive } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const lockPath = path.join(dataDir, LOCK_FILE_NAME);
  const payload = JSON.stringify({ pid, port, mode, startedAt: now.toISOString(), version });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      publishLockFile(lockPath, payload, pid);
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

module.exports = { acquireLock, acquireLockVerified, removeStaleLockByProbe, probeSkinsManager, STARTUP_GRACE_MS, assessExistingLock, isProcessAlive, LOCK_FILE_NAME };

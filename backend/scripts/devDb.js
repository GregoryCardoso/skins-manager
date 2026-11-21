'use strict';

// Banco de exemplo para desenvolvimento (D108). NUNCA abre nem toca o banco real (%APPDATA%\SkinsManager\inventory.sqlite nem o antigo data/inventory.sqlite).
// Este módulo só usa `fs`, `path` e `dotenv`; não carrega nada de `src/` (o `DB_PATH` precisa ser definido antes).
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const BACKEND_DIR = path.join(__dirname, '..');
const { resolveDefaultDataDir } = require('../src/config/paths'); // módulo puro: não abre banco nem lê o .env
const LEGACY_REAL_DB_PATH = path.join(BACKEND_DIR, 'data', 'inventory.sqlite');
const DEFAULT_REAL_DB_PATH = path.join(resolveDefaultDataDir(), 'inventory.sqlite'); // D171
const DEV_DB_PATH = path.join(BACKEND_DIR, 'data', 'inventory.dev.sqlite');
const MEMORY = ':memory:';

// Caminho absoluto sem diferenciar maiúsculas/minúsculas nem tipo de barra (Windows); resolve links quando existe.
function canonicalPath(p) {
  let abs = path.resolve(BACKEND_DIR, String(p));
  try {
    abs = fs.realpathSync.native(abs);
  } catch (err) {
    // arquivo ainda não existe: usa o caminho resolvido
  }
  return path.normalize(abs).toLowerCase();
}

function sameFileOnDisk(a, b) {
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    return sa.ino !== 0 && sa.ino === sb.ino && sa.dev === sb.dev;
  } catch (err) {
    return false;
  }
}

function isSamePath(a, b) {
  if (a === MEMORY || b === MEMORY) return a === b;
  return canonicalPath(a) === canonicalPath(b) || sameFileOnDisk(path.resolve(BACKEND_DIR, a), path.resolve(BACKEND_DIR, b));
}

// Caminhos que o app usa como banco real: o padrão e o `DB_PATH` do backend/.env (lido sem alterar o ambiente).
function resolveRealDbPaths({ envFile = path.join(BACKEND_DIR, '.env'), env = process.env } = {}) {
  const paths = [DEFAULT_REAL_DB_PATH, LEGACY_REAL_DB_PATH];
  const add = (value) => {
    if (typeof value === 'string' && value.trim() !== '' && value.trim() !== MEMORY) {
      paths.push(path.resolve(BACKEND_DIR, value.trim()));
    }
  };
  try {
    add(dotenv.parse(fs.readFileSync(envFile, 'utf8')).DB_PATH);
  } catch (err) {
    // sem .env: só o padrão
  }
  add(env.DB_PATH);
  return paths;
}

function seedError(message) {
  return new Error(message);
}

// Garante que o alvo é seguro. Lança erro claro; nunca há exceção para o banco real.
function assertSafeTarget(target, { realDbPaths = resolveRealDbPaths(), allowMemory = false } = {}) {
  if (target === MEMORY) {
    if (!allowMemory) throw seedError('O seed:dev não grava em ":memory:" (os dados sumiriam ao terminar).');
    return target;
  }
  for (const real of realDbPaths) {
    if (isSamePath(target, real)) {
      throw seedError(`Recusado: "${target}" é o banco real do Skins Manager. O seed:dev só grava em ${path.basename(DEV_DB_PATH)}.`);
    }
  }
  return target;
}

// Função pura (D108). Não existe opção para escolher outro banco: só o banco de exemplo é aceito.
function resolveSeedTarget({ argv = [], realDbPaths = resolveRealDbPaths(), devDbPath = DEV_DB_PATH } = {}) {
  if (argv.length > 0) {
    throw seedError(`Argumento desconhecido: ${argv[0]}. O seed:dev não aceita opções (grava só em ${path.basename(devDbPath)}).`);
  }
  return assertSafeTarget(devDbPath, { realDbPaths });
}

// Apaga o banco de exemplo e seus arquivos auxiliares. Só aceita arquivos "*.dev.sqlite".
function removeDbFiles(dbPath) {
  if (!path.basename(dbPath).toLowerCase().endsWith('.dev.sqlite')) {
    throw seedError(`Recusado: só é permitido apagar bancos de exemplo (*.dev.sqlite), não "${dbPath}".`);
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(dbPath + suffix, { force: true });
    } catch (err) {
      if (err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')) {
        throw seedError('O banco de exemplo está em uso. Feche o backend de demonstração (dev:backend:demo) e rode de novo.');
      }
      throw err;
    }
  }
}

module.exports = {
  DEV_DB_PATH, DEFAULT_REAL_DB_PATH, LEGACY_REAL_DB_PATH, resolveRealDbPaths, assertSafeTarget, resolveSeedTarget, removeDbFiles, isSamePath,
};

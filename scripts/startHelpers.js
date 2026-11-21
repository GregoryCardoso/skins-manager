// Lógica do start-app.bat (D137): o .bat só orquestra; as decisões ficam aqui, testáveis.
// Uso pela linha de comando:
//   node scripts/startHelpers.js running      -> exit 0 se o app já responde em /api/health, 1 se não
//   node scripts/startHelpers.js needs-build  -> exit 0 se a interface precisa ser compilada, 1 se está em dia
//   node scripts/startHelpers.js desktop-lock -> exit 0 se a trava da pasta de dados é do app desktop, 1 se não
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const APP_NAME = 'skins-manager'; // `data.app` do /api/health (backend/src/config/appInfo.js)
const LOCK_FILE_NAME = 'skins-manager.lock'; // mesmo nome de backend/src/config/instanceLock.js
const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend');
// Entradas que, se mais novas que o build, exigem recompilar.
const SOURCE_ENTRIES = ['src', 'public', 'next.config.ts', 'package.json', 'tsconfig.json'];

function newestMtimeMs(entry, fsImpl) {
  let stat;
  try {
    stat = fsImpl.statSync(entry);
  } catch (err) {
    return 0;
  }
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = stat.mtimeMs;
  for (const name of fsImpl.readdirSync(entry)) {
    newest = Math.max(newest, newestMtimeMs(path.join(entry, name), fsImpl));
  }
  return newest;
}

// true se não há build ou se o código do frontend é mais novo que o build.
function needsBuild({ frontendDir = FRONTEND_DIR, fsImpl = fs } = {}) {
  let builtAt;
  try {
    builtAt = fsImpl.statSync(path.join(frontendDir, 'out', 'index.html')).mtimeMs;
  } catch (err) {
    return true;
  }
  const newestSource = Math.max(0, ...SOURCE_ENTRIES.map((e) => newestMtimeMs(path.join(frontendDir, e), fsImpl)));
  return newestSource > builtAt;
}

function healthUrl(port) {
  return `http://127.0.0.1:${port}/api/health`;
}

async function checkHealth({ port, fetchFn = fetch, timeoutMs = 1500 }) {
  try {
    const res = await fetchFn(healthUrl(port), { signal: AbortSignal.timeout(timeoutMs) });
    if (!res || !res.ok) return false;
    // outro programa na mesma porta também responde 200: só vale o Skins Manager
    const body = await res.json();
    return Boolean(body && body.data && body.data.app === APP_NAME);
  } catch (err) {
    return false;
  }
}

async function isAppRunning({ port, fetchFn = fetch } = {}) {
  return checkHealth({ port, fetchFn });
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Consulta /api/health a cada `intervalMs` até responder ou estourar `timeoutMs` (relógio e sleep injetáveis).
async function waitForHealth({
  port,
  fetchFn = fetch,
  now = () => Date.now(),
  sleep = defaultSleep,
  timeoutMs = 60000,
  intervalMs = 500,
} = {}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    if (await checkHealth({ port, fetchFn })) return true;
    if (now() >= deadline) return false;
    await sleep(intervalMs);
  }
}

// A porta vem de backend/.env via loadEnv do backend; sem dependências instaladas usa o padrão.
function resolvePort() {
  try {
    return require(path.join(ROOT_DIR, 'backend', 'src', 'config', 'env')).port;
  } catch (err) {
    return 3001;
  }
}

// Pasta de dados = a do banco configurado (a mesma onde o backend grava a trava).
function resolveDataDir() {
  try {
    const { dbPath } = require(path.join(ROOT_DIR, 'backend', 'src', 'config', 'env'));
    if (dbPath && dbPath !== ':memory:') return path.dirname(dbPath);
  } catch (err) {
    // sem dependências instaladas: cai no padrão abaixo
  }
  try {
    return require(path.join(ROOT_DIR, 'backend', 'src', 'config', 'paths')).resolveDefaultDataDir();
  } catch (err) {
    return null;
  }
}

// Lê a trava da pasta de dados; null se não existe ou está ilegível.
function readLockInfo(dataDir, fsImpl = fs) {
  if (!dataDir) return null;
  try {
    const info = JSON.parse(fsImpl.readFileSync(path.join(dataDir, LOCK_FILE_NAME), 'utf8'));
    return info !== null && typeof info === 'object' ? info : null;
  } catch (err) {
    return null;
  }
}

// true se a trava existe e foi criada pelo app desktop.
function isDesktopLock(dataDir, fsImpl = fs) {
  const info = readLockInfo(dataDir, fsImpl);
  return Boolean(info && info.mode === 'desktop');
}

async function main(argv) {
  const command = argv[2];
  if (command === 'running') return (await isAppRunning({ port: resolvePort() })) ? 0 : 1;
  if (command === 'needs-build') return needsBuild() ? 0 : 1;
  if (command === 'desktop-lock') return isDesktopLock(resolveDataDir()) ? 0 : 1;
  console.error('Uso: node scripts/startHelpers.js <running|needs-build|desktop-lock>');
  return 2;
}

if (require.main === module) {
  main(process.argv).then((code) => process.exit(code));
}

module.exports = { readLockInfo, isDesktopLock, resolveDataDir, LOCK_FILE_NAME, needsBuild, isAppRunning, waitForHealth, healthUrl, resolvePort };

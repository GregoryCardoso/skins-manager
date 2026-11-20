// Lógica do start-app.bat (D137): o .bat só orquestra; as decisões ficam aqui, testáveis.
// Uso pela linha de comando:
//   node scripts/startHelpers.js running      -> exit 0 se o app já responde em /api/health, 1 se não
//   node scripts/startHelpers.js needs-build  -> exit 0 se a interface precisa ser compilada, 1 se está em dia
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
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
    return Boolean(res && res.ok);
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

async function main(argv) {
  const command = argv[2];
  if (command === 'running') return (await isAppRunning({ port: resolvePort() })) ? 0 : 1;
  if (command === 'needs-build') return needsBuild() ? 0 : 1;
  console.error('Uso: node scripts/startHelpers.js <running|needs-build>');
  return 2;
}

if (require.main === module) {
  main(process.argv).then((code) => process.exit(code));
}

module.exports = { needsBuild, isAppRunning, waitForHealth, healthUrl, resolvePort };

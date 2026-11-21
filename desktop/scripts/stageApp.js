'use strict';

// Monta `desktop/.stage` (D177): backend de produção + frontend exportado, com o better-sqlite3 pronto
// para o Electron. Só mexe na pasta `.stage`; `backend/node_modules` fica intocado (o Jest do backend segue no Node comum).
//
// Uso: node scripts/stageApp.js [--build] [--rebuild] [--clean]
//   --build    força `npm run build` do frontend (padrão: só se o código for mais novo que o build)
//   --rebuild  força o @electron/rebuild do better-sqlite3 (padrão: pula se o pacote traz binário N-API)
//   --clean    apaga `.stage` inteira antes (inclusive node_modules)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..', '..');
const DESKTOP_DIR = path.join(__dirname, '..');
const STAGE_DIR = path.join(DESKTOP_DIR, '.stage');

// Nunca vão para o stage (nem para o instalador): dados pessoais e variáveis de ambiente (D177).
const EXCLUDED_NAMES = new Set(['backups', 'tmp', 'node_modules']);

function isExcluded(filePath) {
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  return parts.some((part) => {
    const name = part.toLowerCase();
    return (
      EXCLUDED_NAMES.has(name) ||
      name === '.env' ||
      name.startsWith('.env.') ||
      name.endsWith('.sqlite') ||
      /\.sqlite-/.test(name) ||
      name.endsWith('.db') ||
      name.endsWith('.log') ||
      name.endsWith('.lock')
    );
  });
}

function copyTree(from, to) {
  fs.cpSync(from, to, {
    recursive: true,
    force: true,
    filter: (source) => !isExcluded(path.relative(from, source)),
  });
}

// Backend: server.js, package.json, package-lock.json, src/ e data/seed/ (mesma estrutura relativa).
function copyBackend({ rootDir = ROOT_DIR, stageDir = STAGE_DIR } = {}) {
  const source = path.join(rootDir, 'backend');
  const target = path.join(stageDir, 'backend');
  fs.mkdirSync(target, { recursive: true });
  for (const entry of ['server.js', 'src', 'data', 'package.json', 'package-lock.json']) {
    fs.rmSync(path.join(target, entry), { recursive: true, force: true });
  }
  for (const file of ['server.js', 'package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(source, file), path.join(target, file));
  }
  copyTree(path.join(source, 'src'), path.join(target, 'src'));
  copyTree(path.join(source, 'data', 'seed'), path.join(target, 'data', 'seed'));
  return target;
}

function copyFrontend({ rootDir = ROOT_DIR, stageDir = STAGE_DIR } = {}) {
  const source = path.join(rootDir, 'frontend', 'out');
  if (!fs.existsSync(path.join(source, 'index.html'))) {
    throw new Error('frontend/out/index.html não existe: a compilação do frontend falhou.');
  }
  const target = path.join(stageDir, 'frontend', 'out');
  fs.rmSync(target, { recursive: true, force: true });
  copyTree(source, target);
  return target;
}

// Roda o npm sem shell (argumentos não são concatenados): pelo script JS do próprio npm.
function npmCliPath() {
  const fromEnv = process.env.npm_execpath;
  if (fromEnv && /\.c?js$/i.test(fromEnv) && fs.existsSync(fromEnv)) return fromEnv;
  const bundled = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return fs.existsSync(bundled) ? bundled : null;
}

function runNpm(args, { cwd }) {
  console.log(`> npm ${args.join(' ')}   (${cwd})`);
  const cli = npmCliPath();
  const result = cli
    ? spawnSync(process.execPath, [cli, ...args], { cwd, stdio: 'inherit' })
    : spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(`Falhou: npm ${args.join(' ')} (código ${result.status}).`);
}

function electronVersion() {
  return require(path.join(DESKTOP_DIR, 'node_modules', 'electron', 'package.json')).version;
}

function electronBinary() {
  return require(path.join(DESKTOP_DIR, 'node_modules', 'electron'));
}

function lockHash(backendDir) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(backendDir, 'package-lock.json'))).digest('hex');
}

// O better-sqlite3 13 traz binários N-API (ABI estável): servem ao Electron sem recompilar.
function hasNapiPrebuild(backendDir) {
  const file = path.join(backendDir, 'node_modules', 'better-sqlite3', 'prebuilds', `${process.platform}-${process.arch}.node`);
  return fs.existsSync(file);
}

async function rebuildNative(backendDir, version) {
  const { rebuild } = require('@electron/rebuild');
  console.log(`> @electron/rebuild better-sqlite3 (Electron ${version})`);
  await rebuild({ buildPath: backendDir, electronVersion: version, onlyModules: ['better-sqlite3'], force: true });
}

// Prova de fogo: abre um banco em memória com o Node embutido do Electron (sem abrir janela).
function verifyNative(backendDir) {
  const script = "const D=require('better-sqlite3');const db=new D(':memory:');process.stdout.write('better-sqlite3 ok, SQLite '+db.prepare('select sqlite_version() v').get().v+' (Node '+process.versions.node+')\\n');db.close();";
  const result = spawnSync(electronBinary(), ['-e', script], {
    cwd: backendDir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`O better-sqlite3 não carregou no Electron: ${(result.stderr || result.stdout || '').trim()}\nTente: npm run desktop:stage -- --rebuild`);
  }
  console.log(result.stdout.trim());
}

async function stage({ forceBuild = false, forceRebuild = false, clean = false } = {}) {
  const version = electronVersion();
  if (clean) fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  fs.mkdirSync(STAGE_DIR, { recursive: true });

  const { needsBuild } = require(path.join(ROOT_DIR, 'scripts', 'startHelpers.js'));
  if (forceBuild || needsBuild()) runNpm(['run', 'build'], { cwd: path.join(ROOT_DIR, 'frontend') });
  else console.log('Frontend já compilado e em dia.');

  const backendDir = copyBackend();
  copyFrontend();

  const markerPath = path.join(STAGE_DIR, 'deps.json');
  const marker = { lock: lockHash(backendDir), electron: version, platform: process.platform, arch: process.arch };
  let current = null;
  try {
    current = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch (err) {
    current = null;
  }
  const depsOk = fs.existsSync(path.join(backendDir, 'node_modules', 'better-sqlite3')) && JSON.stringify(current) === JSON.stringify(marker);

  if (!depsOk || forceRebuild) {
    fs.rmSync(markerPath, { force: true });
    fs.rmSync(path.join(backendDir, 'node_modules'), { recursive: true, force: true });
    runNpm(['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: backendDir });
    if (forceRebuild || !hasNapiPrebuild(backendDir)) await rebuildNative(backendDir, version);
    else console.log('better-sqlite3 traz binário N-API para esta plataforma: recompilação dispensada.');
    verifyNative(backendDir);
    fs.writeFileSync(markerPath, JSON.stringify(marker));
  } else {
    console.log('Dependências do backend em dia.');
  }

  console.log(`Stage pronto em ${STAGE_DIR}`);
}

if (require.main === module) {
  const args = new Set(process.argv.slice(2));
  stage({ forceBuild: args.has('--build'), forceRebuild: args.has('--rebuild'), clean: args.has('--clean') }).catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
}

module.exports = { isExcluded, copyBackend, copyFrontend, lockHash, hasNapiPrebuild, stage, STAGE_DIR };

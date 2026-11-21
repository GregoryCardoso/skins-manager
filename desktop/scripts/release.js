'use strict';

// Publicação de um release no GitHub como RASCUNHO (D182). Uso: npm run desktop:release (pela raiz).
// Exige GH_TOKEN na variável de ambiente da sessão (nunca grava o token em arquivo nem o imprime):
//   PowerShell:  $env:GH_TOKEN = "ghp_..."; npm run desktop:release
// Etapas: testes (backend, frontend, desktop) -> stage -> electron-builder --publish always (releaseType: draft).
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.join(__dirname, '..', '..');
const DESKTOP_DIR = path.join(__dirname, '..');

function checkReleaseEnv(env) {
  const token = env && typeof env.GH_TOKEN === 'string' ? env.GH_TOKEN.trim() : '';
  if (!token) {
    return {
      ok: false,
      message: [
        'GH_TOKEN não definido. Para publicar o release, defina o token do GitHub apenas nesta sessão do terminal:',
        '  PowerShell:  $env:GH_TOKEN = "seu_token"',
        '  Depois rode:  npm run desktop:release',
        'O token precisa de permissão para criar releases no repositório (escopo "repo"). Ele nunca é gravado em arquivo.',
      ].join('\n'),
    };
  }
  return { ok: true };
}

function run(label, command, args, cwd) {
  console.log(`\n==> ${label}`);
  // shell: true para achar npm.cmd/npx.cmd no Windows; os argumentos são fixos (não vêm do usuário).
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env, shell: true });
  if (result.status !== 0) {
    console.error(`\nFalhou em: ${label}. Nada foi publicado.`);
    process.exit(result.status || 1);
  }
}

function main() {
  const check = checkReleaseEnv(process.env);
  if (!check.ok) {
    console.error(check.message);
    process.exit(1);
  }
  run('Testes (backend, frontend e desktop)', 'npm', ['run', 'test:all'], ROOT_DIR);
  run('Montando o app (stage)', 'node', ['scripts/stageApp.js'], DESKTOP_DIR);
  run('Empacotando e publicando o rascunho no GitHub', 'npx', ['electron-builder', '--win', '--x64', '--publish', 'always'], DESKTOP_DIR);
  console.log('\nRascunho criado no GitHub. Revise as notas e os arquivos (Setup, Portable, latest.yml, .blockmap) e publique.');
}

if (require.main === module) main();

module.exports = { checkReleaseEnv };

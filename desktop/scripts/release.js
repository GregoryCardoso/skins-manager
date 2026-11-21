'use strict';

// Publicação de um release no GitHub como RASCUNHO (D182). Uso: npm run desktop:release (pela raiz).
// Exige GH_TOKEN na variável de ambiente da sessão (nunca grava o token em arquivo nem o imprime):
//   PowerShell:  $env:GH_TOKEN = "ghp_..."; npm run desktop:release
// Etapas: testes (backend, frontend, desktop) -> stage -> electron-builder --publish never (só empacota) ->
// cria UM rascunho v<versão> e envia Setup, .blockmap, Portable e latest.yml (scripts/lib/githubRelease.js).
// Não usamos --publish always: os alvos nsis e portable publicavam em paralelo e cada um criava o seu rascunho.
const path = require('path');
const { spawnSync } = require('child_process');
const githubRelease = require('./lib/githubRelease');

const ROOT_DIR = path.join(__dirname, '..', '..');
const DESKTOP_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(DESKTOP_DIR, 'dist');

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
  return { ok: true, token };
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

async function main() {
  const check = checkReleaseEnv(process.env);
  if (!check.ok) {
    console.error(check.message);
    process.exit(1);
  }
  run('Testes (backend, frontend e desktop)', 'npm', ['run', 'test:all'], ROOT_DIR);
  run('Montando o app (stage)', 'node', ['scripts/stageApp.js'], DESKTOP_DIR);
  run('Empacotando (instalador e portátil, sem publicar)', 'npx', ['electron-builder', '--win', '--x64', '--publish', 'never'], DESKTOP_DIR);

  // versão lida na hora (o require ficaria em cache se o script mudasse a versão antes)
  const { version } = JSON.parse(require('fs').readFileSync(path.join(DESKTOP_DIR, 'package.json'), 'utf8'));
  console.log(`\n==> Criando o rascunho v${version} no GitHub e enviando os arquivos`);
  try {
    const result = await githubRelease.publishRelease({
      version,
      distDir: DIST_DIR,
      client: githubRelease.createGitHubClient(check.token),
    });
    console.log(`\nRascunho ${result.tag} criado com ${result.assets.length} arquivos: ${result.assets.join(', ')}.`);
    if (result.url) console.log(result.url);
    console.log('Revise as notas e os arquivos no GitHub e publique.');
  } catch (err) {
    console.error(`\n${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { checkReleaseEnv };

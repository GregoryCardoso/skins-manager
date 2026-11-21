'use strict';

// Pré-carregado com `node -r`: troca child_process.spawnSync por um registro, para exercitar scripts/release.js
// de verdade sem rodar testes, stage nem empacotar. STUB_FAIL_AT=<índice> faz o passo falhar.
// Também troca a publicação no GitHub (scripts/lib/githubRelease.js) por um registro: nada sai para a rede.
// STUB_PUBLISH_FAIL=1 faz a publicação falhar.
const path = require('path');
const childProcess = require('child_process');
const githubRelease = require(path.join(__dirname, '..', '..', 'scripts', 'lib', 'githubRelease.js'));

let index = 0;
childProcess.spawnSync = (command, args, options) => {
  const entry = { index, command, args, cwd: options && options.cwd, hasToken: Boolean(options && options.env && options.env.GH_TOKEN) };
  process.stdout.write(`STUB_CALL ${JSON.stringify(entry)}\n`);
  const failAt = process.env.STUB_FAIL_AT;
  const status = failAt !== undefined && String(index) === failAt ? 3 : 0;
  index += 1;
  return { status };
};

githubRelease.createGitHubClient = (token) => ({ fake: true, tokenLength: token.length });
githubRelease.publishRelease = async ({ version, distDir, client }) => {
  const entry = { index, version, distDir: path.basename(distDir), clientIsFake: Boolean(client && client.fake) };
  process.stdout.write(`STUB_PUBLISH ${JSON.stringify(entry)}\n`);
  index += 1;
  if (process.env.STUB_PUBLISH_FAIL === '1') throw new Error('Falha simulada ao publicar. Nada foi publicado.');
  return { tag: `v${version}`, releaseId: 1, url: null, assets: githubRelease.releaseAssetNames(version) };
};

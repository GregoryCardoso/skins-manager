'use strict';

// Criação do rascunho de release no GitHub em UMA chamada, depois do empacotamento (D182, correção da 7.5).
// O `electron-builder --publish always` publicava os alvos nsis e portable em paralelo e cada um criava o seu
// rascunho. Agora o electron-builder só empacota (--publish never) e este módulo cria a release uma vez e envia
// todos os arquivos para ela.
const fs = require('fs');
const path = require('path');
const https = require('https');

const OWNER = 'GregoryCardoso';
const REPO = 'skins-manager';
const API_HOST = 'api.github.com';
const UPLOADS_HOST = 'uploads.github.com';

/** Nomes dos arquivos da versão, na ordem de envio (mesmos `artifactName` do electron-builder.yml). */
function releaseAssetNames(version) {
  return [
    `SkinsManager-Setup-${version}.exe`,
    `SkinsManager-Setup-${version}.exe.blockmap`,
    `SkinsManager-Portable-${version}.exe`,
    'latest.yml',
  ];
}

/**
 * Confere em dist/ os arquivos da versão. Devolve { ok, assets } ou { ok: false, message }.
 * O latest.yml precisa ser desta versão (um dist antigo não pode ir para a release nova).
 */
function collectReleaseAssets(distDir, version, fsImpl = fs) {
  const assets = [];
  const missing = [];
  for (const name of releaseAssetNames(version)) {
    const filePath = path.join(distDir, name);
    if (!fsImpl.existsSync(filePath)) {
      missing.push(name);
      continue;
    }
    assets.push({ name, path: filePath, size: fsImpl.statSync(filePath).size });
  }
  if (missing.length > 0) {
    return { ok: false, message: `Arquivos não encontrados em ${distDir}: ${missing.join(', ')}.` };
  }
  const latest = fsImpl.readFileSync(path.join(distDir, 'latest.yml'), 'utf8');
  const match = /^version:\s*['"]?([^\s'"]+)/m.exec(latest);
  if (!match || match[1] !== version) {
    return {
      ok: false,
      message: `O latest.yml é da versão ${match ? match[1] : '(desconhecida)'}, mas o app está na ${version}.`,
    };
  }
  return { ok: true, assets };
}

function describeGitHubError(status, body) {
  let detail = '';
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.message === 'string') detail = `: ${parsed.message}`;
  } catch {
    // corpo não é JSON; fica só o status
  }
  return `GitHub respondeu ${status}${detail}`;
}

/**
 * Cliente mínimo da API de releases. O token vai só no cabeçalho Authorization (nunca na URL nem no log).
 * `requestFn` e `fsImpl` são injetáveis para os testes.
 */
function createGitHubClient(token, { requestFn = https.request, fsImpl = fs } = {}) {
  const baseHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'skins-manager-release-script',
  };

  function send({ host, method, pathname, headers = {}, body, bodyStream }) {
    return new Promise((resolve, reject) => {
      const req = requestFn({ host, method, path: pathname, headers: { ...baseHeaders, ...headers } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(text ? JSON.parse(text) : null);
            } catch {
              reject(new Error(`Resposta inválida do GitHub (${method} ${pathname}).`));
            }
          } else {
            reject(new Error(describeGitHubError(res.statusCode, text)));
          }
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      if (bodyStream) {
        bodyStream.on('error', (err) => req.destroy(err));
        bodyStream.pipe(req);
      } else {
        if (body !== undefined) req.write(body);
        req.end();
      }
    });
  }

  return {
    // Com o token, a listagem inclui os rascunhos (que não aparecem em /releases/tags/<tag>).
    listReleases() {
      return send({ host: API_HOST, method: 'GET', pathname: `/repos/${OWNER}/${REPO}/releases?per_page=100` });
    },
    createDraftRelease({ tag, name }) {
      const body = JSON.stringify({ tag_name: tag, name, draft: true, prerelease: false });
      return send({
        host: API_HOST,
        method: 'POST',
        pathname: `/repos/${OWNER}/${REPO}/releases`,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        body,
      });
    },
    uploadAsset(releaseId, asset) {
      return send({
        host: UPLOADS_HOST,
        method: 'POST',
        pathname: `/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(asset.name)}`,
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': asset.size },
        bodyStream: fsImpl.createReadStream(asset.path),
      });
    },
  };
}

/**
 * Cria UM rascunho `v<version>` e envia todos os arquivos para ele.
 * Recusa (sem criar nada) se faltar arquivo ou se já existir release/rascunho com a mesma tag.
 */
async function publishRelease({ version, distDir, client, log = console.log, fsImpl = fs }) {
  const tag = `v${version}`;
  const collected = collectReleaseAssets(distDir, version, fsImpl);
  if (!collected.ok) throw new Error(`${collected.message} Nada foi publicado.`);

  const existing = (await client.listReleases()) || [];
  const clash = existing.find((r) => r && r.tag_name === tag);
  if (clash) {
    const kind = clash.draft ? 'um rascunho' : 'uma release';
    throw new Error(
      `Já existe ${kind} com a tag ${tag} no GitHub. Apague-o(a) ou mude a versão (npm run version:set) e rode de novo. Nada foi publicado.`,
    );
  }

  const release = await client.createDraftRelease({ tag, name: version });
  log(`Rascunho ${tag} criado.`);
  for (const asset of collected.assets) {
    log(`Enviando ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)...`);
    try {
      await client.uploadAsset(release.id, asset);
    } catch (err) {
      throw new Error(
        `Falha ao enviar ${asset.name} (${err.message}). O rascunho ${tag} ficou incompleto: apague-o no GitHub e rode de novo.`,
      );
    }
  }
  return { tag, releaseId: release.id, url: release.html_url, assets: collected.assets.map((a) => a.name) };
}

module.exports = { OWNER, REPO, releaseAssetNames, collectReleaseAssets, createGitHubClient, publishRelease };

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const yaml = require('js-yaml');
const {
  OWNER,
  REPO,
  releaseAssetNames,
  collectReleaseAssets,
  createGitHubClient,
  publishRelease,
} = require('../scripts/lib/githubRelease');

const VERSION = '1.0.1';
const TOKEN = 'ghp_SEGREDO_NAO_PODE_VAZAR_123456';

let distDir;

function writeDist(version = VERSION, { skip = [], latestVersion = version } = {}) {
  for (const name of releaseAssetNames(version)) {
    if (skip.includes(name)) continue;
    const content = name === 'latest.yml' ? `version: ${latestVersion}\npath: SkinsManager-Setup-${version}.exe\n` : `conteudo de ${name}`;
    fs.writeFileSync(path.join(distDir, name), content);
  }
}

function fakeClient({ existing = [], failUploadOf = null } = {}) {
  const calls = [];
  return {
    calls,
    async listReleases() {
      calls.push(['list']);
      return existing;
    },
    async createDraftRelease(args) {
      calls.push(['create', args]);
      return { id: 42, html_url: 'https://github.com/GregoryCardoso/skins-manager/releases/tag/v1.0.1' };
    },
    async uploadAsset(releaseId, asset) {
      calls.push(['upload', releaseId, asset.name]);
      if (asset.name === failUploadOf) throw new Error('GitHub respondeu 500');
      return { id: 1 };
    },
  };
}

beforeEach(() => {
  distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-release-'));
});
afterEach(() => {
  fs.rmSync(distDir, { recursive: true, force: true });
});

describe('releaseAssetNames', () => {
  test('Setup, .blockmap, Portable e latest.yml, batendo com o artifactName do electron-builder.yml', () => {
    expect(releaseAssetNames('2.3.4')).toEqual([
      'SkinsManager-Setup-2.3.4.exe',
      'SkinsManager-Setup-2.3.4.exe.blockmap',
      'SkinsManager-Portable-2.3.4.exe',
      'latest.yml',
    ]);
    const cfg = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'electron-builder.yml'), 'utf8'));
    expect(cfg.nsis.artifactName.replace('${version}', '2.3.4').replace('${ext}', 'exe')).toBe('SkinsManager-Setup-2.3.4.exe');
    expect(cfg.portable.artifactName.replace('${version}', '2.3.4').replace('${ext}', 'exe')).toBe('SkinsManager-Portable-2.3.4.exe');
    expect({ owner: cfg.publish.owner, repo: cfg.publish.repo }).toEqual({ owner: OWNER, repo: REPO });
  });
});

describe('collectReleaseAssets', () => {
  test('todos presentes e latest.yml da versão: ok com tamanhos', () => {
    writeDist();
    const r = collectReleaseAssets(distDir, VERSION);
    expect(r.ok).toBe(true);
    expect(r.assets.map((a) => a.name)).toEqual(releaseAssetNames(VERSION));
    expect(r.assets.every((a) => a.size > 0)).toBe(true);
  });

  test.each(releaseAssetNames(VERSION))('falta %s: recusa e cita o arquivo', (name) => {
    writeDist(VERSION, { skip: [name] });
    const r = collectReleaseAssets(distDir, VERSION);
    expect(r.ok).toBe(false);
    expect(r.message).toContain(name);
  });

  test('arquivos de outra versão em dist não contam', () => {
    writeDist('1.0.0');
    expect(collectReleaseAssets(distDir, VERSION).ok).toBe(false);
  });

  test('latest.yml de outra versão: recusa', () => {
    writeDist(VERSION, { latestVersion: '1.0.0' });
    const r = collectReleaseAssets(distDir, VERSION);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/latest\.yml é da versão 1\.0\.0/);
  });
});

describe('publishRelease', () => {
  test('cria a release UMA única vez e envia os quatro arquivos para ela', async () => {
    writeDist();
    const client = fakeClient();
    const result = await publishRelease({ version: VERSION, distDir, client, log: () => {} });

    const creates = client.calls.filter((c) => c[0] === 'create');
    expect(creates).toHaveLength(1);
    expect(creates[0][1]).toEqual({ tag: 'v1.0.1', name: '1.0.1' });
    const uploads = client.calls.filter((c) => c[0] === 'upload');
    expect(uploads.map((c) => c[2])).toEqual(releaseAssetNames(VERSION));
    expect(uploads.every((c) => c[1] === 42)).toBe(true);
    // a criação vem antes de qualquer envio
    expect(client.calls.findIndex((c) => c[0] === 'create')).toBeLessThan(client.calls.findIndex((c) => c[0] === 'upload'));
    expect(result).toMatchObject({ tag: 'v1.0.1', releaseId: 42, assets: releaseAssetNames(VERSION) });
  });

  test('arquivo faltando: não consulta nem cria nada no GitHub', async () => {
    writeDist(VERSION, { skip: ['SkinsManager-Setup-1.0.1.exe.blockmap'] });
    const client = fakeClient();
    await expect(publishRelease({ version: VERSION, distDir, client, log: () => {} })).rejects.toThrow(/blockmap.*Nada foi publicado/);
    expect(client.calls).toEqual([]);
  });

  test.each([
    [{ tag_name: 'v1.0.1', draft: true }, /Já existe um rascunho com a tag v1\.0\.1/],
    [{ tag_name: 'v1.0.1', draft: false }, /Já existe uma release com a tag v1\.0\.1/],
  ])('tag já existente (%o): recusa sem criar outra', async (existing, message) => {
    writeDist();
    const client = fakeClient({ existing: [{ tag_name: 'v1.0.0', draft: false }, existing] });
    await expect(publishRelease({ version: VERSION, distDir, client, log: () => {} })).rejects.toThrow(message);
    expect(client.calls.filter((c) => c[0] !== 'list')).toEqual([]);
  });

  test('outras tags no GitHub não atrapalham', async () => {
    writeDist();
    const client = fakeClient({ existing: [{ tag_name: 'v1.0.0', draft: false }, { tag_name: 'v1.0.10', draft: true }] });
    await publishRelease({ version: VERSION, distDir, client, log: () => {} });
    expect(client.calls.filter((c) => c[0] === 'create')).toHaveLength(1);
  });

  test('falha num envio: para, não cria outra release e explica que o rascunho ficou incompleto', async () => {
    writeDist();
    const client = fakeClient({ failUploadOf: 'SkinsManager-Portable-1.0.1.exe' });
    await expect(publishRelease({ version: VERSION, distDir, client, log: () => {} })).rejects.toThrow(
      /Falha ao enviar SkinsManager-Portable-1\.0\.1\.exe.*incompleto/,
    );
    expect(client.calls.filter((c) => c[0] === 'create')).toHaveLength(1);
    expect(client.calls.filter((c) => c[0] === 'upload').map((c) => c[2])).not.toContain('latest.yml');
  });
});

describe('createGitHubClient (requisição falsa)', () => {
  function fakeRequest(responses) {
    const requests = [];
    const requestFn = (options, onResponse) => {
      const req = new EventEmitter();
      const chunks = [];
      req.write = (c) => chunks.push(Buffer.from(c));
      const finish = () => {
        requests.push({ options, body: Buffer.concat(chunks).toString('utf8') });
        const { status, body } = responses.shift();
        const res = new EventEmitter();
        res.statusCode = status;
        onResponse(res);
        res.emit('data', Buffer.from(body));
        res.emit('end');
      };
      req.end = (c) => {
        if (c) chunks.push(Buffer.from(c));
        finish();
      };
      req.destroy = () => {};
      return req;
    };
    return { requestFn, requests };
  }

  test('cria rascunho em api.github.com com o token só no cabeçalho', async () => {
    const { requestFn, requests } = fakeRequest([{ status: 201, body: '{"id":7}' }]);
    const client = createGitHubClient(TOKEN, { requestFn });
    await expect(client.createDraftRelease({ tag: 'v1.0.1', name: '1.0.1' })).resolves.toEqual({ id: 7 });
    const [{ options, body }] = requests;
    expect(options.host).toBe('api.github.com');
    expect(options.method).toBe('POST');
    expect(options.path).toBe('/repos/GregoryCardoso/skins-manager/releases');
    expect(options.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(options.path).not.toContain(TOKEN);
    expect(JSON.parse(body)).toEqual({ tag_name: 'v1.0.1', name: '1.0.1', draft: true, prerelease: false });
  });

  test('envia o arquivo para uploads.github.com com o nome na query e o tamanho', async () => {
    const { requestFn, requests } = fakeRequest([{ status: 201, body: '{"id":9}' }]);
    const fakeStream = new EventEmitter();
    fakeStream.pipe = (req) => req.end('bytes');
    const client = createGitHubClient(TOKEN, { requestFn, fsImpl: { createReadStream: () => fakeStream } });
    await client.uploadAsset(42, { name: 'SkinsManager-Setup-1.0.1.exe.blockmap', path: 'x', size: 5 });
    const [{ options }] = requests;
    expect(options.host).toBe('uploads.github.com');
    expect(options.path).toBe('/repos/GregoryCardoso/skins-manager/releases/42/assets?name=SkinsManager-Setup-1.0.1.exe.blockmap');
    expect(options.headers['Content-Type']).toBe('application/octet-stream');
    expect(options.headers['Content-Length']).toBe(5);
  });

  test('erro do GitHub vira mensagem com status e motivo, sem o token', async () => {
    const { requestFn } = fakeRequest([{ status: 422, body: '{"message":"Validation Failed"}' }]);
    const client = createGitHubClient(TOKEN, { requestFn });
    const err = await client.listReleases().catch((e) => e);
    expect(err.message).toBe('GitHub respondeu 422: Validation Failed');
    expect(err.message).not.toContain(TOKEN);
  });
});

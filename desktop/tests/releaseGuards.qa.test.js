'use strict';

// QA da revisão da Etapa 7 (D182): git de verdade em repositórios temporários, teto da paginação,
// caminhos do npm/electron-builder no Windows e garantias de segurança do release.js (sem shell, sem token).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { spawnSync } = require('child_process');
const { checkGitState, defaultRunGit } = require('../scripts/lib/gitState');
const { createGitHubClient, publishRelease, releaseAssetNames } = require('../scripts/lib/githubRelease');
const { npmCliPath } = require('../scripts/stageApp');

const DESKTOP_DIR = path.resolve(__dirname, '..');
const RELEASE_SOURCE = fs.readFileSync(path.join(DESKTOP_DIR, 'scripts', 'release.js'), 'utf8');
const GITSTATE_SOURCE = fs.readFileSync(path.join(DESKTOP_DIR, 'scripts', 'lib', 'gitState.js'), 'utf8');
const TOKEN = 'ghp_SEGREDO_NAO_PODE_VAZAR_123456';

const gitAvailable = spawnSync('git', ['--version']).status === 0;
const maybe = gitAvailable ? describe : describe.skip;

maybe('checkGitState com git de verdade (repositório temporário)', () => {
  let root;
  let work;
  let remote;
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'QA',
    GIT_AUTHOR_EMAIL: 'qa@example.com',
    GIT_COMMITTER_NAME: 'QA',
    GIT_COMMITTER_EMAIL: 'qa@example.com',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  delete env.GH_TOKEN;

  const git = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const state = () => checkGitState({ runGit: (args) => defaultRunGit(args, work, env) });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-git-'));
    work = path.join(root, 'work');
    remote = path.join(root, 'remote.git');
    fs.mkdirSync(work);
    git(work, 'init', '-q', '-b', 'main');
    git(work, 'config', 'core.autocrlf', 'false');
    fs.writeFileSync(path.join(work, 'a.txt'), 'um\n');
    git(work, 'add', '.');
    git(work, 'commit', '-q', '-m', 'primeiro');
    git(root, 'init', '-q', '--bare', remote);
    git(work, 'remote', 'add', 'origin', remote);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

  test('HEAD ainda não enviado (sem nenhum branch remoto): recusa pedindo o push', () => {
    const r = state();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/git push/);
  });

  test('depois do push: ok com o SHA exato do HEAD', () => {
    git(work, 'push', '-q', 'origin', 'main');
    const r = state();
    expect(r).toEqual({ ok: true, sha: git(work, 'rev-parse', 'HEAD') });
    expect(r.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  test('arquivo NÃO rastreado não bloqueia', () => {
    git(work, 'push', '-q', 'origin', 'main');
    fs.writeFileSync(path.join(work, 'novo.txt'), 'solto');
    fs.mkdirSync(path.join(work, 'pasta'));
    fs.writeFileSync(path.join(work, 'pasta', 'x.txt'), 'x');
    expect(state().ok).toBe(true);
  });

  test('arquivo rastreado modificado, apagado ou adicionado ao índice bloqueia (antes de olhar o remoto)', () => {
    git(work, 'push', '-q', 'origin', 'main');
    fs.writeFileSync(path.join(work, 'a.txt'), 'mudou\n');
    expect(state()).toMatchObject({ ok: false, message: expect.stringMatching(/sem commit/) });
    git(work, 'checkout', '--', 'a.txt');
    fs.rmSync(path.join(work, 'a.txt'));
    expect(state().ok).toBe(false);
    git(work, 'checkout', '--', 'a.txt');
    fs.writeFileSync(path.join(work, 'b.txt'), 'b');
    git(work, 'add', 'b.txt');
    expect(state().ok).toBe(false);
  });

  test('commit novo local depois do push (HEAD à frente do remoto): recusa', () => {
    git(work, 'push', '-q', 'origin', 'main');
    fs.writeFileSync(path.join(work, 'a.txt'), 'dois\n');
    git(work, 'commit', '-q', '-am', 'segundo');
    const r = state();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/não está no GitHub/);
  });

  test('HEAD num branch diferente que também está no remoto: ok (o commit existe no GitHub)', () => {
    git(work, 'checkout', '-q', '-b', 'feature');
    fs.writeFileSync(path.join(work, 'f.txt'), 'f');
    git(work, 'add', 'f.txt');
    git(work, 'commit', '-q', '-m', 'feature');
    git(work, 'push', '-q', 'origin', 'feature');
    expect(state().ok).toBe(true);
  });

  test('fora de um repositório git: recusa em português (sem lançar)', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-nogit-'));
    try {
      const r = checkGitState({ runGit: (args) => defaultRunGit(args, empty, { ...env, GIT_CEILING_DIRECTORIES: path.dirname(empty) }) });
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/Não foi possível/);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  test('git inexistente (ENOENT): recusa em português', () => {
    const r = checkGitState({ runGit: () => ({ status: null, stdout: '', error: new Error('spawn git ENOENT') }) });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Não foi possível consultar o Git/);
  });
});

describe('release.js: caminhos e segurança', () => {
  test('npmCliPath resolve para um arquivo que existe (npm-cli.js)', () => {
    const cli = npmCliPath();
    expect(cli).toBeTruthy();
    expect(path.basename(cli)).toBe('npm-cli.js');
    expect(fs.existsSync(cli)).toBe(true);
  });

  test('npmCliPath também resolve sem npm_execpath (rodando "node scripts/release.js" direto)', () => {
    const saved = process.env.npm_execpath;
    delete process.env.npm_execpath;
    try {
      const cli = npmCliPath();
      // o npm embutido ao lado do node.exe; se esta instalação do Node não o tiver, devolve null (e o release.js avisa)
      const bundled = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
      expect(cli).toBe(fs.existsSync(bundled) ? bundled : null);
    } finally {
      if (saved !== undefined) process.env.npm_execpath = saved;
    }
  });

  test('o cli.js do electron-builder usado pelo release.js existe de verdade e responde --version', () => {
    const cli = path.join(DESKTOP_DIR, 'node_modules', 'electron-builder', 'cli.js');
    expect(fs.existsSync(cli)).toBe(true);
    expect(RELEASE_SOURCE).toContain("'electron-builder', 'cli.js'");
    const r = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8', timeout: 60000 });
    expect(r.status).toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/\d+\.\d+\.\d+/);
  });

  test('os scripts invocados pelo release.js existem (stageApp.js e a raiz com test:all)', () => {
    expect(fs.existsSync(path.join(DESKTOP_DIR, 'scripts', 'stageApp.js'))).toBe(true);
    const rootPkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, '..', 'package.json'), 'utf8'));
    expect(rootPkg.scripts['test:all']).toBeDefined();
    expect(rootPkg.scripts['desktop:release']).toBe('npm --prefix desktop run release');
    const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, 'package.json'), 'utf8'));
    expect(pkg.scripts.release).toBe('node scripts/release.js');
  });

  test('nenhum subprocesso usa shell, e o código não usa exec/execSync', () => {
    for (const source of [RELEASE_SOURCE, GITSTATE_SOURCE]) {
      expect(source).not.toMatch(/shell\s*:/);
      expect(source).not.toMatch(/\bexec(Sync)?\(/);
      expect(source).not.toMatch(/child_process'\)\.exec/);
    }
    expect(RELEASE_SOURCE).toMatch(/delete env\.GH_TOKEN/);
  });

  test('o token só chega ao createGitHubClient; não é repassado a mais nada no release.js', () => {
    const uses = RELEASE_SOURCE.split('\n').filter((l) => /token/i.test(l) && !/^\s*(\/\/|console\.error\('GH_TOKEN|'  )/.test(l));
    const text = uses.join('\n');
    expect(text).toMatch(/createGitHubClient\(check\.token\)/);
    expect(text).not.toMatch(/console\.(log|error|info|warn)\([^)]*token/i);
    expect(text).not.toMatch(/argv|args.*token|token.*args/i);
  });

  test('o release.js importado como módulo não executa nada (require.main guard)', () => {
    // se executasse main(), sem GH_TOKEN chamaria process.exit(1) durante o require
    const r = spawnSync(process.execPath, ['-e', "require('./scripts/release'); console.log('carregou')"], {
      cwd: DESKTOP_DIR,
      env: { ...process.env, GH_TOKEN: '' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('carregou');
  });
});

describe('githubRelease: teto de paginação e propagação do SHA', () => {
  function pagedRequest(pageBody) {
    const requests = [];
    const requestFn = (options, onResponse) => {
      const req = new EventEmitter();
      req.write = () => {};
      req.destroy = () => {};
      req.end = () => {
        requests.push(options.path);
        const res = new EventEmitter();
        res.statusCode = 200;
        onResponse(res);
        res.emit('data', Buffer.from(pageBody(requests.length)));
        res.emit('end');
      };
      return req;
    };
    return { requestFn, requests };
  }

  test('páginas sempre cheias: para no teto de 50 páginas (sem laço infinito)', async () => {
    const full = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ tag_name: `v0.0.${i}`, draft: false })));
    const { requestFn, requests } = pagedRequest(() => full);
    const all = await createGitHubClient(TOKEN, { requestFn }).listReleases();
    expect(requests).toHaveLength(50);
    expect(all).toHaveLength(5000);
    expect(requests[49]).toContain('page=50');
  });

  test('página cheia, cheia e depois incompleta: junta as três e para', async () => {
    const full = JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ tag_name: `v0.0.${i}` })));
    const { requestFn, requests } = pagedRequest((n) => (n < 3 ? full : JSON.stringify([{ tag_name: 'v9.9.9' }])));
    const all = await createGitHubClient(TOKEN, { requestFn }).listReleases();
    expect(all).toHaveLength(201);
    expect(requests).toHaveLength(3);
  });

  test('corpo que não é lista (objeto de erro 200): trata como fim, sem lançar', async () => {
    const { requestFn } = pagedRequest(() => '{"message":"x"}');
    expect(await createGitHubClient(TOKEN, { requestFn }).listReleases()).toEqual([]);
  });

  test('tag repetida só na 2ª página é encontrada e nada é criado', async () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-dist-'));
    try {
      for (const name of releaseAssetNames('3.2.1')) {
        fs.writeFileSync(path.join(dist, name), name === 'latest.yml' ? 'version: 3.2.1\n' : 'x');
      }
      const creates = [];
      const client = {
        listReleases: async () => [...Array.from({ length: 100 }, (_, i) => ({ tag_name: `v0.0.${i}` })), { tag_name: 'v3.2.1', draft: true }],
        createDraftRelease: async (a) => creates.push(a),
        uploadAsset: async () => ({}),
      };
      await expect(publishRelease({ version: '3.2.1', distDir: dist, client, targetCommitish: 'c'.repeat(40), log: () => {} })).rejects.toThrow(/rascunho com a tag v3\.2\.1/);
      expect(creates).toEqual([]);
    } finally {
      fs.rmSync(dist, { recursive: true, force: true });
    }
  });

  test('o SHA chega ao corpo do POST como target_commitish, e o token não aparece em nenhuma parte do pedido além do cabeçalho', async () => {
    const sent = [];
    const requestFn = (options, onResponse) => {
      const req = new EventEmitter();
      req.write = (c) => sent.push({ options, body: String(c) });
      req.destroy = () => {};
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = 201;
        onResponse(res);
        res.emit('data', Buffer.from('{"id":1}'));
        res.emit('end');
      };
      return req;
    };
    const sha = 'd'.repeat(40);
    await createGitHubClient(TOKEN, { requestFn }).createDraftRelease({ tag: 'v1.2.3', name: '1.2.3', targetCommitish: sha });
    expect(JSON.parse(sent[0].body).target_commitish).toBe(sha);
    expect(sent[0].body).not.toContain(TOKEN);
    expect(sent[0].options.path).not.toContain(TOKEN);
    const { Authorization, ...otherHeaders } = sent[0].options.headers;
    expect(Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(otherHeaders)).not.toContain(TOKEN);
  });

  test('erro de rede do GitHub (req "error") rejeita sem o token na mensagem', async () => {
    const requestFn = () => {
      const req = new EventEmitter();
      req.write = () => {};
      req.destroy = () => {};
      req.end = () => setImmediate(() => req.emit('error', new Error('getaddrinfo ENOTFOUND api.github.com')));
      return req;
    };
    const err = await createGitHubClient(TOKEN, { requestFn }).listReleases().catch((e) => e);
    expect(err.message).toContain('ENOTFOUND');
    expect(err.message).not.toContain(TOKEN);
  });
});

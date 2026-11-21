'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { checkReleaseEnv } = require('../scripts/release');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'release.js');
const STUB = path.join(__dirname, 'helpers', 'stubSpawn.js');
const TOKEN = 'ghp_SEGREDO_NAO_PODE_VAZAR_123456';

function runScript(env, { stub = true } = {}) {
  const baseEnv = { ...process.env };
  delete baseEnv.GH_TOKEN;
  delete baseEnv.STUB_FAIL_AT;
  delete baseEnv.STUB_PUBLISH_FAIL;
  delete baseEnv.STUB_GIT_DIRTY;
  delete baseEnv.STUB_GIT_UNPUSHED;
  const args = stub ? ['-r', STUB, SCRIPT] : [SCRIPT];
  const result = spawnSync(process.execPath, args, { env: { ...baseEnv, ...env }, encoding: 'utf8', cwd: path.join(__dirname, '..') });
  const calls = result.stdout
    .split('\n')
    .filter((line) => line.startsWith('STUB_CALL '))
    .map((line) => JSON.parse(line.slice('STUB_CALL '.length)));
  const publishes = result.stdout
    .split('\n')
    .filter((line) => line.startsWith('STUB_PUBLISH '))
    .map((line) => JSON.parse(line.slice('STUB_PUBLISH '.length)));
  const gits = result.stdout
    .split('\n')
    .filter((line) => line.startsWith('STUB_GIT '))
    .map((line) => JSON.parse(line.slice('STUB_GIT '.length)));
  return { ...result, calls, publishes, gits, all: `${result.stdout}\n${result.stderr}` };
}

describe('scripts/release.js (processo real, spawnSync simulado)', () => {
  test('sem GH_TOKEN: falha em português e não roda nenhum passo', () => {
    const r = runScript({});
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/GH_TOKEN não definido/);
    expect(r.stderr).toMatch(/PowerShell/);
    expect(r.stderr).toMatch(/set GH_TOKEN=/);
    expect(r.calls).toEqual([]);
    expect(r.stdout).not.toMatch(/==>/);
  });

  test('GH_TOKEN vazio ou só espaços também falha sem rodar nada', () => {
    for (const value of ['', '   ']) {
      const r = runScript({ GH_TOKEN: value });
      expect(r.status).toBe(1);
      expect(r.calls).toEqual([]);
    }
  });

  test('sem GH_TOKEN, mesmo sem a simulação, nada é executado (sai antes de qualquer passo)', () => {
    const r = runScript({}, { stub: false });
    expect(r.status).toBe(1);
    expect(r.all).not.toMatch(/==>/);
    expect(r.all).toMatch(/GH_TOKEN não definido/);
  });

  test('com token: testes, stage, empacota sem publicar e só então publica uma vez', () => {
    const r = runScript({ GH_TOKEN: TOKEN });
    expect(r.status).toBe(0);
    expect(r.calls).toHaveLength(3);
    const [tests, stage, build] = r.calls;
    // sem shell: tudo roda por node <script> (sem o aviso DEP0190)
    expect(r.calls.every((c) => c.command === process.execPath)).toBe(true);
    expect(tests.args.slice(1)).toEqual(['run', 'test:all']);
    expect(path.basename(tests.args[0])).toMatch(/^npm-cli\.js$/);
    expect(tests.cwd).toBe(REPO_ROOT);
    expect(stage.args).toEqual(['scripts/stageApp.js']);
    expect(stage.cwd).toBe(path.join(REPO_ROOT, 'desktop'));
    expect(path.basename(path.dirname(build.args[0]))).toBe('electron-builder');
    expect(build.args.slice(1)).toEqual(['--win', '--x64', '--publish', 'never']);
    expect(build.cwd).toBe(path.join(REPO_ROOT, 'desktop'));
    // o electron-builder nunca publica: os alvos em paralelo criavam dois rascunhos
    expect(r.calls.some((c) => c.args.includes('always'))).toBe(false);
    // a release é criada uma única vez, depois do empacotamento, com a versão do package.json
    expect(r.publishes).toHaveLength(1);
    expect(r.publishes[0].index).toBe(3);
    expect(r.publishes[0].version).toBe(require('../package.json').version);
    expect(r.publishes[0].distDir).toBe('dist');
    expect(r.publishes[0].clientIsFake).toBe(true);
    // o rascunho aponta para o SHA do HEAD (git rev-parse HEAD), conferido antes dos testes
    expect(r.publishes[0].targetCommitish).toBe('a'.repeat(40));
    // o token NÃO vai para os subprocessos (testes, stage, empacotamento nem git); nunca por argumento
    expect(r.calls.every((c) => c.hasToken === false)).toBe(true);
    expect(r.gits.length).toBeGreaterThan(0);
    expect(r.gits.every((g) => g.hasToken === false)).toBe(true);
    expect(JSON.stringify(r.calls)).not.toContain(TOKEN);
  });

  test('confere o Git antes de qualquer passo: status sem não rastreados, rev-parse e branch -r --contains', () => {
    const r = runScript({ GH_TOKEN: TOKEN });
    expect(r.gits.map((g) => g.args)).toEqual([
      ['status', '--porcelain', '--untracked-files=no'],
      ['rev-parse', 'HEAD'],
      ['branch', '-r', '--contains', 'a'.repeat(40)],
    ]);
  });

  test('mudanças rastreadas sem commit: recusa em português antes dos testes', () => {
    const r = runScript({ GH_TOKEN: TOKEN, STUB_GIT_DIRTY: '1' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/mudanças rastreadas sem commit/);
    expect(r.stderr).toMatch(/Nada foi publicado/);
    expect(r.calls).toEqual([]);
    expect(r.publishes).toEqual([]);
  });

  test('HEAD fora do remoto: recusa em português antes dos testes', () => {
    const r = runScript({ GH_TOKEN: TOKEN, STUB_GIT_UNPUSHED: '1' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/não está no GitHub/);
    expect(r.calls).toEqual([]);
    expect(r.publishes).toEqual([]);
  });

  test('falha na publicação: sai com 1 e mostra a mensagem', () => {
    const r = runScript({ GH_TOKEN: TOKEN, STUB_PUBLISH_FAIL: '1' });
    expect(r.status).toBe(1);
    expect(r.publishes).toHaveLength(1);
    expect(r.stderr).toMatch(/Falha simulada ao publicar/);
    expect(r.all).not.toContain(TOKEN);
  });

  test('o token nunca aparece na saída (sucesso)', () => {
    const r = runScript({ GH_TOKEN: TOKEN });
    expect(r.all).not.toContain(TOKEN);
    expect(r.all).not.toContain('SEGREDO');
  });

  test.each([0, 1, 2])('falha no passo %i: para, avisa "Nada foi publicado" e não roda os seguintes', (failAt) => {
    const r = runScript({ GH_TOKEN: TOKEN, STUB_FAIL_AT: String(failAt) });
    expect(r.status).toBe(3);
    expect(r.calls).toHaveLength(failAt + 1);
    expect(r.publishes).toEqual([]);
    expect(r.stderr).toMatch(/Nada foi publicado/);
    expect(r.all).not.toContain(TOKEN);
  });

  test('o código-fonte não imprime nem grava o token', () => {
    const fs = require('fs');
    const source = fs.readFileSync(SCRIPT, 'utf8');
    expect(source).not.toMatch(/console\.(log|error|info|warn)\([^)]*GH_TOKEN/);
    expect(source).not.toMatch(/writeFile|appendFile/);
  });
});

describe('checkReleaseEnv (função pura)', () => {
  test('sem GH_TOKEN falha com mensagem em português citando CMD e PowerShell', () => {
    const result = checkReleaseEnv({});
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/GH_TOKEN não definido/);
    expect(result.message).toMatch(/CMD: +set GH_TOKEN=/);
    expect(result.message).toMatch(/PowerShell:/);
    expect(result.message).toMatch(/escopo "repo"/);
    expect(result.message).toMatch(/fine-grained/);
    expect(result.message).toMatch(/Contents: Read and write/);
    expect(checkReleaseEnv({ GH_TOKEN: '   ' }).ok).toBe(false);
  });
  test('com GH_TOKEN segue', () => {
    expect(checkReleaseEnv({ GH_TOKEN: 'abc' }).ok).toBe(true);
  });
});

'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'release.js');
const STUB = path.join(__dirname, 'helpers', 'stubSpawn.js');
const TOKEN = 'ghp_SEGREDO_NAO_PODE_VAZAR_123456';

function runScript(env, { stub = true } = {}) {
  const baseEnv = { ...process.env };
  delete baseEnv.GH_TOKEN;
  delete baseEnv.STUB_FAIL_AT;
  const args = stub ? ['-r', STUB, SCRIPT] : [SCRIPT];
  const result = spawnSync(process.execPath, args, { env: { ...baseEnv, ...env }, encoding: 'utf8', cwd: path.join(__dirname, '..') });
  const calls = result.stdout
    .split('\n')
    .filter((line) => line.startsWith('STUB_CALL '))
    .map((line) => JSON.parse(line.slice('STUB_CALL '.length)));
  return { ...result, calls, all: `${result.stdout}\n${result.stderr}` };
}

describe('scripts/release.js (processo real, spawnSync simulado)', () => {
  test('sem GH_TOKEN: falha em português e não roda nenhum passo', () => {
    const r = runScript({});
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/GH_TOKEN não definido/);
    expect(r.stderr).toMatch(/PowerShell/);
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

  test('com token: testes, stage e electron-builder --publish always, nessa ordem', () => {
    const r = runScript({ GH_TOKEN: TOKEN });
    expect(r.status).toBe(0);
    expect(r.calls).toHaveLength(3);
    const [tests, stage, publish] = r.calls;
    expect([tests.command, ...tests.args]).toEqual(['npm', 'run', 'test:all']);
    expect(path.basename(tests.cwd)).toBe('projeto skins manager');
    expect([stage.command, ...stage.args]).toEqual(['node', 'scripts/stageApp.js']);
    expect(path.basename(stage.cwd)).toBe('desktop');
    expect(publish.command).toBe('npx');
    expect(publish.args).toEqual(['electron-builder', '--win', '--x64', '--publish', 'always']);
    expect(path.basename(publish.cwd)).toBe('desktop');
    // o token é repassado por ambiente (hasToken), nunca por argumento
    expect(r.calls.every((c) => c.hasToken)).toBe(true);
    expect(JSON.stringify(r.calls)).not.toContain(TOKEN);
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

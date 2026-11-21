'use strict';

// QA da revisão da Etapa 7: setVersion rodado sobre CÓPIAS dos package.json/package-lock.json reais do repositório
// (a lista de arquivos bate com os pacotes de verdade; EOL e indentação reais são preservados).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { setVersion, packageFiles, lockFiles } = require('../../scripts/setVersion');

const REPO = path.resolve(__dirname, '..', '..');
const DIRS = ['.', 'backend', 'frontend', 'desktop'];

let copy;
beforeEach(() => {
  copy = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-setver-repo-'));
  for (const dir of DIRS) {
    fs.mkdirSync(path.join(copy, dir), { recursive: true });
    for (const name of ['package.json', 'package-lock.json']) {
      const from = path.join(REPO, dir, name);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(copy, dir, name));
    }
  }
});
afterEach(() => fs.rmSync(copy, { recursive: true, force: true }));

const lines = (text) => text.split('\n');

describe('lista de arquivos x pacotes reais do repositório', () => {
  test('packageFiles e lockFiles apontam exatamente para os package(-lock).json existentes (raiz, backend, frontend, desktop)', () => {
    for (const file of [...packageFiles(REPO), ...lockFiles(REPO)]) expect(fs.existsSync(file)).toBe(true);
    // não há outro pacote com package.json fora da lista (ignorando node_modules, dist e a pasta staging)
    const found = [];
    const walk = (dir, depth) => {
      if (depth > 2) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (['node_modules', '.git', '.next', 'out', 'dist', '.claude', 'docs', 'stage', 'build', '.stage'].includes(entry.name)) continue;
        const sub = path.join(dir, entry.name);
        if (fs.existsSync(path.join(sub, 'package.json'))) found.push(path.relative(REPO, sub));
        walk(sub, depth + 1);
      }
    };
    walk(REPO, 0);
    expect(found.sort()).toEqual(['backend', 'desktop', 'frontend']);
  });

  test('o "name" de cada lock é o do package.json correspondente e as versões partem sincronizadas', () => {
    for (const dir of DIRS) {
      const pkg = JSON.parse(fs.readFileSync(path.join(REPO, dir, 'package.json'), 'utf8'));
      const lock = JSON.parse(fs.readFileSync(path.join(REPO, dir, 'package-lock.json'), 'utf8'));
      expect(lock.name).toBe(pkg.name);
      expect(lock.packages[''].name).toBe(pkg.name);
      expect(lock.version).toBe(pkg.version);
      expect(lock.packages[''].version).toBe(pkg.version);
    }
  });
});

describe('setVersion sobre cópias reais', () => {
  test('troca exatamente 1 linha por package.json e 2 por package-lock.json, preservando EOL e o resto', () => {
    const before = {};
    for (const dir of DIRS) {
      for (const name of ['package.json', 'package-lock.json']) before[`${dir}/${name}`] = fs.readFileSync(path.join(copy, dir, name), 'utf8');
    }
    setVersion('7.8.9', { rootDir: copy });
    for (const [key, text] of Object.entries(before)) {
      const after = fs.readFileSync(path.join(copy, key), 'utf8');
      const a = lines(text);
      const b = lines(after);
      expect(b).toHaveLength(a.length);
      const changed = a.map((l, i) => [l, b[i]]).filter(([x, y]) => x !== y);
      expect(changed).toHaveLength(key.endsWith('package-lock.json') ? 2 : 1);
      for (const [, y] of changed) expect(y).toMatch(/"version": "7\.8\.9"/);
      // EOL idêntico (CRLF da raiz continua CRLF, LF continua LF)
      expect(after.includes('\r\n')).toBe(text.includes('\r\n'));
      expect((after.match(/\r\n/g) || []).length).toBe((text.match(/\r\n/g) || []).length);
      // indentação das linhas trocadas preservada
      for (const [x, y] of changed) expect(y.match(/^\s*/)[0]).toBe(x.match(/^\s*/)[0]);
    }
  });

  test('depois da troca, package.json e lock continuam JSON válido, sincronizados, e as dependências ficam intactas', () => {
    const originalLocks = {};
    for (const dir of DIRS) originalLocks[dir] = JSON.parse(fs.readFileSync(path.join(copy, dir, 'package-lock.json'), 'utf8'));
    setVersion('2.0.0', { rootDir: copy });
    for (const dir of DIRS) {
      const pkg = JSON.parse(fs.readFileSync(path.join(copy, dir, 'package.json'), 'utf8'));
      const lock = JSON.parse(fs.readFileSync(path.join(copy, dir, 'package-lock.json'), 'utf8'));
      expect(pkg.version).toBe('2.0.0');
      expect(lock.version).toBe('2.0.0');
      expect(lock.packages[''].version).toBe('2.0.0');
      // o resto do lock é igual ao original (nenhuma versão de dependência mudou)
      const expected = JSON.parse(JSON.stringify(originalLocks[dir]));
      expected.version = '2.0.0';
      expected.packages[''].version = '2.0.0';
      expect(lock).toEqual(expected);
    }
  });

  test('versão inválida: lança antes de gravar qualquer arquivo (cópias byte a byte iguais)', () => {
    const snapshot = () =>
      DIRS.flatMap((d) => ['package.json', 'package-lock.json'].map((n) => fs.readFileSync(path.join(copy, d, n), 'utf8'))).join('\u0000');
    const before = snapshot();
    for (const bad of ['1.2', 'v1.2.3', '1.2.3-beta.1', '1.2.3+build', '01.2.3', '1.2.3 ', '', null, undefined, 123, {}]) {
      expect(() => setVersion(bad, { rootDir: copy })).toThrow(/Versão inválida/);
    }
    expect(snapshot()).toBe(before);
  });

  test('idempotente: rodar duas vezes com a mesma versão não muda nada na segunda', () => {
    setVersion('3.1.4', { rootDir: copy });
    const once = fs.readFileSync(path.join(copy, 'package-lock.json'), 'utf8');
    setVersion('3.1.4', { rootDir: copy });
    expect(fs.readFileSync(path.join(copy, 'package-lock.json'), 'utf8')).toBe(once);
  });

  test('a CLI (node scripts/setVersion.js) recusa versão inválida com exit 1 e mensagem em português; sem argumento também', () => {
    const script = path.join(REPO, 'scripts', 'setVersion.js');
    for (const args of [['abc'], ['1.2'], []]) {
      const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: copy });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Versão inválida/);
    }
  });

  test('sem versão no package.json de um dos pacotes: lança e não grava nenhum arquivo, nem os locks', () => {
    fs.writeFileSync(path.join(copy, 'desktop', 'package.json'), '{"name":"d"}');
    const lockBefore = fs.readFileSync(path.join(copy, 'package-lock.json'), 'utf8');
    expect(() => setVersion('5.5.5', { rootDir: copy })).toThrow(/não tem o campo "version"/);
    expect(fs.readFileSync(path.join(copy, 'package-lock.json'), 'utf8')).toBe(lockBefore);
    expect(fs.readFileSync(path.join(copy, 'package.json'), 'utf8')).toContain('"version": "1.0.0"');
  });
});

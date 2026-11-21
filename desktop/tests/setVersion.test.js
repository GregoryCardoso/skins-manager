'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { setVersion, packageFiles, lockFiles, updateLockText } = require('../../scripts/setVersion');

// Cada arquivo com um estilo diferente de formatação (indentação, EOL e chaves extras).
const SAMPLES = {
  '.': '{\n  "name": "a",\n  "version": "1.0.0",\n  "scripts": { "x": "y" }\n}\n',
  backend: '{\r\n    "name": "b",\r\n    "version": "1.0.0",\r\n    "dependencies": { "z": "^1.0.0" }\r\n}\r\n',
  frontend: '{\n\t"name": "c",\n\t"version": "1.0.0"\n}',
  desktop: '{"name":"d","version":"1.0.0","devDependencies":{"e":"1.0.0"}}\n',
};

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setversion-'));
  for (const [sub, text] of Object.entries(SAMPLES)) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
    fs.writeFileSync(path.join(dir, sub, 'package.json'), text);
  }
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const read = (sub) => fs.readFileSync(path.join(dir, sub, 'package.json'), 'utf8');

// package-lock.json: versão na raiz e em packages[""]; uma dependência com o mesmo número não pode mudar.
const lockSample = (name, eol, indent) =>
  [
    '{',
    `${indent}"name": "${name}",`,
    `${indent}"version": "1.0.0",`,
    `${indent}"lockfileVersion": 3,`,
    `${indent}"packages": {`,
    `${indent}${indent}"": {`,
    `${indent}${indent}${indent}"name": "${name}",`,
    `${indent}${indent}${indent}"version": "1.0.0",`,
    `${indent}${indent}${indent}"dependencies": { "z": "^1.0.0" }`,
    `${indent}${indent}},`,
    `${indent}${indent}"node_modules/z": {`,
    `${indent}${indent}${indent}"version": "1.0.0"`,
    `${indent}${indent}}`,
    `${indent}}`,
    '}',
    '',
  ].join(eol);

describe('setVersion e package-lock.json', () => {
  const LOCKS = {
    '.': lockSample('a', '\n', '  '),
    backend: lockSample('b', '\r\n', '    '),
    desktop: lockSample('d', '\n', '\t'),
  };
  beforeEach(() => {
    for (const [sub, text] of Object.entries(LOCKS)) fs.writeFileSync(path.join(dir, sub, 'package-lock.json'), text);
  });

  test('atualiza o version da raiz e de packages[""], sem tocar em dependências nem no formato', () => {
    setVersion('2.0.0', { rootDir: dir });
    for (const [sub, text] of Object.entries(LOCKS)) {
      const out = fs.readFileSync(path.join(dir, sub, 'package-lock.json'), 'utf8');
      const json = JSON.parse(out);
      expect(json.version).toBe('2.0.0');
      expect(json.packages[''].version).toBe('2.0.0');
      expect(json.packages['node_modules/z'].version).toBe('1.0.0');
      // só duas linhas mudam
      const before = text.split(/\r?\n/);
      const after = out.split(/\r?\n/);
      expect(after.filter((line, i) => line !== before[i])).toHaveLength(2);
      expect(out.includes('\r\n')).toBe(text.includes('\r\n'));
    }
  });

  test('pasta sem package-lock.json (frontend) é ignorada', () => {
    expect(fs.existsSync(path.join(dir, 'frontend', 'package-lock.json'))).toBe(false);
    expect(() => setVersion('2.0.1', { rootDir: dir })).not.toThrow();
  });

  test('versão inválida não altera os locks', () => {
    expect(() => setVersion('x', { rootDir: dir })).toThrow(/inválida/);
    expect(fs.readFileSync(path.join(dir, 'backend', 'package-lock.json'), 'utf8')).toBe(LOCKS.backend);
  });

  test('lockFiles lista os quatro package-lock.json', () => {
    expect(lockFiles(dir).map((f) => path.relative(dir, f))).toEqual([
      'package-lock.json',
      path.join('backend', 'package-lock.json'),
      path.join('frontend', 'package-lock.json'),
      path.join('desktop', 'package-lock.json'),
    ]);
  });
});

describe('setVersion', () => {
  test('atualiza os quatro arquivos e preserva o resto byte a byte', () => {
    setVersion('2.10.3', { rootDir: dir });
    for (const [sub, text] of Object.entries(SAMPLES)) {
      expect(read(sub)).toBe(text.replace('"version": "1.0.0"', '"version": "2.10.3"').replace('"version":"1.0.0"', '"version":"2.10.3"'));
      expect(JSON.parse(read(sub)).version).toBe('2.10.3');
    }
  });

  test('não mexe nas versões de dependências', () => {
    setVersion('3.0.0', { rootDir: dir });
    expect(JSON.parse(read('desktop')).devDependencies.e).toBe('1.0.0');
    expect(JSON.parse(read('backend')).dependencies.z).toBe('^1.0.0');
  });

  test.each(['1.0', '1', 'v1.0.0', '1.0.0-beta', '01.0.0', '1.0.0.0', 'abc', '', ' 1.0.0', undefined, null, 100])(
    'recusa %p sem alterar nada',
    (bad) => {
      expect(() => setVersion(bad, { rootDir: dir })).toThrow(/inválida/);
      for (const [sub, text] of Object.entries(SAMPLES)) expect(read(sub)).toBe(text);
    }
  );

  test('se um arquivo está sem "version", falha antes de gravar qualquer um', () => {
    fs.writeFileSync(path.join(dir, 'desktop', 'package.json'), '{"name":"d"}');
    expect(() => setVersion('1.1.0', { rootDir: dir })).toThrow(/version/);
    expect(read('.')).toBe(SAMPLES['.']);
  });

  test('packageFiles lista os quatro package.json', () => {
    expect(packageFiles(dir).map((f) => path.relative(dir, f))).toEqual([
      'package.json',
      path.join('backend', 'package.json'),
      path.join('frontend', 'package.json'),
      path.join('desktop', 'package.json'),
    ]);
  });
});

describe('updateLockText: só o bloco packages[""]', () => {
  const lock = (rootPkg) =>
    JSON.stringify({ name: 'a', version: '1.0.0', lockfileVersion: 3, packages: { '': rootPkg, 'node_modules/z': { version: '1.0.0' } } }, null, 2);

  test('packages[""] sem "version" não altera a versão de uma dependência', () => {
    const parsed = JSON.parse(updateLockText(lock({ name: 'a' }), '9.9.9'));
    expect(parsed.version).toBe('9.9.9');
    expect(parsed.packages[''].version).toBeUndefined();
    expect(parsed.packages['node_modules/z'].version).toBe('1.0.0');
  });

  test('packages[""] com "version": troca só ele e a raiz', () => {
    const parsed = JSON.parse(updateLockText(lock({ name: 'a', version: '1.0.0' }), '1.0.1'));
    expect(parsed.version).toBe('1.0.1');
    expect(parsed.packages[''].version).toBe('1.0.1');
    expect(parsed.packages['node_modules/z'].version).toBe('1.0.0');
  });
});

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { setVersion, packageFiles } = require('../../scripts/setVersion');

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

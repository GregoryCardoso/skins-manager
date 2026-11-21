'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { isExcluded, copyBackend, copyFrontend } = require('../scripts/stageApp');

describe('isExcluded', () => {
  test.each([
    '.env',
    '.env.local',
    'inventory.sqlite',
    'inventory.sqlite-wal',
    'inventory.dev.sqlite-shm',
    path.join('data', 'backups', 'x.bin'),
    path.join('data', 'tmp'),
    path.join('node_modules', 'a', 'b.js'),
    'skins-manager.lock',
    'debug.log',
  ])('exclui %s', (file) => {
    expect(isExcluded(file)).toBe(true);
  });

  test.each(['server.js', path.join('src', 'app.js'), path.join('seed', 'catalog.json'), 'package-lock.json'])('mantém %s', (file) => {
    expect(isExcluded(file)).toBe(false);
  });
});

describe('copyBackend / copyFrontend', () => {
  let root;
  let stage;
  const put = (rel, content = 'x') => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-stage-src-'));
    stage = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-stage-dst-'));
    put('backend/server.js');
    put('backend/package.json', '{}');
    put('backend/package-lock.json', '{}');
    put('backend/.env', 'SEGREDO=1');
    put('backend/src/app.js');
    put('backend/src/.env', 'SEGREDO=2');
    put('backend/data/seed/catalog.json', '{}');
    put('backend/data/inventory.sqlite', 'DADOS PESSOAIS');
    put('backend/data/inventory.sqlite-wal', 'DADOS PESSOAIS');
    put('backend/data/inventory.dev.sqlite', 'DADOS');
    put('backend/data/backups/auto.sqlite', 'DADOS');
    put('backend/data/tmp/import.bin', 'DADOS');
    put('backend/tests/a.test.js');
    put('frontend/out/index.html', '<html></html>');
    put('frontend/out/_next/static/a.js');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(stage, { recursive: true, force: true });
  });

  const listAll = (dir, base = dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? listAll(full, base) : [path.relative(base, full).split(path.sep).join('/')];
    });

  test('o backend do stage nunca leva banco, backups, tmp, .env nem testes', () => {
    copyBackend({ rootDir: root, stageDir: stage });
    expect(listAll(stage).sort()).toEqual([
      'backend/data/seed/catalog.json',
      'backend/package-lock.json',
      'backend/package.json',
      'backend/server.js',
      'backend/src/app.js',
    ]);
  });

  test('preserva node_modules do stage entre execuções', () => {
    const modules = path.join(stage, 'backend', 'node_modules', 'x');
    fs.mkdirSync(modules, { recursive: true });
    fs.writeFileSync(path.join(modules, 'index.js'), 'ok');
    copyBackend({ rootDir: root, stageDir: stage });
    expect(fs.existsSync(path.join(modules, 'index.js'))).toBe(true);
  });

  test('copia o frontend exportado', () => {
    copyFrontend({ rootDir: root, stageDir: stage });
    expect(fs.existsSync(path.join(stage, 'frontend', 'out', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(stage, 'frontend', 'out', '_next', 'static', 'a.js'))).toBe(true);
  });

  test('sem frontend compilado: erro claro', () => {
    fs.rmSync(path.join(root, 'frontend'), { recursive: true, force: true });
    expect(() => copyFrontend({ rootDir: root, stageDir: stage })).toThrow('frontend/out/index.html');
  });
});

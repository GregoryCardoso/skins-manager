'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { copyBackend, copyFrontend } = require('../scripts/stageApp');

describe('stageApp: incremental e sem tocar a origem', () => {
  let root;
  let stage;
  const put = (rel, content = 'x') => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-stage2-src-'));
    stage = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-stage2-dst-'));
    put('backend/server.js');
    put('backend/package.json', '{}');
    put('backend/package-lock.json', '{}');
    put('backend/src/app.js');
    put('backend/data/seed/catalog.json', '{}');
    put('backend/data/inventory.sqlite', 'DADOS PESSOAIS');
    put('backend/data/LEIA-ME-DADOS-MOVIDOS.txt', 'aviso');
    put('backend/node_modules/x/index.js', 'origem');
    put('frontend/out/index.html', '<html></html>');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(stage, { recursive: true, force: true });
  });

  test('arquivo removido na origem some do stage; o alterado é atualizado', () => {
    copyBackend({ rootDir: root, stageDir: stage });
    fs.rmSync(path.join(root, 'backend', 'src', 'app.js'));
    put('backend/src/novo.js', 'novo');
    put('backend/server.js', 'v2');
    copyBackend({ rootDir: root, stageDir: stage });
    expect(fs.existsSync(path.join(stage, 'backend', 'src', 'app.js'))).toBe(false);
    expect(fs.readFileSync(path.join(stage, 'backend', 'src', 'novo.js'), 'utf8')).toBe('novo');
    expect(fs.readFileSync(path.join(stage, 'backend', 'server.js'), 'utf8')).toBe('v2');
  });

  test('não toca backend/node_modules, o banco nem o LEIA-ME da origem; nada disso vai ao stage', () => {
    copyBackend({ rootDir: root, stageDir: stage });
    copyFrontend({ rootDir: root, stageDir: stage });
    expect(fs.readFileSync(path.join(root, 'backend', 'node_modules', 'x', 'index.js'), 'utf8')).toBe('origem');
    expect(fs.readFileSync(path.join(root, 'backend', 'data', 'inventory.sqlite'), 'utf8')).toBe('DADOS PESSOAIS');
    expect(fs.existsSync(path.join(stage, 'backend', 'node_modules'))).toBe(false);
    expect(fs.existsSync(path.join(stage, 'backend', 'data', 'inventory.sqlite'))).toBe(false);
    expect(fs.existsSync(path.join(stage, 'backend', 'data', 'LEIA-ME-DADOS-MOVIDOS.txt'))).toBe(false);
  });

  test('o npm ci roda no backend do STAGE, nunca em backend/', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'stageApp.js'), 'utf8');
    expect(src).toMatch(/const backendDir = copyBackend\(\)/);
    expect(src).toMatch(/runNpm\(\['ci', '--omit=dev'[^\n]*\{ cwd: backendDir \}/);
    expect(src).not.toMatch(/ROOT_DIR, 'backend', 'node_modules'/);
  });
});

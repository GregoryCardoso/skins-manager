'use strict';

// 7.4: confere electron-builder.yml, paths.js em modo empacotado e (se existir) o conteúdo real de dist/win-unpacked.
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { resolveAppRoot, resolveAppPaths, resolveDataDir, resolveDataPaths, PACKAGED_APP_DIR_NAME } = require('../src/lib/paths');

const DESKTOP_DIR = path.join(__dirname, '..');
const cfg = yaml.load(fs.readFileSync(path.join(DESKTOP_DIR, 'electron-builder.yml'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, 'package.json'), 'utf8'));
const rootPkg = JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, '..', 'package.json'), 'utf8'));

describe('electron-builder.yml (parseado)', () => {
  test('NSIS por usuário, assistido, dados preservados, pt-BR', () => {
    expect(cfg.nsis.oneClick).toBe(false);
    expect(cfg.nsis.perMachine).toBe(false);
    expect(cfg.nsis.deleteAppDataOnUninstall).toBe(false);
    expect(String(cfg.nsis.language)).toBe('1046');
  });

  test('alvos nsis e portable, ambos x64', () => {
    const targets = cfg.win.target.map((t) => [t.target, t.arch]);
    expect(targets).toEqual(expect.arrayContaining([['nsis', 'x64'], ['portable', 'x64']]));
    expect(targets).toHaveLength(2);
  });

  test('nomes de artefato trazem a versão', () => {
    expect(cfg.nsis.artifactName).toContain('${version}');
    expect(cfg.portable.artifactName).toContain('${version}');
    expect(cfg.nsis.artifactName).not.toBe(cfg.portable.artifactName);
  });

  test('asar ativo e só src/ + package.json dentro dele', () => {
    expect(cfg.asar).toBe(true);
    expect(cfg.files).toEqual(['package.json', 'src/**/*']);
    expect(cfg.files.join(' ')).not.toMatch(/backend|\.stage/);
  });

  test('extraResources leva .stage para a pasta que o main procura', () => {
    expect(cfg.extraResources).toHaveLength(1);
    expect(cfg.extraResources[0].from).toBe('.stage');
    expect(cfg.extraResources[0].to).toBe(PACKAGED_APP_DIR_NAME);
    expect(PACKAGED_APP_DIR_NAME).not.toBe('app');
  });

  test('extraResources não traz dados, segredos, logs nem testes', () => {
    const filters = cfg.extraResources[0].filter.join('\n');
    expect(filters).not.toMatch(/\.sqlite|\.env|LEIA-ME-DADOS-MOVIDOS|\btmp\b|logs/);
    const dataIncludes = cfg.extraResources[0].filter.filter((f) => !f.startsWith('!') && /data/.test(f));
    for (const f of dataIncludes) expect(f).toMatch(/seed/);
  });

  test('extraResources exclui better-sqlite3/build (sobras com o caminho da máquina)', () => {
    expect(cfg.extraResources[0].filter).toContain('!**/better-sqlite3/build/**');
  });

  test('publish aponta para o repositório e o dist não publica', () => {
    expect(cfg.publish).toEqual({ provider: 'github', owner: 'GregoryCardoso', repo: 'skins-manager', releaseType: 'draft' });
    expect(pkg.scripts.dist).toMatch(/--publish never/);
    expect(pkg.scripts.dist).toMatch(/--x64/);
    expect(rootPkg.scripts['desktop:dist']).toMatch(/desktop/);
  });
});

describe('paths.js empacotado, com espaços', () => {
  const cases = [
    'C:\\Program Files\\Skins Manager\\resources',
    'C:\\Users\\Ana Maria\\AppData\\Local\\Programs\\Skins Manager\\resources',
    'C:\\Users\\gregory\\Desktop\\projeto skins manager\\desktop\\dist\\win-unpacked\\resources',
  ];
  test.each(cases)('acha server.js e frontend em %s', (resourcesPath) => {
    const root = resolveAppRoot({ isPackaged: true, resourcesPath, desktopDir: 'X' });
    const p = resolveAppPaths(root);
    expect(p.backendEntry).toBe(path.join(resourcesPath, 'skins-manager', 'backend', 'server.js'));
    expect(p.backendDir).toBe(path.join(resourcesPath, 'skins-manager', 'backend'));
    expect(p.frontendIndex).toBe(path.join(resourcesPath, 'skins-manager', 'frontend', 'out', 'index.html'));
  });

  test('modo dev ignora resourcesPath', () => {
    const desktopDir = path.join('C:', 'projeto skins manager', 'desktop');
    const p = resolveAppPaths(resolveAppRoot({ isPackaged: false, resourcesPath: 'C:\\Program Files\\x\\resources', desktopDir }));
    expect(p.backendEntry).toBe(path.join(desktopDir, '.stage', 'backend', 'server.js'));
  });

  test('dados ficam no APPDATA, nunca em resources/instalação, mesmo com espaço no nome', () => {
    const dataDir = resolveDataDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\Ana Maria\\AppData\\Roaming' }, homedir: 'X' });
    expect(dataDir).toBe('C:\\Users\\Ana Maria\\AppData\\Roaming\\SkinsManager');
    const all = Object.values(resolveDataPaths(dataDir)).join('\n').toLowerCase();
    for (const resourcesPath of cases) expect(all).not.toContain(resourcesPath.toLowerCase());
    expect(all).not.toContain('program files');
    expect(all).not.toContain('\\resources\\');
    expect(resolveDataPaths(dataDir).dbPath.endsWith('\\inventory.sqlite')).toBe(true);
  });
});

describe('mesma versão nos quatro package.json', () => {
  // Não fixa o número: o version:set muda os quatro juntos (D182).
  test('raiz, backend, frontend e desktop têm a mesma versão, em semver x.y.z', () => {
    const versions = ['..', '../backend', '../frontend', '.'].map(
      (dir) => JSON.parse(fs.readFileSync(path.join(DESKTOP_DIR, dir, 'package.json'), 'utf8')).version,
    );
    expect(versions[0]).toMatch(/^(0|[1-9]d*).(0|[1-9]d*).(0|[1-9]d*)$/);
    expect(new Set(versions).size).toBe(1);
  });
});

// Só roda se o build existir (desktop/dist não é versionado).
const RES = path.join(DESKTOP_DIR, 'dist', 'win-unpacked', 'resources');
const describeDist = fs.existsSync(RES) ? describe : describe.skip;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    out.push(full);
    if (e.isDirectory()) walk(full, out);
  }
  return out;
}

describeDist('dist/win-unpacked/resources (build real)', () => {
  const app = path.join(RES, 'skins-manager');
  const files = fs.existsSync(app) ? walk(app) : [];
  const rel = (f) => path.relative(app, f).replace(/\\/g, '/');

  test('estrutura mínima e seed', () => {
    expect(fs.existsSync(path.join(app, 'backend', 'server.js'))).toBe(true);
    expect(fs.existsSync(path.join(app, 'frontend', 'out', 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(app, 'backend', 'data', 'seed', 'catalog.json'))).toBe(true);
    expect(fs.existsSync(path.join(RES, 'app.asar'))).toBe(true);
    expect(fs.existsSync(path.join(RES, 'app'))).toBe(false);
  });

  test('sem banco, .env, lock, logs, .git nem aviso de dados movidos', () => {
    const bad = files.filter((f) => {
      const r = rel(f);
      const base = path.basename(f).toLowerCase();
      if (/package-lock\.json$/.test(base)) return false;
      return (
        /\.sqlite|-wal$|-shm$|\.lock$|^\.env|^inventory\./.test(base) ||
        base === 'leia-me-dados-movidos.txt' ||
        /(^|\/)(\.git|logs|tmp)$/.test(r) ||
        /^backend\/data\/(?!seed(\/|$))/.test(r)
      );
    });
    expect(bad.map(rel)).toEqual([]);
  });

  test('não há pasta tests/ do projeto (backend/tests, frontend/tests)', () => {
    expect(files.map(rel).filter((r) => /^(backend|frontend)\/tests?(\/|$)/.test(r))).toEqual([]);
  });

  test('nenhum texto de resources cita o caminho ou usuário da máquina de build', () => {
    const hits = [];
    for (const f of [...files, path.join(RES, 'app-update.yml')]) {
      if (!fs.existsSync(f) || !fs.statSync(f).isFile() || fs.statSync(f).size > 5000000) continue;
      if (/\.(node|png|ico|jpg|jpeg|webp|woff2?|exe)$/i.test(f)) continue;
      const text = fs.readFileSync(f, 'latin1');
      if (/C:\\Users\\|[\\/]gregory[\\/]|skins manager\\desktop/i.test(text)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });

  test('better-sqlite3 só com win32-x64.node', () => {
    const nodes = files.filter((f) => f.endsWith('.node')).map(rel);
    expect(nodes).toEqual(['backend/node_modules/better-sqlite3/prebuilds/win32-x64.node']);
    expect(fs.readdirSync(path.join(app, 'backend', 'node_modules', 'better-sqlite3', 'prebuilds'))).toEqual(['win32-x64.node']);
  });
});

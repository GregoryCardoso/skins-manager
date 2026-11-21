const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { resolveDefaultDataDir } = require('../../src/config/paths');
const { acquireLock, assessExistingLock } = require('../../src/config/instanceLock');
const { planLegacyMigration, runLegacyMigration } = require('../../src/config/legacyDataMigration');
const { resolveRealDbPaths } = require('../../scripts/devDb');

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-datadir-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('resolveDefaultDataDir', () => {
  test('Windows usa APPDATA', () => {
    expect(resolveDefaultDataDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, homedir: 'C:\\Users\\a' })).toBe(
      'C:\\Users\\a\\AppData\\Roaming\\SkinsManager'
    );
  });
  test('Windows sem APPDATA cai no perfil do usuário', () => {
    expect(resolveDefaultDataDir({ platform: 'win32', env: {}, homedir: 'C:\\Users\\a' })).toBe('C:\\Users\\a\\AppData\\Roaming\\SkinsManager');
  });
  test('fora do Windows usa ~/.skins-manager', () => {
    expect(resolveDefaultDataDir({ platform: 'linux', env: {}, homedir: '/home/a' })).toBe('/home/a/.skins-manager');
  });
});

describe('instanceLock', () => {
  test('assessExistingLock: vivo bloqueia; morto, ilegível ou sem pid são velhos', () => {
    const live = JSON.stringify({ pid: 5, port: 3001, mode: 'browser' });
    expect(assessExistingLock(live, () => true).stale).toBe(false);
    expect(assessExistingLock(live, () => false).stale).toBe(true);
    expect(assessExistingLock('lixo{', () => true).stale).toBe(true);
    expect(assessExistingLock('{"pid":"x"}', () => true).stale).toBe(true);
  });

  test('segunda instância é recusada; após release, volta a funcionar', () => {
    const first = acquireLock(tmp, { pid: 111, port: 3001, isAlive: () => true });
    expect(() => acquireLock(tmp, { pid: 222, isAlive: () => true })).toThrow(/start-app\.bat em http:\/\/localhost:3001/);
    try {
      acquireLock(tmp, { pid: 222, isAlive: () => true });
    } catch (err) {
      expect(err.code).toBe('DATA_DIR_LOCKED');
      expect(err.status).toBe(409);
    }
    first.release();
    acquireLock(tmp, { pid: 222, isAlive: () => true }).release();
  });

  test('mensagem do modo desktop', () => {
    acquireLock(tmp, { pid: 1, mode: 'desktop', isAlive: () => true });
    expect(() => acquireLock(tmp, { pid: 2, isAlive: () => true })).toThrow('app desktop');
  });

  test('trava órfã de processo morto é sobrescrita', () => {
    fs.writeFileSync(path.join(tmp, 'skins-manager.lock'), JSON.stringify({ pid: 999999, port: 3001, mode: 'browser' }));
    const lock = acquireLock(tmp, { pid: 333, isAlive: () => false });
    expect(JSON.parse(fs.readFileSync(lock.lockPath, 'utf8')).pid).toBe(333);
    lock.release();
    expect(fs.existsSync(lock.lockPath)).toBe(false);
  });

  test('release não apaga a trava de outro processo', () => {
    const lock = acquireLock(tmp, { pid: 10, isAlive: () => true });
    fs.writeFileSync(lock.lockPath, JSON.stringify({ pid: 20 }));
    lock.release();
    expect(fs.existsSync(lock.lockPath)).toBe(true);
  });
});

describe('legacyDataMigration', () => {
  test('planLegacyMigration', () => {
    expect(planLegacyMigration({ dbPathIsDefault: true, newDbExists: false, legacyDbExists: true }).action).toBe('migrate');
    expect(planLegacyMigration({ dbPathIsDefault: false, newDbExists: false, legacyDbExists: true }).action).toBe('skip');
    expect(planLegacyMigration({ dbPathIsDefault: true, newDbExists: true, legacyDbExists: true }).action).toBe('skip');
    expect(planLegacyMigration({ dbPathIsDefault: true, newDbExists: false, legacyDbExists: false }).action).toBe('skip');
  });

  function makeLegacy() {
    const legacyDir = path.join(tmp, 'legacy');
    fs.mkdirSync(path.join(legacyDir, 'backups'), { recursive: true });
    const db = new Database(path.join(legacyDir, 'inventory.sqlite'));
    db.pragma('journal_mode = WAL');
    db.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('legado');");
    db.close();
    fs.writeFileSync(path.join(legacyDir, 'backups', 'a.sqlite'), 'x');
    return legacyDir;
  }

  test('copia o banco e os backups, mantém o original e grava a nota', () => {
    const legacyDir = makeLegacy();
    const dbPath = path.join(tmp, 'new', 'inventory.sqlite');
    expect(runLegacyMigration({ dbPathIsDefault: true, dbPath, legacyDir, log: jest.fn() }).action).toBe('migrate');
    const copy = new Database(dbPath, { readonly: true });
    expect(copy.prepare('SELECT v FROM t').get().v).toBe('legado');
    copy.close();
    expect(fs.existsSync(path.join(tmp, 'new', 'backups', 'a.sqlite'))).toBe(true);
    expect(fs.existsSync(path.join(legacyDir, 'inventory.sqlite'))).toBe(true);
    expect(fs.existsSync(path.join(legacyDir, 'LEIA-ME-DADOS-MOVIDOS.txt'))).toBe(true);
  });

  test('nunca sobrescreve um banco já existente no destino', () => {
    const legacyDir = makeLegacy();
    const dbPath = path.join(tmp, 'new', 'inventory.sqlite');
    fs.mkdirSync(path.dirname(dbPath));
    fs.writeFileSync(dbPath, 'meu banco');
    runLegacyMigration({ dbPathIsDefault: true, dbPath, legacyDir, log: jest.fn() });
    expect(fs.readFileSync(dbPath, 'utf8')).toBe('meu banco');
  });

  test('falha na cópia apaga o destino parcial e lança erro em português', () => {
    const legacyDir = path.join(tmp, 'legacy');
    fs.mkdirSync(legacyDir);
    fs.writeFileSync(path.join(legacyDir, 'inventory.sqlite'), 'isto nao e um sqlite');
    const dbPath = path.join(tmp, 'new', 'inventory.sqlite');
    expect(() => runLegacyMigration({ dbPathIsDefault: true, dbPath, legacyDir, log: jest.fn() })).toThrow(/Não foi possível copiar/);
    expect(fs.existsSync(dbPath)).toBe(false);
    expect(fs.existsSync(path.join(legacyDir, 'inventory.sqlite'))).toBe(true);
  });

  test('DB_PATH explícito nunca migra', () => {
    const legacyDir = makeLegacy();
    const dbPath = path.join(tmp, 'x.sqlite');
    expect(runLegacyMigration({ dbPathIsDefault: false, dbPath, legacyDir, log: jest.fn() }).action).toBe('skip');
    expect(fs.existsSync(dbPath)).toBe(false);
  });
});

describe('devDb protege os dois caminhos reais', () => {
  test('resolveRealDbPaths inclui o novo padrão e o antigo', () => {
    const paths = resolveRealDbPaths({ envFile: path.join(tmp, 'nao-existe'), env: {} }).map((p) => p.toLowerCase());
    const dataDirDb = path.join(resolveDefaultDataDir(), 'inventory.sqlite').toLowerCase();
    expect(paths).toContain(dataDirDb);
    expect(paths.some((p) => p.endsWith(path.join('backend', 'data', 'inventory.sqlite').toLowerCase()))).toBe(true);
  });
});

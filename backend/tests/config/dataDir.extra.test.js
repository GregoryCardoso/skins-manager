// 7.2 - complementos: resolveDefaultDataDir (bordas), migração legada (WAL, bytes, backups, corrupção), trava (pid reuse, JSON).
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { resolveDefaultDataDir } = require('../../src/config/paths');
const { acquireLock, assessExistingLock, isProcessAlive, LOCK_FILE_NAME } = require('../../src/config/instanceLock');
const { runLegacyMigration, copyLegacyData, NOTE_FILE_NAME } = require('../../src/config/legacyDataMigration');

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-dd2-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

describe('resolveDefaultDataDir - bordas', () => {
  test('APPDATA vazio, só espaços ou não-string cai no perfil', () => {
    for (const APPDATA of ['', '   ', undefined, 5]) {
      expect(resolveDefaultDataDir({ platform: 'win32', env: { APPDATA }, homedir: 'C:\\Users\\a' })).toBe(
        'C:\\Users\\a\\AppData\\Roaming\\SkinsManager'
      );
    }
  });
  test('APPDATA com espaços nas pontas é aparado; darwin usa ~/.skins-manager', () => {
    expect(resolveDefaultDataDir({ platform: 'win32', env: { APPDATA: '  D:\\Roam  ' }, homedir: 'C:\\u' })).toBe('D:\\Roam\\SkinsManager');
    expect(resolveDefaultDataDir({ platform: 'darwin', env: { APPDATA: 'X' }, homedir: '/Users/a' })).toBe('/Users/a/.skins-manager');
  });
  test('padrão sem argumentos no Windows usa o APPDATA do ambiente de teste (temporário, nunca o real)', () => {
    if (process.platform !== 'win32') return;
    const dir = resolveDefaultDataDir();
    expect(dir.toLowerCase()).toBe(path.win32.join(process.env.APPDATA, 'SkinsManager').toLowerCase());
    expect(process.env.APPDATA.toLowerCase().startsWith(os.tmpdir().toLowerCase())).toBe(true);
  });
});

describe('legacyDataMigration - cenários completos', () => {
  const legacyDirOf = () => path.join(tmp, 'legacy');

  // Banco legado com dados que ficam SÓ no WAL (autocheckpoint desligado); a conexão devolvida segue aberta.
  function makeLegacyWithWal() {
    const legacyDir = legacyDirOf();
    fs.mkdirSync(path.join(legacyDir, 'backups'), { recursive: true });
    const db = new Database(path.join(legacyDir, 'inventory.sqlite'));
    db.pragma('journal_mode = WAL');
    db.pragma('wal_autocheckpoint = 0');
    db.exec('CREATE TABLE t (v TEXT)');
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.exec("INSERT INTO t VALUES ('so-no-wal')");
    return { legacyDir, db };
  }

  test('dados que estão só no WAL chegam ao destino; original (arquivo principal) byte a byte intacto', () => {
    const { legacyDir, db } = makeLegacyWithWal();
    try {
      expect(fs.statSync(path.join(legacyDir, 'inventory.sqlite-wal')).size).toBeGreaterThan(0);
      const before = sha(path.join(legacyDir, 'inventory.sqlite'));
      const dbPath = path.join(tmp, 'new', 'inventory.sqlite');
      runLegacyMigration({ dbPathIsDefault: true, dbPath, legacyDir, log: jest.fn() });
      const copy = new Database(dbPath, { readonly: true });
      expect(copy.prepare('SELECT v FROM t').all()).toEqual([{ v: 'so-no-wal' }]);
      expect(copy.pragma('quick_check', { simple: true })).toBe('ok');
      copy.close();
      expect(sha(path.join(legacyDir, 'inventory.sqlite'))).toBe(before);
      expect(db.prepare('SELECT COUNT(*) c FROM t').get().c).toBe(1);
    } finally {
      db.close();
    }
  });

  test('legado "órfão" (arquivos principal + -wal copiados, sem processo vivo e sem -shm) também migra', () => {
    const { legacyDir, db } = makeLegacyWithWal();
    const orphan = path.join(tmp, 'orphan');
    fs.mkdirSync(orphan);
    for (const suffix of ['', '-wal']) {
      fs.copyFileSync(path.join(legacyDir, `inventory.sqlite${suffix}`), path.join(orphan, `inventory.sqlite${suffix}`));
    }
    db.close();
    const before = sha(path.join(orphan, 'inventory.sqlite'));
    const dbPath = path.join(tmp, 'new2', 'inventory.sqlite');
    runLegacyMigration({ dbPathIsDefault: true, dbPath, legacyDir: orphan, log: jest.fn() });
    const copy = new Database(dbPath, { readonly: true });
    expect(copy.prepare('SELECT v FROM t').all()).toEqual([{ v: 'so-no-wal' }]);
    copy.close();
    expect(sha(path.join(orphan, 'inventory.sqlite'))).toBe(before);
  });

  test('backups: copia só .sqlite, sem sobrescrever os que já existem no destino; originais intactos', () => {
    const { legacyDir, db } = makeLegacyWithWal();
    db.close();
    fs.writeFileSync(path.join(legacyDir, 'backups', 'a.sqlite'), 'novo-a');
    fs.writeFileSync(path.join(legacyDir, 'backups', 'b.sqlite'), 'novo-b');
    fs.writeFileSync(path.join(legacyDir, 'backups', 'c.txt'), 'ignorado');
    const newDir = path.join(tmp, 'new');
    fs.mkdirSync(path.join(newDir, 'backups'), { recursive: true });
    fs.writeFileSync(path.join(newDir, 'backups', 'a.sqlite'), 'JA-EXISTIA');
    runLegacyMigration({ dbPathIsDefault: true, dbPath: path.join(newDir, 'inventory.sqlite'), legacyDir, log: jest.fn() });
    expect(fs.readFileSync(path.join(newDir, 'backups', 'a.sqlite'), 'utf8')).toBe('JA-EXISTIA');
    expect(fs.readFileSync(path.join(newDir, 'backups', 'b.sqlite'), 'utf8')).toBe('novo-b');
    expect(fs.existsSync(path.join(newDir, 'backups', 'c.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(legacyDir, 'backups', 'a.sqlite'), 'utf8')).toBe('novo-a');
    expect(fs.existsSync(path.join(legacyDir, 'backups', 'c.txt'))).toBe(true);
  });

  test('LEIA-ME é criado na pasta antiga e cita a pasta nova', () => {
    const { legacyDir, db } = makeLegacyWithWal();
    db.close();
    const newDir = path.join(tmp, 'new');
    runLegacyMigration({ dbPathIsDefault: true, dbPath: path.join(newDir, 'inventory.sqlite'), legacyDir, log: jest.fn() });
    expect(fs.readFileSync(path.join(legacyDir, NOTE_FILE_NAME), 'utf8')).toContain(newDir);
  });

  test('legado ausente: nada é criado (nem a pasta nova)', () => {
    const newDir = path.join(tmp, 'new');
    const plan = runLegacyMigration({ dbPathIsDefault: true, dbPath: path.join(newDir, 'inventory.sqlite'), legacyDir: path.join(tmp, 'nada'), log: jest.fn() });
    expect(plan).toMatchObject({ action: 'skip', reason: 'no-legacy' });
    expect(fs.existsSync(newDir)).toBe(false);
  });

  test('destino existente: ignora o legado, não grava LEIA-ME nem backups', () => {
    const { legacyDir, db } = makeLegacyWithWal();
    db.close();
    fs.writeFileSync(path.join(legacyDir, 'backups', 'a.sqlite'), 'a');
    const dbPath = path.join(tmp, 'new', 'inventory.sqlite');
    fs.mkdirSync(path.dirname(dbPath));
    fs.writeFileSync(dbPath, 'meu');
    expect(runLegacyMigration({ dbPathIsDefault: true, dbPath, legacyDir, log: jest.fn() })).toMatchObject({ reason: 'new-exists' });
    expect(fs.readFileSync(dbPath, 'utf8')).toBe('meu');
    expect(fs.existsSync(path.join(legacyDir, NOTE_FILE_NAME))).toBe(false);
    expect(fs.existsSync(path.join(path.dirname(dbPath), 'backups'))).toBe(false);
  });

  test('segunda execução depois de migrar não copia de novo (destino já existe)', () => {
    const { legacyDir, db } = makeLegacyWithWal();
    db.close();
    const dbPath = path.join(tmp, 'new', 'inventory.sqlite');
    runLegacyMigration({ dbPathIsDefault: true, dbPath, legacyDir, log: jest.fn() });
    const mine = new Database(dbPath);
    mine.exec("INSERT INTO t VALUES ('novo')");
    mine.close();
    expect(runLegacyMigration({ dbPathIsDefault: true, dbPath, legacyDir, log: jest.fn() }).reason).toBe('new-exists');
    const check = new Database(dbPath, { readonly: true });
    expect(check.prepare('SELECT COUNT(*) c FROM t').get().c).toBe(2);
    check.close();
  });

  test('legado corrompido (quick_check falha): sem destino, original intacto, sem LEIA-ME', () => {
    const legacyDir = legacyDirOf();
    fs.mkdirSync(legacyDir);
    const file = path.join(legacyDir, 'inventory.sqlite');
    const db = new Database(file);
    db.pragma('journal_mode = DELETE');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); CREATE INDEX ix ON t(v)');
    const ins = db.prepare('INSERT INTO t (v) VALUES (?)');
    for (let i = 0; i < 3000; i += 1) ins.run(`valor-${i}-${'x'.repeat(40)}`);
    db.close();
    const buf = fs.readFileSync(file);
    const pageSize = buf.readUInt16BE(16) || 65536;
    const pages = buf.length / pageSize;
    expect(pages).toBeGreaterThan(8);
    buf.fill(0xff, pageSize * (pages - 2) + 20, pageSize * (pages - 1));
    fs.writeFileSync(file, buf);
    const before = sha(file);
    const probe = new Database(file, { readonly: true });
    let verdict;
    try {
      verdict = probe.pragma('quick_check', { simple: true });
    } catch (e) {
      verdict = 'throw';
    }
    probe.close();
    expect(verdict).not.toBe('ok'); // pré-condição: o arquivo está mesmo corrompido
    const dbPath = path.join(tmp, 'new', 'inventory.sqlite');
    expect(() => runLegacyMigration({ dbPathIsDefault: true, dbPath, legacyDir, log: jest.fn() })).toThrow(/Não foi possível copiar[\s\S]*intactos/);
    expect(fs.existsSync(dbPath)).toBe(false);
    expect(sha(file)).toBe(before);
    expect(fs.existsSync(path.join(legacyDir, NOTE_FILE_NAME))).toBe(false);
  });

  test('falha no meio (VACUUM INTO deixa arquivo parcial): o destino parcial é apagado', () => {
    const legacyDir = legacyDirOf();
    fs.mkdirSync(legacyDir);
    fs.writeFileSync(path.join(legacyDir, 'inventory.sqlite'), 'x');
    const dbPath = path.join(tmp, 'new', 'inventory.sqlite');
    class FakeDb {
      constructor() {
        this.open = true;
      }
      pragma() {
        return 'ok';
      }
      prepare() {
        return {
          run: () => {
            fs.writeFileSync(dbPath, 'PARCIAL');
            throw new Error('disco cheio');
          },
        };
      }
      close() {
        this.open = false;
      }
    }
    expect(() => copyLegacyData({ legacyDir, newDbPath: dbPath, Database: FakeDb })).toThrow(/disco cheio/);
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  test('falha ao copiar backups não é fatal e o banco já está no destino', () => {
    const { legacyDir, db } = makeLegacyWithWal();
    db.close();
    fs.writeFileSync(path.join(legacyDir, 'backups', 'a.sqlite'), 'a');
    const newDir = path.join(tmp, 'new');
    fs.mkdirSync(newDir);
    fs.writeFileSync(path.join(newDir, 'backups'), 'arquivo no lugar da pasta');
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => runLegacyMigration({ dbPathIsDefault: true, dbPath: path.join(newDir, 'inventory.sqlite'), legacyDir, log: jest.fn() })).not.toThrow();
    spy.mockRestore();
    expect(fs.existsSync(path.join(newDir, 'inventory.sqlite'))).toBe(true);
  });
});

describe('instanceLock - complementos', () => {
  test('DATA_DIR_LOCKED sem porta: mensagem do browser sem URL', () => {
    acquireLock(tmp, { pid: 1, isAlive: () => true });
    let err;
    try {
      acquireLock(tmp, { pid: 2, isAlive: () => true });
    } catch (e) {
      err = e;
    }
    expect(err.code).toBe('DATA_DIR_LOCKED');
    expect(err.message).toContain('start-app.bat');
    expect(err.message).not.toContain('http://');
  });

  test('JSON ilegível, vazio ou sem pid válido é sobrescrito', () => {
    for (const content of ['', '{', 'null', '[]', '{"pid":-3}', '{"pid":1.5}', '{"pid":0}']) {
      fs.writeFileSync(path.join(tmp, LOCK_FILE_NAME), content);
      const lock = acquireLock(tmp, { pid: 77, isAlive: () => true });
      expect(JSON.parse(fs.readFileSync(lock.lockPath, 'utf8')).pid).toBe(77);
      lock.release();
    }
  });

  test('a trava gravada tem pid, porta, modo, versão e startedAt ISO', () => {
    const now = new Date('2026-01-02T03:04:05.000Z');
    const lock = acquireLock(tmp, { pid: 9, port: 3001, mode: 'desktop', version: '1.2.3', now, isAlive: () => true });
    expect(JSON.parse(fs.readFileSync(lock.lockPath, 'utf8'))).toEqual({ pid: 9, port: 3001, mode: 'desktop', startedAt: now.toISOString(), version: '1.2.3' });
    lock.release();
  });

  test('release é idempotente e não falha se a trava sumiu ou está ilegível', () => {
    const lock = acquireLock(tmp, { pid: 5, isAlive: () => true });
    fs.rmSync(lock.lockPath);
    expect(() => lock.release()).not.toThrow();
    const lock2 = acquireLock(tmp, { pid: 5, isAlive: () => true });
    fs.writeFileSync(lock2.lockPath, 'lixo');
    expect(() => lock2.release()).not.toThrow();
    expect(fs.existsSync(lock2.lockPath)).toBe(true);
  });

  test('release repetido depois de outro adquirir não apaga a trava do outro', () => {
    const a = acquireLock(tmp, { pid: 1, isAlive: () => true });
    a.release();
    const b = acquireLock(tmp, { pid: 2, isAlive: () => true });
    a.release();
    expect(JSON.parse(fs.readFileSync(b.lockPath, 'utf8')).pid).toBe(2);
    b.release();
  });

  test('cria a pasta de dados se não existir', () => {
    const lock = acquireLock(path.join(tmp, 'a', 'b'), { pid: 1, isAlive: () => true });
    expect(fs.existsSync(lock.lockPath)).toBe(true);
    lock.release();
  });

  test('isProcessAlive: o próprio processo vive; pid inexistente não', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(isProcessAlive(2 ** 22 + 12345)).toBe(false);
  });

  test('RISCO documentado: trava velha com pid reaproveitado por outro processo vivo conta como dono vivo', () => {
    const stale = JSON.stringify({ pid: process.pid, port: 3001, mode: 'browser', startedAt: '2020-01-01T00:00:00.000Z' });
    expect(assessExistingLock(stale, isProcessAlive).stale).toBe(false);
  });
});

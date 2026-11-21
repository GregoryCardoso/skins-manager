const fs = require('fs');
const os = require('os');
const path = require('path');

// Subetapa 7.1: T79 (limpeza de tmp/), T88 (EPERM na troca do arquivo) e exportação uma por vez.
jest.setTimeout(60000);

describe('T79 - limpeza de tmp/ ao abrir o banco', () => {
  const { openDatabase } = require('../../src/config/database');
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-t79-'));
    fs.mkdirSync(path.join(dir, 'tmp'));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const touch = (name, ageMs) => {
    const file = path.join(dir, 'tmp', name);
    fs.writeFileSync(file, 'x');
    const when = new Date(Date.now() - ageMs);
    fs.utimesSync(file, when, when);
  };
  const HOUR = 60 * 60 * 1000;

  test('apaga antigos (com -wal/-shm); recentes e fora do padrão ficam', () => {
    for (const n of ['export-1.sqlite', 'export-1.sqlite-wal', 'export-1.sqlite-shm', 'import-2.sqlite']) touch(n, 2 * HOUR);
    touch('export-3.sqlite', 5 * 60 * 1000);
    touch('notas.txt', 5 * HOUR);
    touch('outro-export-1.sqlite', 5 * HOUR);
    const db = openDatabase(path.join(dir, 'inventory.sqlite'));
    db.close();
    expect(fs.readdirSync(path.join(dir, 'tmp')).sort()).toEqual(['export-3.sqlite', 'notas.txt', 'outro-export-1.sqlite']);
  });

  test('arquivo travado só gera log e não impede abrir', () => {
    touch('export-1.sqlite', 2 * HOUR);
    jest.spyOn(fs, 'rmSync').mockImplementation(() => {
      throw Object.assign(new Error('locked'), { code: 'EBUSY' });
    });
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const db = openDatabase(path.join(dir, 'inventory.sqlite'));
    db.close();
    expect(errSpy).toHaveBeenCalled();
    jest.restoreAllMocks();
    expect(fs.existsSync(path.join(dir, 'tmp', 'export-1.sqlite'))).toBe(true);
  });

  test(':memory: não toca o disco', () => {
    const readdir = jest.spyOn(fs, 'readdirSync');
    openDatabase(':memory:').close();
    expect(readdir).not.toHaveBeenCalled();
  });
});

describe('T88 - replaceDatabaseFile com EPERM', () => {
  let dir;
  let database;
  beforeEach(() => {
    jest.resetModules();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-t88-'));
    process.env.DB_PATH = path.join(dir, 'inventory.sqlite');
    database = require('../../src/config/database');
    database.getDb();
  });
  afterEach(() => {
    jest.restoreAllMocks();
    database.closeDb();
    process.env.DB_PATH = ':memory:';
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const source = () => {
    const file = path.join(dir, 'novo.sqlite');
    fs.writeFileSync(file, 'novo');
    return file;
  };
  const eperm = () => Object.assign(new Error('eperm'), { code: 'EPERM' });

  test('EPERM uma vez e depois sucesso: rename', () => {
    const real = fs.renameSync;
    let calls = 0;
    jest.spyOn(fs, 'renameSync').mockImplementation((a, b) => {
      calls += 1;
      if (calls === 1) throw eperm();
      return real(a, b);
    });
    const src = source();
    expect(database.replaceDatabaseFile(src, { retryDelayMs: 1 })).toBe('rename');
    expect(calls).toBe(2);
    expect(fs.readFileSync(process.env.DB_PATH, 'utf8')).toBe('novo');
  });

  test('EPERM sempre: cópia de fallback e origem apagada', () => {
    jest.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw eperm();
    });
    const src = source();
    expect(database.replaceDatabaseFile(src, { retries: 2, retryDelayMs: 1 })).toBe('copy');
    expect(fs.readFileSync(process.env.DB_PATH, 'utf8')).toBe('novo');
    expect(fs.existsSync(src)).toBe(false);
  });

  test('erro não listado (ENOENT) propaga', () => {
    expect(() => database.replaceDatabaseFile(path.join(dir, 'inexistente.sqlite'), { retryDelayMs: 1 })).toThrow(/ENOENT/);
  });
});

describe('exportação uma por vez', () => {
  let dir;
  let service;
  let database;
  beforeEach(() => {
    jest.resetModules();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-busy-'));
    process.env.DB_PATH = path.join(dir, 'inventory.sqlite');
    database = require('../../src/config/database');
    database.getDb();
    service = require('../../src/services/backupService');
  });
  afterEach(() => {
    database.closeDb();
    process.env.DB_PATH = ':memory:';
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('segunda exportação e importação durante a exportação: BACKUP_BUSY; cleanup libera', () => {
    const first = service.createExport();
    expect(() => service.createExport()).toThrow(expect.objectContaining({ code: 'BACKUP_BUSY', status: 409 }));
    expect(() => service.importBackup(Buffer.from('SQLite format 3\0'))).toThrow(expect.objectContaining({ code: 'BACKUP_BUSY' }));
    first.cleanup();
    first.cleanup(); // idempotente
    const second = service.createExport();
    second.cleanup();
  });

  test('erro ao exportar libera a trava', () => {
    jest.spyOn(require('../../src/models/DatabaseFile'), 'exportTo').mockImplementationOnce(() => {
      throw new Error('falha');
    });
    expect(() => service.createExport()).toThrow('falha');
    service.createExport().cleanup();
  });
});

describe('T80b - rejectUnknownFields no refresh do catálogo', () => {
  test('{x:1} -> 400 UNKNOWN_FIELD com field', async () => {
    const request = require('supertest');
    const { createApp } = require('../../src/app');
    const res = await request(createApp()).post('/api/catalog/refresh').set('Content-Type', 'application/json').send({ x: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'UNKNOWN_FIELD', field: 'x' });
  });
});

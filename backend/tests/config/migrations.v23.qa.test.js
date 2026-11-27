'use strict';

// QA 11.1 (D369): v23 com falha no meio (rollback), backup v22 importado pela API, backup mais novo recusado e validação do idioma pela API.
// Bancos temporários; nada no %APPDATA%.
const fs = require('fs');
const os = require('os');
const path = require('path');

jest.setTimeout(120000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-v23qa-'));
const dbFile = path.join(dir, 'inventory.sqlite');
let request;
let database;
let app;
let MIGRATIONS;
let backupService;

beforeAll(() => {
  jest.resetModules();
  process.env.DB_PATH = dbFile;
  request = require('supertest');
  database = require('../../src/config/database');
  ({ MIGRATIONS } = require('../../src/config/migrations'));
  backupService = require('../../src/services/backupService');
  require('../../src/services/catalogService').setDefaultCatalogValidation({ minRows: {}, maxSkippedRatio: 1, requireSkinShape: false });
  app = require('../../src/app').createApp({ backupMaxBytes: 60 * 1024 * 1024, now: () => new Date('2026-11-25T12:00:00.000Z') });
  database.getDb();
});

afterAll(() => {
  database.closeDb();
  process.env.DB_PATH = ':memory:';
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temporário */ }
});

const octet = (buf) => request(app).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(buf);
const patch = (body) => request(app).patch('/api/settings').send(body);

describe('v23 com falha no meio', () => {
  test('falha depois da cópia: rollback total (versão 22, settings intacta, sem settings_new, FKs ligadas) e backup da v22 criado', () => {
    const real = MIGRATIONS.find((m) => m.version === 23);
    const dbPath = path.join(dir, 'fail', 'inventory.sqlite');
    const up22 = MIGRATIONS.filter((m) => m.version <= 22);
    const seed = database.openDatabase(dbPath, { migrations: up22 });
    seed.prepare("UPDATE settings SET language = 'pt-BR', theme = 'DARK'").run();
    const before = seed.prepare('SELECT * FROM settings').get();
    seed.close();

    const failing = {
      ...real,
      up(db) {
        const proxy = {
          prepare: (sql) => db.prepare(sql),
          exec: (sql) => {
            if (/DROP TABLE settings/.test(sql)) throw new Error('falha simulada');
            return db.exec(sql);
          },
        };
        real.up(proxy);
      },
    };
    const list = [...up22, failing];
    expect(() => database.openDatabase(dbPath, { migrations: list, now: new Date('2026-11-25T12:00:00.000Z') })).toThrow(/falha simulada/);

    const check = database.openDatabase(dbPath, { migrations: up22, skipBackup: true });
    try {
      expect(check.pragma('user_version', { simple: true })).toBe(22);
      expect(check.prepare('SELECT * FROM settings').get()).toEqual(before);
      expect(check.prepare("SELECT name FROM sqlite_master WHERE name = 'settings_new'").all()).toEqual([]);
      expect(check.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(check.pragma('foreign_key_check')).toEqual([]);
    } finally {
      check.close();
    }
    const backups = fs.readdirSync(path.join(path.dirname(dbPath), 'backups')).filter((f) => f.startsWith('inventory-v22-'));
    expect(backups.length).toBeGreaterThanOrEqual(1);

    // depois da falha, a migração real roda normalmente
    const ok = database.openDatabase(dbPath, { skipBackup: true });
    try {
      expect(ok.pragma('user_version', { simple: true })).toBe(27);
      expect(ok.prepare('SELECT * FROM settings').get()).toEqual({ ...before, display_currency: 'BRL', inventory_density: 'COMPACT' });
    } finally {
      ok.close();
    }
  });

  test('abrir de novo um banco já na v23 não refaz nada (idempotente) e não cria novo backup', () => {
    const dbPath = path.join(dir, 'idem', 'inventory.sqlite');
    database.openDatabase(dbPath).close();
    const backupsDir = path.join(path.dirname(dbPath), 'backups');
    const count = () => (fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir).length : 0);
    const first = count();
    const db = database.openDatabase(dbPath);
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(27);
    } finally {
      db.close();
    }
    expect(count()).toBe(first);
  });
});

describe('backup v22 e backup mais novo pela API', () => {
  function makeBackup(name, language) {
    const file = path.join(dir, name);
    const old = database.openDatabase(file, { migrations: MIGRATIONS.filter((m) => m.version <= 22) });
    old.prepare("UPDATE settings SET theme = 'DARK', language = ?").run(language);
    old.close();
    return fs.readFileSync(file);
  }

  test.each(['pt-BR', 'en'])('backup v22 com idioma %s importa, migra para a v23 e mantém o idioma', async (language) => {
    await patch({ language: language === 'en' ? 'pt-BR' : 'en' });
    const res = await octet(makeBackup(`v22-${language}.sqlite`, language));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fileVersion: 22, schemaVersion: 27 });
    const s = (await request(app).get('/api/settings')).body.data;
    expect(s).toMatchObject({ language, theme: 'DARK' });
  });

  test('backup com versão acima da do app é recusado (BACKUP_NEWER_VERSION) e o idioma atual não muda', async () => {
    await patch({ language: 'pt-BR' });
    const file = path.join(dir, 'newer.sqlite');
    const newer = database.openDatabase(file);
    newer.pragma('user_version = 28');
    newer.close();
    const res = await octet(fs.readFileSync(file));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BACKUP_NEWER_VERSION');
    expect((await request(app).get('/api/settings')).body.data.language).toBe('pt-BR');
  });

  test('app antigo (última migração 22) recusa um arquivo v23', () => {
    expect(backupService.assessBackupFile({ userVersion: 23, applicationId: 0, tables: [], columns: {} }, 22))
      .toMatchObject({ accepted: false, code: 'BACKUP_NEWER_VERSION', params: { fileVersion: 23, appVersion: 22 } });
  });
});

describe('PATCH /api/settings language: entradas hostis', () => {
  test.each([['es-ES'], ['pt-br'], ['EN'], ['en '], [' en'], ['pt_BR'], ['x'.repeat(5000)], ['en\u0000']])('string %j -> INVALID_LANGUAGE', async (code) => {
    const res = await patch({ language: code });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_LANGUAGE');
  });

  test.each([[null], [5], [true], [[]], [['en']], [{}]])('valor não string %j -> 400 e nada gravado', async (value) => {
    await patch({ language: 'pt-BR' });
    const res = await patch({ language: value });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect((await request(app).get('/api/settings')).body.data.language).toBe('pt-BR');
  });

  test('GET devolve o idioma salvo depois de trocar', async () => {
    await patch({ language: 'en' });
    expect((await request(app).get('/api/settings')).body.data.language).toBe('en');
    await patch({ language: 'pt-BR' });
    expect((await request(app).get('/api/settings')).body.data.language).toBe('pt-BR');
  });
});

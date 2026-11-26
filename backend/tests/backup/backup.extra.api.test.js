const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

// Complementa backup.api.test.js (D151, D155): lacunas de validação, retenção, temporários, falhas e ida e volta.
// Banco de arquivo em pasta temporária (nunca backend/data).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-backup-extra-'));
const dbFile = path.join(dir, 'inventory.sqlite');
jest.setTimeout(60000);

const FIXED_NOW = new Date('2026-11-19T15:07:00.000Z');
const SKMG = 1397444935;

let request;
let database;
let app;
let Database;
let MIGRATIONS;

beforeAll(() => {
  jest.resetModules();
  process.env.DB_PATH = dbFile;
  request = require('supertest');
  Database = require('better-sqlite3');
  database = require('../../src/config/database');
  MIGRATIONS = require('../../src/config/migrations').MIGRATIONS;
  require('../../src/services/catalogService').setDefaultCatalogValidation({ minRows: {}, maxSkippedRatio: 1, requireSkinShape: false });
  app = require('../../src/app').createApp({ now: () => new Date(FIXED_NOW.getTime()) });
  database.getDb();
});

afterAll(() => {
  database.closeDb();
  process.env.DB_PATH = ':memory:';
  fs.rmSync(dir, { recursive: true, force: true });
});

afterEach(() => jest.restoreAllMocks());

const octet = (buf) => request(app).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(buf);
const binary = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
// A trava da exportação só é liberada no 'close' do stream, que pode vir depois de o cliente receber o fim da resposta: quem usa o
// arquivo exportado em seguida (importar) esperava 409 BACKUP_BUSY com a máquina carregada. Espera a trava soltar (etapa 11.10).
const settleExport = async () => {
  const backupService = require('../../src/services/backupService');
  for (let i = 0; i < 400 && backupService.isExportInProgress(); i += 1) await new Promise((resolve) => setTimeout(resolve, 25));
};
const exportRes = async () => {
  const res = await request(app).get('/api/backup/export').buffer(true).parse(binary);
  await settleExport();
  return res;
};
const exportBuffer = async () => (await exportRes()).body;
const sub = (name) => path.join(dir, name);
const listDir = (name) => (fs.existsSync(sub(name)) ? fs.readdirSync(sub(name)) : []);
const tmpFiles = () => listDir('tmp');
const backupFiles = () => listDir('backups');
const settingsLanguage = async () => (await request(app).get('/api/settings')).body.data.language;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Arquivo derivado do export atual, alterado por `mutate(db)`.
async function mutatedExport(name, mutate) {
  const file = sub(name);
  fs.writeFileSync(file, await exportBuffer());
  const db = new Database(file);
  mutate(db);
  db.close();
  return fs.readFileSync(file);
}

function dumpAllTables() {
  const db = database.getDb();
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  const dump = {};
  for (const name of names) dump[name] = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all();
  return dump;
}

async function createSomeData() {
  // Assenta o catálogo embutido (a importação o sincroniza) antes de comparar linhas.
  expect((await octet(await exportBuffer())).status).toBe(200);
  const store = (await request(app).get('/api/stores')).body.data[0];
  const ids = database.getDb().prepare("SELECT id FROM catalog_items WHERE category = 'SKIN' ORDER BY id LIMIT 2").all().map((r) => r.id);
  expect(ids).toHaveLength(2);
  for (const catalogId of ids) {
    const res = await request(app).post('/api/items').send({
      catalogId,
      acquisitionType: 'COMPRA',
      purchaseStoreId: store.id,
      purchasePriceCents: 1234,
      acquiredAt: '2026-11-10T12:00:00.000Z',
    });
    expect(res.status).toBe(201);
  }
  await request(app).patch('/api/settings').send({ language: 'en' });
}

describe('ida e volta', () => {
  test('exportar e importar de volta deixa as linhas de todas as tabelas idênticas', async () => {
    await createSomeData();
    const before = dumpAllTables();
    expect(before.items).toHaveLength(2);
    const file = await exportBuffer();
    const res = await octet(file);
    expect(res.status).toBe(200);
    expect(res.body.data.counts).toEqual({ items: 2, stores: before.stores.length });
    expect(dumpAllTables()).toEqual(before);
  });

  test('depois da importação o app segue funcionando com o banco importado', async () => {
    const file = await exportBuffer();
    // Altera o banco atual e importa o arquivo antigo: os dados do arquivo voltam.
    const items = (await request(app).get('/api/items')).body.data.items;
    expect(items).toHaveLength(2);
    await request(app).delete(`/api/items/${items[0].id}`);
    await request(app).patch('/api/settings').send({ language: 'pt-BR' });
    expect((await request(app).get('/api/items')).body.data.items).toHaveLength(1);

    const res = await octet(file);
    expect(res.status).toBe(200);
    expect((await request(app).get('/api/items')).body.data.items).toHaveLength(2);
    expect((await request(app).get('/api/stores')).body.data.length).toBe(res.body.data.counts.stores);
    expect(await settingsLanguage()).toBe('en');
    // Escrita continua possível no banco novo.
    const created = await request(app).patch('/api/settings').send({ language: 'pt-BR' });
    expect(created.status).toBe(200);
    expect(await settingsLanguage()).toBe('pt-BR');
  });
});

describe('exportar: nome e temporários', () => {
  test('Content-Disposition usa a versão e a data/hora locais do relógio injetado', async () => {
    const res = await exportRes();
    const d = FIXED_NOW;
    const p = (n) => String(n).padStart(2, '0');
    const expected = `skins-manager-backup-v${database.getLatestSchemaVersion()}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.sqlite`;
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${expected}"`);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(Number(res.headers['content-length'])).toBe(res.body.length);
  });

  test('cliente que aborta no meio do envio não deixa temporário', async () => {
    // Infla o banco para o envio não terminar de uma vez.
    const db = database.getDb();
    db.exec('CREATE TABLE bloat (b BLOB)');
    const insert = db.prepare('INSERT INTO bloat VALUES (?)');
    const chunk = Buffer.alloc(1024 * 1024, 7);
    for (let i = 0; i < 40; i += 1) insert.run(chunk);
    const server = app.listen(0);
    try {
      const { port } = server.address();
      await new Promise((resolve) => {
        const req = http.get({ port, path: '/api/backup/export' }, (res) => {
          res.once('data', () => {
            req.destroy();
            resolve();
          });
          res.on('error', () => {});
        });
        req.on('error', () => {});
      });
      let left = tmpFiles();
      for (let i = 0; i < 40 && left.length > 0; i += 1) {
        await wait(100);
        left = tmpFiles();
      }
      expect(left).toEqual([]);
    } finally {
      server.close();
      db.exec('DROP TABLE bloat');
      db.exec('VACUUM');
    }
  });

  test('falha ao gerar o export não deixa temporário', async () => {
    jest.spyOn(database, 'exportDatabaseTo').mockImplementation(() => {
      throw new Error('disco cheio');
    });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/api/backup/export');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(tmpFiles()).toEqual([]);
  });
});

describe('importar: validação pela API', () => {
  async function expectRejected(buffer, status, code) {
    const lang = await settingsLanguage();
    const backupsBefore = backupFiles();
    const res = await octet(buffer);
    expect(res.status).toBe(status);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe(code);
    expect(backupFiles()).toEqual(backupsBefore); // nada criado antes de aceitar o arquivo
    expect(tmpFiles()).toEqual([]);
    expect(await settingsLanguage()).toBe(lang); // banco intocado
    return res;
  }

  test('tabelas válidas mas application_id estranho -> BACKUP_INVALID_FILE', async () => {
    const buf = await mutatedExport('weird-id.sqlite', (db) => db.pragma('application_id = 12345'));
    await expectRejected(buf, 400, 'BACKUP_INVALID_FILE');
  });

  test('v3 com application_id estranho -> BACKUP_INVALID_FILE', async () => {
    const file = sub('v3-weird.sqlite');
    database.openDatabase(file, { migrations: MIGRATIONS.slice(0, 3) }).close();
    const db = new Database(file);
    db.pragma('application_id = 5');
    db.close();
    await expectRejected(fs.readFileSync(file), 400, 'BACKUP_INVALID_FILE');
  });

  test('banco v4 sem a marca SKMG -> BACKUP_INVALID_FILE (D151)', async () => {
    const file = sub('v4-nomark.sqlite');
    database.openDatabase(file, { migrations: MIGRATIONS.slice(0, 4) }).close();
    const db = new Database(file);
    expect(db.pragma('application_id', { simple: true })).toBe(SKMG);
    db.pragma('application_id = 0');
    db.close();
    await expectRejected(fs.readFileSync(file), 400, 'BACKUP_INVALID_FILE');
  });

  test('banco v4 com a marca SKMG é aceito', async () => {
    const file = sub('v4-ok.sqlite');
    database.openDatabase(file, { migrations: MIGRATIONS.slice(0, 4) }).close();
    const res = await octet(fs.readFileSync(file));
    expect(res.status).toBe(200);
    expect(res.body.data.fileVersion).toBe(4);
    expect(res.body.data.migrationsApplied).toEqual(MIGRATIONS.filter((m) => m.version > 4).map((m) => m.version));
    await request(app).patch('/api/settings').send({ language: 'en' });
  });

  test('tabela obrigatória faltando -> BACKUP_INVALID_FILE', async () => {
    const buf = await mutatedExport('no-table.sqlite', (db) => {
      db.pragma('foreign_keys = OFF');
      db.exec('DROP TABLE store_balances');
    });
    await expectRejected(buf, 400, 'BACKUP_INVALID_FILE');
  });

  test('user_version 0 -> BACKUP_INVALID_FILE', async () => {
    const buf = await mutatedExport('v0.sqlite', (db) => db.pragma('user_version = 0'));
    await expectRejected(buf, 400, 'BACKUP_INVALID_FILE');
  });

  test('versão futura traz params com fileVersion e appVersion', async () => {
    const buf = await mutatedExport('future2.sqlite', (db) => db.pragma('user_version = 77'));
    const res = await expectRejected(buf, 400, 'BACKUP_NEWER_VERSION');
    expect(res.body.error.params).toEqual({ fileVersion: 77, appVersion: database.getLatestSchemaVersion() });
  });

  test('arquivo com páginas corrompidas no meio -> BACKUP_CORRUPTED ou BACKUP_INVALID_FILE sem tocar no banco', async () => {
    const good = Buffer.from(await exportBuffer());
    const bad = Buffer.from(good);
    // Estraga o miolo (preserva o cabeçalho de 100 bytes).
    for (let i = 4096; i < Math.min(bad.length, 4096 * 4); i += 1) bad[i] = 0xff;
    const lang = await settingsLanguage();
    const res = await octet(bad);
    expect(res.status).toBe(400);
    expect(['BACKUP_CORRUPTED', 'BACKUP_INVALID_FILE']).toContain(res.body.error.code);
    expect(tmpFiles()).toEqual([]);
    expect(await settingsLanguage()).toBe(lang);
  });

  test('cabeçalho SQLite válido seguido de lixo -> BACKUP_CORRUPTED', async () => {
    const buf = Buffer.concat([Buffer.from('SQLite format 3\0', 'latin1'), Buffer.alloc(4096, 0xab)]);
    await expectRejected(buf, 400, 'BACKUP_CORRUPTED');
  });

  test('BACKUP_BUSY com o catálogo em atualização', async () => {
    const file = await exportBuffer();
    const spy = jest.spyOn(require('../../src/services/catalogService'), 'isCatalogRefreshInProgress').mockReturnValue(true);
    const res = await octet(file);
    spy.mockRestore();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BACKUP_BUSY');
    expect(tmpFiles()).toEqual([]);
  });

  test('415 com tipo de conteúdo ausente e com texto/plain', async () => {
    const none = await request(app).post('/api/backup/import').send();
    expect(none.status).toBe(415);
    const text = await request(app).post('/api/backup/import').set('Content-Type', 'text/plain').send('abc');
    expect(text.status).toBe(415);
    expect(text.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });
});

describe('importar: backup automático', () => {
  test('o backup automático é um banco legível da versão atual com os dados anteriores', async () => {
    await request(app).patch('/api/settings').send({ language: 'pt-BR' });
    const file = await mutatedExport('en-copy.sqlite', (db) => db.prepare('UPDATE settings SET language = ?').run('en'));
    const res = await octet(file);
    expect(res.status).toBe(200);
    expect(await settingsLanguage()).toBe('en');
    const backup = new Database(path.join(dir, 'backups', res.body.data.preImportBackupFile), { readonly: true });
    expect(backup.pragma('user_version', { simple: true })).toBe(database.getLatestSchemaVersion());
    expect(backup.pragma('quick_check', { simple: true })).toBe('ok');
    expect(backup.prepare('SELECT language FROM settings').get().language).toBe('pt-BR'); // dados de antes da troca
    backup.close();
    await request(app).patch('/api/settings').send({ language: 'pt-BR' });
  });

  test('o carimbo avança 1 ms quando o nome já existe (mesmo relógio)', async () => {
    const file = await exportBuffer();
    const a = await octet(file);
    const b = await octet(file);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.data.preImportBackupFile).not.toBe(b.body.data.preImportBackupFile);
    // Com o relógio parado, o nome do segundo avança (1 ms por tentativa) em vez de sobrescrever o primeiro.
    const stampOf = (n) => /-(\d{4}-.*Z)\.sqlite$/.exec(n)[1];
    expect(stampOf(b.body.data.preImportBackupFile) > stampOf(a.body.data.preImportBackupFile)).toBe(true);
    expect(backupFiles()).toEqual(expect.arrayContaining([a.body.data.preImportBackupFile, b.body.data.preImportBackupFile]));
  });

  test('falha na reabertura restaura os dados, devolve 500 e usa o backup automático', async () => {
    await request(app).patch('/api/settings').send({ language: 'pt-BR' });
    const file = await mutatedExport('en-copy2.sqlite', (db) => db.prepare('UPDATE settings SET language = ?').run('en'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(database, 'getDb').mockImplementationOnce(() => {
      throw new Error('falha simulada');
    });
    const before = backupFiles();
    const res = await octet(file);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('BACKUP_IMPORT_FAILED');
    expect(res.body.error.message).toMatch(/anteriores/);
    expect(backupFiles().length).toBe(before.length + 1); // o backup automático foi mantido
    expect(tmpFiles()).toEqual([]);
    expect(await settingsLanguage()).toBe('pt-BR');
  });

  test('falha na reabertura e também na restauração -> 500 apontando o backup, sem temporários', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const file = await exportBuffer();
    jest.spyOn(database, 'getDb').mockImplementationOnce(() => {
      throw new Error('falha simulada');
    });
    jest.spyOn(database, 'restoreDatabaseFile').mockImplementationOnce(() => {
      throw new Error('restauração falhou');
    });
    const res = await octet(file);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('BACKUP_IMPORT_FAILED');
    expect(res.body.error.message).toMatch(/backups\/inventory-before-import-v/);
    expect(tmpFiles()).toEqual([]);
    // O app volta a abrir o banco (o arquivo importado já estava no lugar).
    expect((await request(app).get('/api/settings')).status).toBe(200);
  });
});

describe('retenção (D151)', () => {
  const old = (prefix, version, i) => `${prefix}${version}-2020-01-${String(i + 1).padStart(2, '0')}T10-00-00.000Z.sqlite`;
  const IMPORT = 'inventory-before-import-v';
  const MIG = 'inventory-v';
  const MANUAL = ['inventory-before-import-v5-manual.sqlite', 'inventory-v3-copia.sqlite', 'notas.txt', 'skins-manager-backup-v5-2020-01-01-1000.sqlite', 'inventory-v3-2020-01-01T10-00-00.000Z.sqlite.bak'];

  beforeAll(() => {
    fs.mkdirSync(sub('backups'), { recursive: true });
    for (const f of backupFiles()) fs.rmSync(sub(path.join('backups', f)));
    for (let i = 0; i < 12; i += 1) {
      fs.writeFileSync(sub(path.join('backups', old(IMPORT, 5, i))), 'x');
      fs.writeFileSync(sub(path.join('backups', old(MIG, 3, i))), 'x');
    }
    for (const f of MANUAL) fs.writeFileSync(sub(path.join('backups', f)), 'x');
  });

  const count = (prefix) => backupFiles().filter((n) => new RegExp(`^${prefix}\\d+-\\d{4}-`).test(n) && n.endsWith('Z.sqlite'));

  test('importação poda só o tipo importação, e arquivos fora do padrão ficam', async () => {
    const res = await octet(await exportBuffer());
    expect(res.status).toBe(200);
    expect(count(IMPORT)).toHaveLength(10);
    expect(count(MIG)).toHaveLength(12);
    // Os 3 mais antigos do tipo (e só eles) saíram.
    expect(backupFiles()).not.toContain(old(IMPORT, 5, 0));
    expect(backupFiles()).not.toContain(old(IMPORT, 5, 1));
    expect(backupFiles()).not.toContain(old(IMPORT, 5, 2)); // 12 antigos + 1 novo = 13; saem os 3 mais velhos
    expect(backupFiles()).toContain(old(IMPORT, 5, 3));
    expect(backupFiles()).toContain(res.body.data.preImportBackupFile);
    for (const f of MANUAL) expect(backupFiles()).toContain(f);
  });

  test('importar um v3 não cria nem poda backups de migração (inventory-v*); arquivos fora do padrão ficam', async () => {
    const before = count(MIG);
    expect(before).toHaveLength(12);
    const v3 = sub('v3-ret.sqlite');
    database.openDatabase(v3, { migrations: MIGRATIONS.slice(0, 3) }).close();
    for (let i = 0; i < 11; i += 1) {
      const r = await octet(fs.readFileSync(v3));
      expect(r.status).toBe(200);
    }
    const res = await octet(fs.readFileSync(v3));
    expect(res.status).toBe(200);
    expect(count(MIG)).toEqual(before);
    expect(backupFiles().filter((n) => /^inventory-v3-.*Z\.sqlite$/.test(n))).toEqual(before.filter((n) => n.startsWith('inventory-v3-')));
    expect(count(IMPORT)).toHaveLength(10);
    for (const f of MANUAL) expect(backupFiles()).toContain(f);
    expect(tmpFiles()).toEqual([]);
  });

  test('falha ao apagar backup antigo não derruba a importação', async () => {
    for (let i = 0; i < 12; i += 1) fs.writeFileSync(sub(path.join('backups', old(IMPORT, 5, i + 20))), 'x');
    const realRm = fs.rmSync;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(fs, 'rmSync').mockImplementation((p, opts) => {
      if (String(p).includes(`${path.sep}backups${path.sep}`)) throw Object.assign(new Error('EBUSY: arquivo travado'), { code: 'EBUSY' });
      return realRm(p, opts);
    });
    const res = await octet(await exportBuffer());
    fs.rmSync.mockRestore();
    expect(res.status).toBe(200);
    expect(console.error).toHaveBeenCalled();
    expect(tmpFiles()).toEqual([]);
    expect((await request(app).get('/api/settings')).status).toBe(200);
    expect(count(IMPORT).length).toBeGreaterThan(10); // nada foi apagado
  });

  test('falha ao apagar backup antigo não derruba a migração (importação de v3)', async () => {
    for (let i = 0; i < 12; i += 1) fs.writeFileSync(sub(path.join('backups', old(MIG, 3, i + 20))), 'x');
    // Relógio parado: o backup de migração do teste anterior tem o mesmo carimbo (em produção o relógio anda).
    fs.rmSync(sub(path.join('backups', `inventory-v3-${FIXED_NOW.toISOString().replace(/:/g, '-')}.sqlite`)), { force: true });
    const v3 = sub('v3-ret2.sqlite');
    database.openDatabase(v3, { migrations: MIGRATIONS.slice(0, 3) }).close();
    const realRm = fs.rmSync;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(fs, 'rmSync').mockImplementation((p, opts) => {
      if (String(p).includes(`${path.sep}backups${path.sep}`)) throw Object.assign(new Error('EBUSY: arquivo travado'), { code: 'EBUSY' });
      return realRm(p, opts);
    });
    const res = await octet(fs.readFileSync(v3));
    fs.rmSync.mockRestore();
    expect(res.status).toBe(200);
    expect(res.body.data.fileVersion).toBe(3);
    expect(database.getSchemaVersion()).toBe(database.getLatestSchemaVersion());
    expect(count(MIG)).toHaveLength(12 + 12); // importar não poda o tipo migração
  });

  test('falha ao listar a pasta de backups também não derruba (pruneAutoBackups nunca lança)', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => database.pruneAutoBackups(sub('pasta-que-nao-existe'), IMPORT)).not.toThrow();
  });
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

// Subetapa 7.1 (QA): trava de exportação pela API, esquemas v1 a v5, items sem status, limpeza de tmp/.
// Banco de arquivo em pasta temporária (nunca backend/data).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-debts71-'));
jest.setTimeout(90000);

let request;
let database;
let app;
let Database;
let MIGRATIONS;

beforeAll(() => {
  jest.resetModules();
  process.env.DB_PATH = path.join(dir, 'inventory.sqlite');
  request = require('supertest');
  Database = require('better-sqlite3');
  database = require('../../src/config/database');
  MIGRATIONS = require('../../src/config/migrations').MIGRATIONS;
  require('../../src/services/catalogService').setDefaultCatalogValidation({ minRows: {}, maxSkippedRatio: 1, requireSkinShape: false });
  app = require('../../src/app').createApp();
  database.getDb();
});

afterAll(() => {
  database.closeDb();
  process.env.DB_PATH = ':memory:';
  fs.rmSync(dir, { recursive: true, force: true });
});

const octet = (buf) => request(app).post('/api/backup/import').set('Content-Type', 'application/octet-stream').send(buf);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tmpFiles = () => (fs.existsSync(path.join(dir, 'tmp')) ? fs.readdirSync(path.join(dir, 'tmp')) : []);

describe('backup válido de cada versão de esquema continua aceito', () => {
  test.each([1, 2, 3, 4, 5])('v%i é aceito e migrado até a versão atual', async (version) => {
    const file = path.join(dir, `v${version}.sqlite`);
    database.openDatabase(file, { migrations: MIGRATIONS.slice(0, version) }).close();
    const res = await octet(fs.readFileSync(file));
    expect(res.status).toBe(200);
    expect(res.body.data.fileVersion).toBe(version);
    expect(res.body.data.migrationsApplied).toEqual(MIGRATIONS.filter((m) => m.version > version).map((m) => m.version));
    expect(database.getSchemaVersion()).toBe(database.getLatestSchemaVersion());
  });

  test('o export atual (versão mais nova) também é aceito', async () => {
    const chunks = [];
    const exp = await request(app)
      .get('/api/backup/export')
      .buffer(true)
      .parse((res, cb) => {
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(exp.status).toBe(200);
    expect((await octet(exp.body)).status).toBe(200);
  });
});

describe('colunas mínimas (items sem status etc.)', () => {
  function brokenFile(name, mutate) {
    const file = path.join(dir, name);
    database.openDatabase(file).close();
    const db = new Database(file);
    mutate(db);
    db.close();
    return fs.readFileSync(file);
  }

  test('items sem status -> 400 BACKUP_INVALID_FILE e o banco atual fica intocado', async () => {
    const before = database.getSchemaVersion();
    const { REQUIRED_COLUMNS } = require('../../src/services/backupService');
    const file = path.join(dir, 'no-status.sqlite');
    const raw = new Database(file);
    for (const [table, cols] of Object.entries(REQUIRED_COLUMNS)) {
      const list = (table === 'items' ? cols.filter((c) => c !== 'status') : cols).map((c) => `"${c}"`).join(', ');
      raw.exec(`CREATE TABLE ${table} (${list})`);
    }
    raw.pragma('user_version = 1');
    raw.close();
    const buf = fs.readFileSync(file);
    const res = await octet(buf);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BACKUP_INVALID_FILE');
    expect(database.getSchemaVersion()).toBe(before);
    expect(tmpFiles()).toEqual([]);
  });

  test('coluna obrigatória de outra tabela faltando (stores.currency) -> BACKUP_INVALID_FILE', async () => {
    const buf = brokenFile('no-currency.sqlite', (db) => {
      db.pragma('foreign_keys = OFF');
      db.exec('ALTER TABLE stores DROP COLUMN currency');
    });
    const res = await octet(buf);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BACKUP_INVALID_FILE');
  });
});

describe('BACKUP_BUSY pela API (exportação)', () => {
  function bloat() {
    const db = database.getDb();
    db.exec('CREATE TABLE IF NOT EXISTS bloat (b BLOB)');
    const insert = db.prepare('INSERT INTO bloat VALUES (?)');
    const chunk = Buffer.alloc(1024 * 1024, 7);
    for (let i = 0; i < 40; i += 1) insert.run(chunk);
  }
  function unbloat() {
    const db = database.getDb();
    db.exec('DROP TABLE IF EXISTS bloat');
    db.exec('VACUUM');
  }

  // Abre uma exportação e a mantém pausada (o stream não termina). Devolve { req, res }.
  function holdExport(port) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('sem resposta')), 30000);
      const req = http.get({ port, path: '/api/backup/export' }, (res) => {
        clearTimeout(timer);
        res.pause();
        resolve({ req, res });
      });
      req.on('error', () => {});
    });
  }
  const get = (port, p, method = 'GET', headers = {}, body) =>
    new Promise((resolve, reject) => {
      const req = http.request({ port, path: p, method, headers }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      if (body) req.write(body);
      req.end();
    });

  test('exportação simultânea e importação durante a exportação -> 409 BACKUP_BUSY; abortar libera a trava', async () => {
    bloat();
    const server = app.listen(0);
    try {
      const { port } = server.address();
      const held = await holdExport(port);

      const second = await get(port, '/api/backup/export');
      expect(second.status).toBe(409);
      expect(second.body).toMatchObject({ success: false, error: { code: 'BACKUP_BUSY' } });

      const imported = await get(port, '/api/backup/import', 'POST', { 'Content-Type': 'application/octet-stream' }, Buffer.from('SQLite format 3\0'));
      expect(imported.status).toBe(409);
      expect(imported.body.error.code).toBe('BACKUP_BUSY');

      // Cliente aborta: a trava e o temporário são liberados.
      held.req.destroy();
      held.res.destroy();
      let freed = false;
      for (let i = 0; i < 300 && !freed; i += 1) {
        await wait(100);
        const probe = await new Promise((resolve) => {
          const req = http.get({ port, path: '/api/backup/export' }, (res) => {
            const status = res.statusCode;
            res.destroy();
            resolve(status);
          });
          req.on('error', () => resolve(0));
        });
        freed = probe === 200;
      }
      expect(freed).toBe(true);
    } finally {
      server.close();
      await wait(300);
      unbloat();
    }
  });

  test('exportação concluída normalmente libera a trava (duas em sequência)', async () => {
    const parse = (res, cb) => {
      const c = [];
      res.on('data', (d) => c.push(d));
      res.on('end', () => cb(null, Buffer.concat(c)));
    };
    expect((await request(app).get('/api/backup/export').buffer(true).parse(parse)).status).toBe(200);
    // a trava é solta no 'close' do stream, depois do fim da resposta: espera soltar em vez de um tempo fixo (etapa 11.10)
    const backupService = require('../../src/services/backupService');
    for (let i = 0; i < 400 && backupService.isExportInProgress(); i += 1) await wait(25);
    expect((await request(app).get('/api/backup/export').buffer(true).parse(parse)).status).toBe(200);
  });
});

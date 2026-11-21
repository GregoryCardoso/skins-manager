// 7.2 - complementos da API de pasta de backups. O explorer.exe real nunca é chamado: child_process é mockado
// e toda rota usa openFolderFn injetada.
jest.mock('child_process', () => ({ execFile: jest.fn(() => ({ on() {} })), spawn: jest.fn(), exec: jest.fn() }));

const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-folder2-'));
let request;
let database;
let createApp;
let childProcess;

beforeAll(() => {
  jest.resetModules();
  process.env.DB_PATH = path.join(dir, 'inventory.sqlite');
  request = require('supertest');
  childProcess = require('child_process');
  database = require('../../src/config/database');
  ({ createApp } = require('../../src/app'));
  database.getDb();
});

afterAll(() => {
  database.closeDb();
  process.env.DB_PATH = ':memory:';
  fs.rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  expect(childProcess.execFile).not.toHaveBeenCalled(); // nenhum teste chegou ao Explorer real
});

const ok = () => ({ openFolderFn: jest.fn().mockResolvedValue(undefined), canOpenFolderFn: () => true });
const raw = (app, body, type = 'application/json') => request(app).post('/api/backup/open-folder').set('Content-Type', type).send(body);

describe('GET /api/backup/info - forma', () => {
  test('tem exatamente as 4 chaves com os tipos certos', async () => {
    const res = await request(createApp(ok())).get('/api/backup/info');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Object.keys(res.body.data).sort()).toEqual(['autoBackupKeep', 'backupsDir', 'canOpenFolder', 'dataDir']);
    expect(typeof res.body.data.dataDir).toBe('string');
    expect(typeof res.body.data.backupsDir).toBe('string');
    expect(Number.isInteger(res.body.data.autoBackupKeep)).toBe(true);
    expect(typeof res.body.data.canOpenFolder).toBe('boolean');
  });
  test('não cria a pasta de backups só por consultar', async () => {
    fs.rmSync(path.join(dir, 'backups'), { recursive: true, force: true });
    await request(createApp(ok())).get('/api/backup/info');
    expect(fs.existsSync(path.join(dir, 'backups'))).toBe(false);
  });
  test('padrão (sem injeção) segue a plataforma', async () => {
    const res = await request(createApp()).get('/api/backup/info');
    expect(res.body.data.canOpenFolder).toBe(process.platform === 'win32');
  });
  test('Host estranho é recusado (403 FORBIDDEN_HOST)', async () => {
    const res = await request(createApp(ok())).get('/api/backup/info').set('Host', 'evil.com:3001');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_HOST');
  });
});

describe('POST /api/backup/open-folder - validação', () => {
  test('Content-Type aceito com charset; 127.0.0.1 é Host válido', async () => {
    const opts = ok();
    const res = await raw(createApp(opts), '{}', 'application/json; charset=utf-8').set('Host', '127.0.0.1:3001');
    expect(res.status).toBe(200);
    expect(opts.openFolderFn).toHaveBeenCalledTimes(1);
  });
  test.each(['application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/octet-stream', 'application/jsonx'])(
    'Content-Type %s -> 415 e nada é aberto',
    async (type) => {
      const opts = ok();
      const res = await raw(createApp(opts), '{}', type);
      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      expect(opts.openFolderFn).not.toHaveBeenCalled();
    }
  );
  test.each([
    ['campo extra path', { path: 'C:\\' }, 'UNKNOWN_FIELD'],
    ['campo extra dir', { dir: '..' }, 'UNKNOWN_FIELD'],
    ['campo extra com {} junto', { a: 1 }, 'UNKNOWN_FIELD'],
  ])('%s -> 400', async (_n, body, code) => {
    const opts = ok();
    const res = await raw(createApp(opts), JSON.stringify(body));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(code);
    expect(opts.openFolderFn).not.toHaveBeenCalled();
  });
  test.each([['array', '[]'], ['array com objeto', '[{}]'], ['null', 'null'], ['string', '"C:\\\\"'], ['número', '5']])(
    'corpo %s é recusado',
    async (_n, body) => {
      const opts = ok();
      const res = await raw(createApp(opts), body);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(res.body.success).toBe(false);
      expect(opts.openFolderFn).not.toHaveBeenCalled();
    }
  );
  test('JSON malformado -> 400 no formato padrão', async () => {
    const opts = ok();
    const res = await raw(createApp(opts), '{"a":');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, error: { code: expect.any(String), message: expect.any(String) } });
    expect(opts.openFolderFn).not.toHaveBeenCalled();
  });
  test('Host estranho -> 403 antes de qualquer abertura; Origin de outro site não muda nada', async () => {
    const opts = ok();
    const res = await raw(createApp(opts), '{}').set('Host', 'localhost.evil.com');
    expect(res.status).toBe(403);
    expect(opts.openFolderFn).not.toHaveBeenCalled();
  });
});

describe('POST /api/backup/open-folder - comportamento', () => {
  test('abre exatamente <dataDir>/backups, nunca a pasta de dados nem outra', async () => {
    const opts = ok();
    const res = await raw(createApp(opts), '{}');
    expect(res.status).toBe(200);
    expect(opts.openFolderFn.mock.calls).toEqual([[path.join(dir, 'backups')]]);
    expect(res.body).toEqual({ success: true, data: { path: path.join(dir, 'backups') } });
  });
  test('canOpenFolder false -> 409 e não cria pasta nem chama o abridor', async () => {
    fs.rmSync(path.join(dir, 'backups'), { recursive: true, force: true });
    const openFolderFn = jest.fn();
    const res = await raw(createApp({ openFolderFn, canOpenFolderFn: () => false }), '{}');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FOLDER_OPEN_UNSUPPORTED');
    expect(openFolderFn).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(dir, 'backups'))).toBe(false);
  });
  test('falha assíncrona e síncrona do abridor -> 500 FOLDER_OPEN_FAILED sem vazar detalhes', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    for (const openFolderFn of [jest.fn().mockRejectedValue(new Error('segredo C:\\interno')), jest.fn(() => { throw new Error('boom'); })]) {
      const res = await raw(createApp({ openFolderFn, canOpenFolderFn: () => true }), '{}');
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('FOLDER_OPEN_FAILED');
      expect(JSON.stringify(res.body)).not.toMatch(/segredo|interno|boom/);
    }
    spy.mockRestore();
  });
  test('GET em /open-folder não existe (só POST)', async () => {
    const res = await request(createApp(ok())).get('/api/backup/open-folder');
    expect(res.status).toBe(404);
  });
});

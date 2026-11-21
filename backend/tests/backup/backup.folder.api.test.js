const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-folder-'));
let request;
let database;
let createApp;

beforeAll(() => {
  jest.resetModules();
  process.env.DB_PATH = path.join(dir, 'inventory.sqlite');
  request = require('supertest');
  database = require('../../src/config/database');
  ({ createApp } = require('../../src/app'));
  database.getDb();
});

afterAll(() => {
  database.closeDb();
  process.env.DB_PATH = ':memory:';
  fs.rmSync(dir, { recursive: true, force: true });
});

const post = (app, body = {}) => request(app).post('/api/backup/open-folder').set('Content-Type', 'application/json').send(body);

describe('GET /api/backup/info', () => {
  test('devolve as pastas e se pode abrir', async () => {
    const app = createApp({ canOpenFolderFn: () => true });
    const res = await request(app).get('/api/backup/info');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ dataDir: dir, backupsDir: path.join(dir, 'backups'), autoBackupKeep: 10, canOpenFolder: true });
  });
  test('canOpenFolder false fora do Windows', async () => {
    const res = await request(createApp({ canOpenFolderFn: () => false })).get('/api/backup/info');
    expect(res.body.data.canOpenFolder).toBe(false);
  });
});

describe('POST /api/backup/open-folder', () => {
  test('abre só a pasta de backups (criando-a) e devolve o caminho', async () => {
    const openFolderFn = jest.fn().mockResolvedValue(undefined);
    const app = createApp({ openFolderFn, canOpenFolderFn: () => true });
    const res = await post(app);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ path: path.join(dir, 'backups') });
    expect(openFolderFn).toHaveBeenCalledWith(path.join(dir, 'backups'));
    expect(fs.existsSync(path.join(dir, 'backups'))).toBe(true);
  });
  test('fora do Windows: 409 FOLDER_OPEN_UNSUPPORTED', async () => {
    const openFolderFn = jest.fn();
    const res = await post(createApp({ openFolderFn, canOpenFolderFn: () => false }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FOLDER_OPEN_UNSUPPORTED');
    expect(openFolderFn).not.toHaveBeenCalled();
  });
  test('falha ao iniciar: 500 FOLDER_OPEN_FAILED', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const app = createApp({ openFolderFn: jest.fn().mockRejectedValue(new Error('x')), canOpenFolderFn: () => true });
    const res = await post(app);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('FOLDER_OPEN_FAILED');
  });
  test('exige Content-Type JSON', async () => {
    const app = createApp({ openFolderFn: jest.fn(), canOpenFolderFn: () => true });
    const res = await request(app).post('/api/backup/open-folder').set('Content-Type', 'text/plain').send('{}');
    expect(res.status).toBe(415);
    const none = await request(app).post('/api/backup/open-folder');
    expect(none.status).toBe(415);
  });
  test('recusa caminho vindo do cliente e corpo que não é objeto', async () => {
    const openFolderFn = jest.fn();
    const app = createApp({ openFolderFn, canOpenFolderFn: () => true });
    const res = await post(app, { path: 'C:\\Windows' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_FIELD');
    const array = await post(app, []);
    expect(array.status).toBe(400);
    expect(openFolderFn).not.toHaveBeenCalled();
  });
  test('Host não local é recusado', async () => {
    const app = createApp({ openFolderFn: jest.fn(), canOpenFolderFn: () => true });
    const res = await post(app).set('Host', 'evil.com');
    expect(res.status).toBe(403);
  });
});

describe('health', () => {
  test('inclui app e version', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.body.data).toMatchObject({ status: 'ok', app: 'skins-manager', version: expect.stringMatching(/^\d+\.\d+\.\d+/) });
  });
});

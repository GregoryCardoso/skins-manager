const fs = require('fs');
const os = require('os');
const path = require('path');

const BACKEND_DIR = path.resolve(__dirname, '..', '..');
const KEYS = ['PORT', 'DB_PATH', 'CORS_ORIGIN', 'SLOW_ITEM_DAYS'];
let saved;
let savedCwd;
let tmpDir;

// Carrega env.js isolado, sem ler um eventual backend/.env real do usuário.
function loadEnvWith(vars) {
  jest.resetModules();
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  return require('../../src/config/env');
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skins-env-cwd-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  saved = {};
  for (const k of KEYS) saved[k] = process.env[k];
  savedCwd = process.cwd();
});

afterEach(() => {
  process.chdir(savedCwd);
  jest.restoreAllMocks();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  jest.dontMock('dotenv');
  jest.resetModules();
});

describe('config/env - DB_PATH', () => {
  test.each([
    ['data/outro.sqlite', path.join(BACKEND_DIR, 'data', 'outro.sqlite')],
    ['./x.sqlite', path.join(BACKEND_DIR, 'x.sqlite')],
    ['../fora.sqlite', path.join(BACKEND_DIR, '..', 'fora.sqlite')],
    ['  data/espacos.sqlite  ', path.join(BACKEND_DIR, 'data', 'espacos.sqlite')],
  ])('relativo %j resolvido a partir de backend/ mesmo com cwd diferente (chdir real)', (raw, expected) => {
    process.chdir(tmpDir);
    expect(process.cwd()).not.toBe(BACKEND_DIR);
    const env = loadEnvWith({ DB_PATH: raw });
    expect(path.isAbsolute(env.dbPath)).toBe(true);
    expect(env.dbPath).toBe(path.normalize(expected));
    expect(env.dbPath.startsWith(tmpDir)).toBe(false);
  });

  test('relativo independe de process.cwd() simulado', () => {
    jest.spyOn(process, 'cwd').mockReturnValue(path.join(os.tmpdir(), 'qualquer', 'lugar'));
    const env = loadEnvWith({ DB_PATH: 'data/inventory.sqlite' });
    expect(env.dbPath).toBe(path.join(BACKEND_DIR, 'data', 'inventory.sqlite'));
  });

  test('absoluto é mantido', () => {
    const abs = path.join(tmpDir, 'abs.sqlite');
    process.chdir(tmpDir);
    expect(loadEnvWith({ DB_PATH: abs }).dbPath).toBe(abs);
  });

  test.each([':memory:', '  :memory:  '])('%j fica ":memory:" intacto', (raw) => {
    process.chdir(tmpDir);
    expect(loadEnvWith({ DB_PATH: raw }).dbPath).toBe(':memory:');
  });

  test.each([undefined, '', '   '])('DB_PATH=%j → backend/data/inventory.sqlite (absoluto, mesmo com cwd diferente)', (raw) => {
    process.chdir(tmpDir);
    const vars = raw === undefined ? {} : { DB_PATH: raw };
    const env = loadEnvWith(vars);
    expect(env.dbPath).toBe(path.join(BACKEND_DIR, 'data', 'inventory.sqlite'));
  });
});

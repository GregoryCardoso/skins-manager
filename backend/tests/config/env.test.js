'use strict';

const path = require('path');

const KEYS = ['PORT', 'DB_PATH', 'CORS_ORIGIN', 'SLOW_ITEM_DAYS'];
let saved;

// Carrega env.js isolado, sem ler um eventual backend/.env real do usuário.
function loadEnvWith(vars) {
  jest.resetModules();
  jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  return require('../../src/config/env');
}

beforeEach(() => {
  saved = {};
  for (const k of KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  jest.dontMock('dotenv');
  jest.resetModules();
});

describe('config/env', () => {
  test('sem .env e sem variáveis usa os padrões', () => {
    const env = loadEnvWith({});
    expect(env.port).toBe(3001);
    expect(env.slowItemDays).toBe(21);
    expect(env.corsOrigin).toBe('http://localhost:3000');
    expect(path.normalize(env.dbPath)).toBe(path.join(__dirname, '..', '..', 'data', 'inventory.sqlite'));
  });

  test('variáveis vazias também caem nos padrões', () => {
    const env = loadEnvWith({ PORT: '', DB_PATH: '  ', CORS_ORIGIN: '', SLOW_ITEM_DAYS: '' });
    expect(env.port).toBe(3001);
    expect(env.slowItemDays).toBe(21);
    expect(env.corsOrigin).toBe('http://localhost:3000');
    expect(env.dbPath).toMatch(/inventory\.sqlite$/);
  });

  test('lê valores válidos das variáveis', () => {
    const env = loadEnvWith({ PORT: '4000', DB_PATH: ':memory:', CORS_ORIGIN: 'http://x:1', SLOW_ITEM_DAYS: '30' });
    expect(env).toEqual({ port: 4000, dbPath: ':memory:', corsOrigin: 'http://x:1', slowItemDays: 30 });
  });

  test.each(['0', '-1', '1.5', 'abc'])('SLOW_ITEM_DAYS=%s lança erro', (value) => {
    expect(() => loadEnvWith({ SLOW_ITEM_DAYS: value })).toThrow(/SLOW_ITEM_DAYS/);
  });

  test.each(['0', '-1', 'abc'])('PORT=%s lança erro', (value) => {
    expect(() => loadEnvWith({ PORT: value })).toThrow(/PORT/);
  });

  test('objeto exportado é imutável', () => {
    const env = loadEnvWith({ SLOW_ITEM_DAYS: '21' });
    expect(Object.isFrozen(env)).toBe(true);
    expect(() => {
      env.slowItemDays = 99;
    }).toThrow(TypeError);
    expect(env.slowItemDays).toBe(21);
  });

  test('não expõe taxas no env (só as 4 chaves)', () => {
    const env = loadEnvWith({});
    expect(Object.keys(env).sort()).toEqual(['corsOrigin', 'dbPath', 'port', 'slowItemDays']);
  });
});

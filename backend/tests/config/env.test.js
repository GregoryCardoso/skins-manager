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
    expect(env.corsOrigin).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
    expect(path.normalize(env.dbPath)).toBe(path.join(__dirname, '..', '..', 'data', 'inventory.sqlite'));
  });

  test('variáveis vazias também caem nos padrões', () => {
    const env = loadEnvWith({ PORT: '', DB_PATH: '  ', CORS_ORIGIN: '', SLOW_ITEM_DAYS: '' });
    expect(env.port).toBe(3001);
    expect(env.slowItemDays).toBe(21);
    expect(env.corsOrigin).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
    expect(env.dbPath).toMatch(/inventory\.sqlite$/);
  });

  test('lê valores válidos das variáveis', () => {
    const env = loadEnvWith({ PORT: '4000', DB_PATH: ':memory:', CORS_ORIGIN: 'http://x:1', SLOW_ITEM_DAYS: '30' });
    expect(env).toEqual({ port: 4000, dbPath: ':memory:', corsOrigin: ['http://x:1'], slowItemDays: 30 });
  });

  test('CORS_ORIGIN aceita lista separada por vírgula (com espaços e barra final)', () => {
    const env = loadEnvWith({ CORS_ORIGIN: ' http://a:1/ , http://b:2,, ' });
    expect(env.corsOrigin).toEqual(['http://a:1', 'http://b:2']);
  });

  test.each(['0', '-1', '1.5', 'abc'])('SLOW_ITEM_DAYS=%s lança erro', (value) => {
    expect(() => loadEnvWith({ SLOW_ITEM_DAYS: value })).toThrow(/SLOW_ITEM_DAYS/);
  });

  test.each(['0', '-1', 'abc', '70000', '65536'])('PORT=%s lança erro', (value) => {
    expect(() => loadEnvWith({ PORT: value })).toThrow(/PORT/);
  });

  test('PORT nos limites 1 e 65535 é aceito (T2)', () => {
    expect(loadEnvWith({ PORT: '1' }).port).toBe(1);
    expect(loadEnvWith({ PORT: '65535' }).port).toBe(65535);
  });

  test('objeto exportado é imutável', () => {
    const env = loadEnvWith({ SLOW_ITEM_DAYS: '21' });
    expect(Object.isFrozen(env)).toBe(true);
    expect(() => {
      env.slowItemDays = 99;
    }).toThrow(TypeError);
    expect(env.slowItemDays).toBe(21);
  });

  describe('SLOW_ITEM_DAYS de 2 a 365 (D159)', () => {
    test.each(['1', '366', '0', '-1', '21.5', 'abc'])('SLOW_ITEM_DAYS=%s lança com a mensagem do intervalo', (value) => {
      expect(() => loadEnvWith({ SLOW_ITEM_DAYS: value })).toThrow(
        new Error(`Variável de ambiente SLOW_ITEM_DAYS inválida: deve ser um inteiro de 2 a 365 (recebido "${value}").`)
      );
    });

    test.each([['2', 2], ['7', 7], ['8', 8], ['365', 365]])('SLOW_ITEM_DAYS=%s aceito', (value, expected) => {
      expect(loadEnvWith({ SLOW_ITEM_DAYS: value }).slowItemDays).toBe(expected);
    });

    test('SLOW_ITEM_DAYS ausente → 21', () => {
      expect(loadEnvWith({}).slowItemDays).toBe(21);
    });
  });

  test('não expõe taxas no env (só as 4 chaves)', () => {
    const env = loadEnvWith({});
    expect(Object.keys(env).sort()).toEqual(['corsOrigin', 'dbPath', 'port', 'slowItemDays']);
  });
});

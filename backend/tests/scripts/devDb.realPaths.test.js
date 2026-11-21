// 7.2 - o seed:dev recusa os dois bancos reais (novo padrão em %APPDATA% e o antigo backend/data).
const path = require('path');
const { assertSafeTarget, resolveRealDbPaths, DEFAULT_REAL_DB_PATH, LEGACY_REAL_DB_PATH, DEV_DB_PATH } = require('../../scripts/devDb');

describe('devDb - caminhos reais protegidos', () => {
  const none = { envFile: path.join(__dirname, 'nao-existe.env'), env: {} };

  test('assertSafeTarget recusa o banco novo e o antigo, mas aceita o de exemplo', () => {
    const realDbPaths = resolveRealDbPaths(none);
    expect(() => assertSafeTarget(DEFAULT_REAL_DB_PATH, { realDbPaths })).toThrow(/banco real/);
    expect(() => assertSafeTarget(LEGACY_REAL_DB_PATH, { realDbPaths })).toThrow(/banco real/);
    expect(assertSafeTarget(DEV_DB_PATH, { realDbPaths })).toBe(DEV_DB_PATH);
  });

  test('o caminho antigo é backend/data/inventory.sqlite e o novo termina em SkinsManager (ou .skins-manager)', () => {
    expect(LEGACY_REAL_DB_PATH.replace(/\\/g, '/')).toMatch(/backend\/data\/inventory\.sqlite$/);
    expect(DEFAULT_REAL_DB_PATH.replace(/\\/g, '/')).toMatch(/(SkinsManager|\.skins-manager)\/inventory\.sqlite$/);
  });

  test('DB_PATH explícito do ambiente também é protegido, além dos dois padrões', () => {
    const custom = path.join(__dirname, 'meu-banco-real.sqlite');
    const p = resolveRealDbPaths({ ...none, env: { DB_PATH: custom } });
    expect(p.length).toBe(3);
    expect(() => assertSafeTarget(custom, { realDbPaths: p })).toThrow(/banco real/);
  });
});

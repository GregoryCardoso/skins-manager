// D65: função única de atributos de arma (cadastro, edição e consultas). Banco :memory: (tests/setup.js).
const request = require('supertest');
const { freshDb } = require('../helpers/fixtures');
const { closeDb } = require('../../src/config/database');
const { CAT, makeCatalogApp, createItemViaApi, expectError } = require('../helpers/apiFixtures');
const { assertWeaponAttributesAllowed } = require('../../src/services/itemAttributesService');

let app;
beforeEach(() => {
  freshDb();
  app = makeCatalogApp();
});
afterAll(() => closeDb());

const post = (body) => request(app).post('/api/items').send(body);
const patch = (id, body) => request(app).patch(`/api/items/${id}`).send(body);
const box = (o = {}) => ({ catalogId: CAT.CASE_REVOLVER, acquisitionType: 'GANHEI', acquiredAt: '2026-11-10T12:00:00.000Z', ...o });
const stats = (q) => request(app).get('/api/items/stats').query(q);

describe('D65 atributos de arma: função única', () => {
  test('assertWeaponAttributesAllowed', () => {
    expect(() => assertWeaponAttributesAllowed('SKIN', { variant: 'STATTRAK', exterior: 'FN' })).not.toThrow();
    expect(() => assertWeaponAttributesAllowed('CAIXA', {})).not.toThrow();
    expect(() => assertWeaponAttributesAllowed('CAIXA', { phase: '  ' })).not.toThrow();
    for (const attrs of [{ variant: 'NORMAL' }, { floatValue: 0 }, { exterior: 'FN' }, { paintSeed: 0 }, { phase: 'Ruby' }]) {
      expect(() => assertWeaponAttributesAllowed('CAIXA', attrs)).toThrow(expect.objectContaining({ code: 'ATTRIBUTES_NOT_ALLOWED' }));
    }
  });

  test.each([['exterior', 'FN'], ['phase', 'Ruby'], ['variant', 'NORMAL']])(
    '/stats com %s em CAIXA -> 400 ATTRIBUTES_NOT_ALLOWED',
    async (key, value) => {
      expectError(await stats({ name: 'X', category: 'CAIXA', [key]: value }), 400, 'ATTRIBUTES_NOT_ALLOWED');
    }
  );

  // T34: float e paint seed ficam fora da chave do histórico (2.7), em qualquer categoria.
  test.each([['floatValue', '0.01'], ['paintSeed', '5']])('/stats com %s -> 400 INVALID_QUERY', async (key, value) => {
    for (const category of ['CAIXA', 'SKIN']) {
      expectError(await stats({ name: 'X', category, [key]: value }), 400, 'INVALID_QUERY', { field: key });
    }
  });

  test('/stats SKIN com exterior -> 200', async () => {
    expect((await stats({ name: 'AK-47 | Redline', category: 'SKIN', exterior: 'FT' })).status).toBe(200);
  });

  test('cadastro e edição de CAIXA com atributos continuam 400 ATTRIBUTES_NOT_ALLOWED', async () => {
    expectError(await post(box({ exterior: 'FN' })), 400, 'ATTRIBUTES_NOT_ALLOWED');
    const item = await createItemViaApi(app, box());
    expectError(await patch(item.id, { phase: 'Ruby' }), 400, 'ATTRIBUTES_NOT_ALLOWED');
  });
});

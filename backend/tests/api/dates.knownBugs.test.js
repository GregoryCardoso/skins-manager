// Bugs conhecidos encontrados pelo testador (Etapa 3). Marcados com test.failing: a suíte fica verde
// enquanto o bug existir e passa a FALHAR quando ele for corrigido (aí troque test.failing por test).
//
// Bug: dateUtils.parseDate (src/services/dateUtils.js:8) usa `new Date(value)` sem exigir ISO 8601
// (2.0, D7). Datas em formato brasileiro são lidas como mm/dd (EUA) e gravadas silenciosamente erradas.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, purchaseBody, createItemViaApi, expectError, storeId } = require('../helpers/apiFixtures');

let app;
beforeEach(() => {
  freshDb();
  app = makeApp();
});
afterAll(() => closeDb());

describe('datas fora do ISO 8601 (bug conhecido)', () => {
  test.failing('acquiredAt "10/11/2026" (dd/mm) deveria ser 400 INVALID_DATE, não 11/10/2026', async () => {
    const res = await request(app).post('/api/items').send(purchaseBody({ acquiredAt: '10/11/2026' }));
    expectError(res, 400, 'INVALID_DATE');
  });

  test.failing('acquiredAt "1" deveria ser 400 INVALID_DATE, não 2001-01-01', async () => {
    const res = await request(app).post('/api/items').send(purchaseBody({ acquiredAt: '1' }));
    expectError(res, 400, 'INVALID_DATE');
  });

  test.failing('soldAt "18/11/2026" deveria ser 400 INVALID_DATE', async () => {
    const item = await createItemViaApi(app, purchaseBody({ acquiredAt: '2026-01-01T12:00:00.000Z' }));
    const res = await request(app)
      .post(`/api/items/${item.id}/sell`)
      .send({ saleStoreId: storeId('CSFloat'), salePriceCents: 125, soldAt: '11/18/2026' });
    expectError(res, 400, 'INVALID_DATE');
  });
});

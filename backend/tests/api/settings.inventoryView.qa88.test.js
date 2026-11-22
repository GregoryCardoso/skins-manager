// QA 8.8: bordas da preferência inventoryView (D276). Banco :memory: novo a cada teste.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => { freshDb(); app = makeApp(); });
afterAll(() => closeDb());

const patch = (body) => request(app).patch('/api/settings').send(body);
const current = async () => (await request(app).get('/api/settings')).body.data;

describe('PATCH /api/settings { inventoryView }', () => {
  test.each([[null], [''], [' '], ['LIST'], ['grouped'], ['Grouped'], ['individual'], [5], [0], [true], [false], [{}], [['GROUPED']]])(
    'valor %j -> 400 INVALID_INVENTORY_VIEW e nada muda',
    async (value) => {
      await patch({ inventoryView: 'INDIVIDUAL' });
      const res = await patch({ inventoryView: value });
      expectError(res, 400, 'INVALID_INVENTORY_VIEW');
      expect((await current()).inventoryView).toBe('INDIVIDUAL');
    }
  );

  test('com valor válido e outro campo inválido: 400 e a visão não é gravada (atômico)', async () => {
    const res = await patch({ inventoryView: 'INDIVIDUAL', theme: 'PINK' });
    expect(res.status).toBe(400);
    expect((await current()).inventoryView).toBe('GROUPED');
  });

  test('com valor inválido e outro campo válido: 400 e o outro campo não é gravado', async () => {
    const res = await patch({ inventoryView: 'LIST', theme: 'DARK' });
    expectError(res, 400, 'INVALID_INVENTORY_VIEW');
    expect((await current()).theme).toBe('SYSTEM');
  });

  test('outras gravações de configurações preservam a visão', async () => {
    await patch({ inventoryView: 'INDIVIDUAL' });
    expect((await request(app).put('/api/settings/fx-rate').send({ usdBrlRate: 5.1 })).status).toBe(200);
    expect((await patch({ theme: 'DARK' })).body.data.inventoryView).toBe('INDIVIDUAL');
    expect((await patch({ fastTurnoverDays: 3, slowItemDays: 30 })).status).toBe(200);
    expect((await current()).inventoryView).toBe('INDIVIDUAL');
  });

  test('idempotente: gravar o mesmo valor duas vezes funciona', async () => {
    expect((await patch({ inventoryView: 'GROUPED' })).status).toBe(200);
    expect((await patch({ inventoryView: 'GROUPED' })).status).toBe(200);
    expect((await current()).inventoryView).toBe('GROUPED');
  });

  test('só inventoryView também conta como "ao menos um campo"; corpo vazio continua 400', async () => {
    expect((await patch({ inventoryView: 'INDIVIDUAL' })).status).toBe(200);
    expect((await patch({})).status).toBe(400);
  });

  test('Content-Type diferente de JSON -> 415', async () => {
    const res = await request(app).patch('/api/settings').set('Content-Type', 'text/plain').send('{"inventoryView":"INDIVIDUAL"}');
    expect(res.status).toBe(415);
    expect((await current()).inventoryView).toBe('GROUPED');
  });

  test('Host estranho -> 403 e nada muda', async () => {
    const res = await request(app).patch('/api/settings').set('Host', 'evil.example.com').send({ inventoryView: 'INDIVIDUAL' });
    expect(res.status).toBe(403);
    expect((await current()).inventoryView).toBe('GROUPED');
  });

  test('a resposta do PATCH traz a visão e o GET seguinte confere', async () => {
    const res = await patch({ inventoryView: 'INDIVIDUAL' });
    expect(res.body.success).toBe(true);
    expect(res.body.data.inventoryView).toBe('INDIVIDUAL');
    expect((await current()).inventoryView).toBe('INDIVIDUAL');
  });
});

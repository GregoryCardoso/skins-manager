// QA da 12.5a (D370): inventoryDensity no PATCH /api/settings — ausente, atômico com outros campos, formato de erro.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => { freshDb(); app = makeApp(); });
afterAll(() => closeDb());

const patch = (body) => request(app).patch('/api/settings').send(body);
const current = async () => (await request(app).get('/api/settings')).body.data;

describe('inventoryDensity: bordas do PATCH', () => {
  test('ausente no corpo: o valor gravado não muda, mesmo trocando outra preferência', async () => {
    await patch({ inventoryDensity: 'COMFORTABLE' });
    const res = await patch({ theme: 'DARK' });
    expect(res.status).toBe(200);
    expect(res.body.data.inventoryDensity).toBe('COMFORTABLE');
    expect((await current()).inventoryDensity).toBe('COMFORTABLE');
  });

  test('densidade inválida junto de um campo válido: nada é gravado (nem o campo válido)', async () => {
    const before = await current();
    const res = await patch({ theme: 'DARK', inventoryDensity: 'WIDE' });
    expectError(res, 400, 'INVALID_FIELD', { field: 'inventoryDensity' });
    const after = await current();
    expect(after.theme).toBe(before.theme);
    expect(after.inventoryDensity).toBe('COMPACT');
  });

  test('o mesmo valor repetido é aceito (idempotente) e o GET traz a chave no objeto', async () => {
    expect((await patch({ inventoryDensity: 'COMPACT' })).status).toBe(200);
    expect((await patch({ inventoryDensity: 'COMPACT' })).status).toBe(200);
    expect(await current()).toHaveProperty('inventoryDensity', 'COMPACT');
  });

  test('corpo vazio continua 400 e a mensagem cita inventoryDensity; array e texto como corpo também falham', async () => {
    const res = await patch({});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('inventoryDensity');
    expect((await request(app).patch('/api/settings').send([{ inventoryDensity: 'COMPACT' }])).status).toBe(400);
  });

  test('exige Content-Type JSON (rota que altera dados)', async () => {
    const res = await request(app).patch('/api/settings').set('Content-Type', 'text/plain').send('{"inventoryDensity":"COMFORTABLE"}');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBe(false);
    expect((await current()).inventoryDensity).toBe('COMPACT');
  });

  test('caixa errada e variações são recusadas (não há normalização)', async () => {
    for (const value of ['comfortable', 'Comfortable', ' COMFORTABLE', 'COMFORTABLE ']) {
      expectError(await patch({ inventoryDensity: value }), 400, 'INVALID_FIELD', { field: 'inventoryDensity' });
    }
  });
});

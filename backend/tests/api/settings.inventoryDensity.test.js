// 12.5a (D370): preferência inventoryDensity (v027). Banco :memory: novo a cada teste.
const request = require('supertest');
const { closeDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeApp, expectError } = require('../helpers/apiFixtures');

let app;
beforeEach(() => { freshDb(); app = makeApp(); });
afterAll(() => closeDb());

const patch = (body) => request(app).patch('/api/settings').send(body);
const current = async () => (await request(app).get('/api/settings')).body.data;

describe('PATCH /api/settings { inventoryDensity }', () => {
  test('o padrão é COMPACT; troca e persiste; o corpo só com a densidade é aceito', async () => {
    expect((await current()).inventoryDensity).toBe('COMPACT');
    const res = await patch({ inventoryDensity: 'COMFORTABLE' });
    expect(res.status).toBe(200);
    expect(res.body.data.inventoryDensity).toBe('COMFORTABLE');
    expect((await current()).inventoryDensity).toBe('COMFORTABLE');
    expect((await patch({ inventoryDensity: 'COMPACT' })).body.data.inventoryDensity).toBe('COMPACT');
  });

  test.each([[null], [''], ['compact'], ['WIDE'], [5], [true], [{}]])('valor %j -> 400 INVALID_FIELD e nada muda', async (value) => {
    await patch({ inventoryDensity: 'COMFORTABLE' });
    const res = await patch({ inventoryDensity: value });
    expectError(res, 400, 'INVALID_FIELD');
    expect((await current()).inventoryDensity).toBe('COMFORTABLE');
  });

  test('não mexe nas outras preferências', async () => {
    await patch({ inventoryView: 'INDIVIDUAL', theme: 'DARK' });
    await patch({ inventoryDensity: 'COMFORTABLE' });
    expect(await current()).toMatchObject({ inventoryView: 'INDIVIDUAL', theme: 'DARK', inventoryDensity: 'COMFORTABLE' });
  });
});

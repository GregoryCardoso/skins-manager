const request = require('supertest');
const app = require('../src/app');
const { getDb, closeDb } = require('../src/config/database');
const Store = require('../src/models/Store');
const Setting = require('../src/models/Setting');

afterAll(() => closeDb());

describe('smoke', () => {
  test('GET /api/health', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
  });

  test('404 padronizado', async () => {
    const res = await request(app).get('/api/nada');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('JSON malformado -> 400', async () => {
    const res = await request(app).post('/api/health').set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  test('banco e seed', () => {
    expect(getDb().pragma('user_version', { simple: true })).toBe(1);
    expect(getDb().pragma('foreign_keys', { simple: true })).toBe(1);
    expect(Store.findAll().map((s) => s.name)).toEqual(['CSFloat', 'CSMoney', 'Steam']);
    expect(Store.findPrimary().name).toBe('CSFloat');
    expect(Store.findAll().find((s) => s.name === 'CSMoney').saleFeeRate).toBeNull();
    expect(Setting.get().usdBrlRate).toBeNull();
  });
});

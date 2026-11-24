const request = require('supertest');
const app = require('../src/app');
const { createApp } = require('../src/app');
const { getDb, closeDb } = require('../src/config/database');
const Store = require('../src/models/Store');
const Setting = require('../src/models/Setting');

afterAll(() => closeDb());

// Health, 404 e JSON malformado já são cobertos em tests/middlewares/errorHandler.test.js (T7).
describe('app', () => {
  test('banco e seed', () => {
    expect(getDb().pragma('user_version', { simple: true })).toBe(18);
    expect(getDb().pragma('foreign_keys', { simple: true })).toBe(1);
    expect(Store.findAll().map((s) => s.name)).toEqual(['CSFloat', 'CSMoney', 'Steam']);
    expect(Store.findPrimary().name).toBe('CSFloat');
    expect(Store.findAll().find((s) => s.name === 'CSMoney').saleFeeRate).toBeNull();
    expect(Setting.get().usdBrlRate).toBeNull();
  });

  test('T8: sem cabeçalho X-Powered-By', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  test('createApp({ now }) usa o relógio injetado (health)', async () => {
    const fixed = createApp({ now: () => new Date('2026-11-19T15:00:00.000Z') });
    const res = await request(fixed).get('/api/health');
    expect(res.body.data.timestamp).toBe('2026-11-19T15:00:00.000Z');
  });
});

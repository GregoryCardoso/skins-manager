const { closeDb, getDb } = require('../../src/config/database');
const Setting = require('../../src/models/Setting');
const { freshDb } = require('../helpers/fixtures');

beforeEach(() => freshDb());
afterAll(() => closeDb());

describe('models/Setting', () => {
  test('get() com cotação nula funciona', () => {
    const s = Setting.get();
    expect(s).toMatchObject({ id: 1, usdBrlRate: null, usdBrlRateUpdatedAt: null });
    expect(typeof s.updatedAt).toBe('string');
  });

  test('update grava cotação, preserva campos não enviados e muda updatedAt', () => {
    jest.useFakeTimers({ now: new Date('2026-06-01T00:00:00.000Z') });
    try {
      Setting.update({ usdBrlRate: 5.1, usdBrlRateUpdatedAt: '2026-06-01T00:00:00.000Z' });
      jest.setSystemTime(new Date('2026-06-02T00:00:00.000Z'));
      const s = Setting.update({ usdBrlRate: 5.3 });
      expect(s).toEqual({
        id: 1, usdBrlRate: 5.3, usdBrlRateUpdatedAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-02T00:00:00.000Z',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  test('update com null volta a cotação para nula', () => {
    Setting.update({ usdBrlRate: 5 });
    expect(Setting.update({ usdBrlRate: null }).usdBrlRate).toBeNull();
  });

  test.each([0, -1])('cotação %p recusada', (rate) => {
    expect(() => Setting.update({ usdBrlRate: rate })).toThrow(/CHECK/);
  });

  test('inserir id = 2 falha (linha única)', () => {
    expect(() =>
      getDb().prepare("INSERT INTO settings (id, updated_at) VALUES (2, '2026-01-01T00:00:00.000Z')").run()
    ).toThrow(/CHECK/);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM settings').get().n).toBe(1);
  });
});

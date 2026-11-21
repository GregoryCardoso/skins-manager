const { closeDb } = require('../../src/config/database');
const settingsService = require('../../src/services/settingsService');
const { freshDb } = require('../helpers/fixtures');

beforeEach(() => freshDb());
afterAll(() => closeDb());

describe('settingsService', () => {
  test.each([0, -1, NaN, Infinity, '5', null])('updateFxRate(%p) -> INVALID_FX_RATE', (v) => {
    expect(() => settingsService.updateFxRate(v)).toThrow(expect.objectContaining({ code: 'INVALID_FX_RATE', status: 400 }));
    expect(settingsService.getSettings().usdBrlRate).toBeNull();
  });

  test('5.1234 aceito; usdBrlRateUpdatedAt e updatedAt = now', () => {
    const now = new Date('2026-11-19T15:00:00.000Z');
    expect(settingsService.updateFxRate(5.1234, { now })).toEqual({
      usdBrlRate: 5.1234,
      usdBrlRateUpdatedAt: '2026-11-19T15:00:00.000Z',
      catalogUpdatedAt: null, theme: 'SYSTEM', language: 'pt-BR', usdBrlRateSource: 'MANUAL',
      agingThresholdsAdjusted: false, fastTurnoverDays: 7, fastTurnoverDaysCustom: null, fastTurnoverDaysDefault: 7,
      slowItemDays: 21, slowItemDaysCustom: null, slowItemDaysDefault: 21, rateQuotedAt: null, fxRefreshSource: 'AWESOMEAPI',
      updatedAt: '2026-11-19T15:00:00.000Z',
    });
  });
});

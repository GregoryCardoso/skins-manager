const itemService = require('../../src/services/itemService');
const { buildSaleRecord, buildUnsellPatch, toItemView } = itemService;
// T31: `body` é obrigatório; `{}` equivale a "nada além do estado mesclado foi enviado".
const buildItemRecord = (merged, ctx = {}) => itemService.buildItemRecord(merged, { body: {}, ...ctx });
const { buildStatsIndex } = require('../../src/services/itemStatsService');
const { csfloat, steam, csmoney, usdItem } = require('../helpers/storeFixtures');

const NOW = new Date('2026-11-19T15:00:00.000Z');
const SETTINGS = { usdBrlRate: 5 };

function codeOf(fn) {
  try {
    fn();
  } catch (err) {
    return err.code;
  }
  return undefined;
}

const base = (o = {}) => ({
  name: ' AK-47 | Redline ', category: 'SKIN', acquisitionType: 'COMPRA', purchaseStoreId: 1, purchasePriceCents: 100,
  acquiredAt: '2026-11-10T12:00:00.000Z', ...o,
});

describe('buildItemRecord', () => {
  test('T31: sem body é erro de programação (Error, não AppError)', () => {
    expect(() => itemService.buildItemRecord(base(), { store: csfloat(), settings: SETTINGS, now: NOW })).toThrow(
      /exige o corpo/
    );
    expect(() => itemService.buildItemRecord(base(), { store: csfloat(), settings: SETTINGS, now: NOW, body: null })).toThrow(Error);
  });

  test('COMPRA USD: trim, moeda da loja, atributos normalizados', () => {
    const r = buildItemRecord(base({ floatValue: 0.1 }), { store: csfloat(), settings: SETTINGS, now: NOW });
    expect(r).toMatchObject({
      name: 'AK-47 | Redline', purchaseCurrency: 'USD', fxRateAtPurchase: null, exterior: 'MW', variant: 'NORMAL',
      acquiredAt: '2026-11-10T12:00:00.000Z', tradeUnlockAt: null,
    });
  });

  test('GANHEI sem loja e sem preço; omitido acquiredAt -> now', () => {
    const r = buildItemRecord(
      { name: 'x', category: 'CAIXA', acquisitionType: 'GANHEI' }, { store: null, settings: SETTINGS, now: NOW }
    );
    expect(r).toMatchObject({ purchasePriceCents: 0, purchaseCurrency: 'USD', purchaseStoreId: null, acquiredAt: NOW.toISOString() });
  });

  test('BRL usa cotação informada, depois a das configurações; sem nenhuma -> FX_RATE_REQUIRED', () => {
    const b = base({ purchaseStoreId: 2 });
    expect(buildItemRecord(b, { store: steam(), settings: SETTINGS, now: NOW }).fxRateAtPurchase).toBe(5);
    expect(buildItemRecord({ ...b, fxRateAtPurchase: 5.5 }, { store: steam(), settings: SETTINGS, now: NOW }).fxRateAtPurchase).toBe(5.5);
    expect(codeOf(() => buildItemRecord(b, { store: steam(), settings: { usdBrlRate: null }, now: NOW }))).toBe('FX_RATE_REQUIRED');
    expect(codeOf(() => buildItemRecord({ ...b, fxRateAtPurchase: -1 }, { store: steam(), settings: SETTINGS, now: NOW }))).toBe('INVALID_FX_RATE');
  });

  test('erros de regra', () => {
    const ctx = { store: csfloat(), settings: SETTINGS, now: NOW };
    expect(codeOf(() => buildItemRecord(base({ name: '  ' }), ctx))).toBe('REQUIRED_FIELD');
    expect(codeOf(() => buildItemRecord(base({ purchaseStoreId: null }), ctx))).toBe('PURCHASE_STORE_REQUIRED');
    expect(codeOf(() => buildItemRecord(base({ purchasePriceCents: null }), ctx))).toBe('PURCHASE_PRICE_REQUIRED');
    expect(codeOf(() => buildItemRecord(base({ purchasePriceCents: -5 }), ctx))).toBe('INVALID_AMOUNT');
    expect(codeOf(() => buildItemRecord(base({ fxRateAtPurchase: 5 }), ctx))).toBe('FX_RATE_NOT_ALLOWED');
    expect(codeOf(() => buildItemRecord(base(), { ...ctx, store: null }))).toBe('STORE_NOT_FOUND');
    expect(codeOf(() => buildItemRecord(base({ acquiredAt: '2026-11-20T03:00:00Z' }), ctx))).toBe('ACQUIRED_AT_IN_FUTURE');
  });

  test('item vendido: acquiredAt posterior a soldAt -> SOLD_BEFORE_ACQUIRED', () => {
    const existing = { status: 'VENDIDO', soldAt: '2026-11-12T00:00:00.000Z', acquiredAt: '2026-11-10T12:00:00.000Z' };
    const ctx = { store: csfloat(), settings: SETTINGS, now: NOW, existing };
    expect(codeOf(() => buildItemRecord(base({ acquiredAt: '2026-11-13T00:00:00Z' }), ctx))).toBe('SOLD_BEFORE_ACQUIRED');
    expect(codeOf(() => buildItemRecord(base({ acquiredAt: '2026-11-12T00:00:00Z' }), ctx))).toBeUndefined();
  });
});

describe('buildSaleRecord', () => {
  const item = usdItem({ acquiredAt: '2026-11-10T12:00:00.000Z', tradeUnlockAt: null });
  const input = (o = {}) => ({ salePriceCents: 125, soldAt: '2026-11-18T12:00:00.000Z', ...o });
  const ctx = (o = {}) => ({ store: csfloat(), settings: SETTINGS, now: NOW, ...o });

  test('CSFloat 125 -> 122 e snapshot; sem campo warnings', () => {
    const { record, sale } = buildSaleRecord(item, input(), ctx());
    expect(sale).toEqual({ netReceivedCents: 122, feeCents: 3, netReceivedManual: false });
    expect(record).toEqual({
      status: 'VENDIDO', saleStoreId: 1, salePriceCents: 125, saleCurrency: 'USD', fxRateAtSale: null,
      saleFeeTypeApplied: 'DEDUCTED', saleFeeRateApplied: 0.02, saleFeeRoundingApplied: 'CEIL',
      saleMinFeeCentsApplied: null, saleFixedFeeCentsApplied: 0, netReceivedCents: 122, netReceivedManual: false,
      soldAt: '2026-11-18T12:00:00.000Z',
    });
  });

  test('Steam em BRL com cotação', () => {
    const { record } = buildSaleRecord(item, input({ salePriceCents: 115 }), ctx({ store: steam() }));
    expect(record).toMatchObject({ saleCurrency: 'BRL', fxRateAtSale: 5, netReceivedCents: 100 });
  });

  test('erros de data e loja', () => {
    expect(codeOf(() => buildSaleRecord(item, input({ soldAt: 'x' }), ctx()))).toBe('INVALID_DATE');
    expect(codeOf(() => buildSaleRecord(item, input({ soldAt: '2026-11-20T03:00:00Z' }), ctx()))).toBe('SOLD_AT_IN_FUTURE');
    expect(codeOf(() => buildSaleRecord(item, input({ soldAt: '2026-11-09T00:00:00Z' }), ctx()))).toBe('SOLD_BEFORE_ACQUIRED');
    expect(codeOf(() => buildSaleRecord(item, input(), ctx({ store: csmoney() })))).toBe('FEES_NOT_CONFIGURED');
  });

  describe('trade lock avaliado em soldAt (nunca em now)', () => {
    const locked = usdItem({ acquiredAt: '2026-11-10T12:00:00.000Z', tradeUnlockAt: '2026-11-15T12:00:00.000Z' });

    test('antes do unlock -> ConflictError 409 ITEM_TRADE_LOCKED, mesmo com now depois do unlock', () => {
      let err;
      try {
        buildSaleRecord(locked, input({ soldAt: '2026-11-14T12:00:00.000Z' }), ctx());
      } catch (e) {
        err = e;
      }
      expect(err).toMatchObject({ status: 409, code: 'ITEM_TRADE_LOCKED', message: 'Item em trade lock até 15/11/2026 09:00' });
    });

    test('exatamente no unlock e depois do unlock -> ok', () => {
      expect(() => buildSaleRecord(locked, input({ soldAt: '2026-11-15T12:00:00.000Z' }), ctx())).not.toThrow();
      expect(() => buildSaleRecord(locked, input({ soldAt: '2026-11-16T12:00:00.000Z' }), ctx())).not.toThrow();
    });

    test('sem tradeUnlockAt -> ok', () => {
      expect(() => buildSaleRecord(item, input(), ctx())).not.toThrow();
    });

    test('a checagem de datas vem antes do trade lock', () => {
      expect(codeOf(() => buildSaleRecord(locked, input({ soldAt: '2026-11-09T00:00:00Z' }), ctx()))).toBe('SOLD_BEFORE_ACQUIRED');
    });
  });
});

describe('buildUnsellPatch', () => {
  test('status EM_ESTOQUE, os 11 campos de venda null e netReceivedManual false (D122)', () => {
    const patch = buildUnsellPatch();
    const { status, ...rest } = patch;
    expect(status).toBe('EM_ESTOQUE');
    expect(Object.keys(rest).sort()).toEqual([
      'fxRateAtSale', 'netReceivedCents', 'netReceivedManual', 'saleCurrency', 'saleFeeRateApplied', 'saleFeeRoundingApplied',
      'saleFeeTypeApplied', 'saleFixedFeeCentsApplied', 'saleMinFeeCentsApplied', 'salePriceCents', 'saleStoreId', 'soldAt',
    ]);
    expect(patch.netReceivedManual).toBe(false);
    const { netReceivedManual, ...nulls } = rest;
    expect(Object.values(nulls).every((v) => v === null)).toBe(true);
  });
});

describe('toItemView', () => {
  test('T81: sem thresholds lança Error de programação', () => {
    const item = { id: 1, status: 'EM_ESTOQUE', acquiredAt: '2026-01-01T00:00:00.000Z', tradeUnlockAt: null };
    expect(() => toItemView(item, { stores: [], settings: null, statsIndex: buildStatsIndex([item]), now: NOW })).toThrow(Error);
  });

  const stores = [csfloat(), steam(), csmoney()];

  test('item em estoque: tradeLock, aging, minPrices, stats', () => {
    const item = usdItem({ tradeUnlockAt: null });
    const view = toItemView(item, { stores, settings: SETTINGS, statsIndex: buildStatsIndex([item]), now: NOW, thresholds: { fastTurnoverDays: 7, slowItemDays: 21 } });
    expect(view.tradeLock.isLocked).toBe(false);
    expect(view.aging).toEqual({ daysInInventory: 18, daysForSale: 18, agingBucket: 'EM_GIRO' });
    expect(view.minPrices.find((m) => m.storeName === 'CSFloat').minPriceCents).toBe(103);
    expect(view.saleProfitUsdCents).toBeNull();
    expect(view.stats.soldCount).toBe(0);
    expect(view.id).toBe(1);
  });

  test('item vendido: minPrices null e lucro', () => {
    const item = usdItem({
      status: 'VENDIDO', soldAt: '2026-11-05T12:00:00.000Z', saleCurrency: 'USD', fxRateAtSale: null,
      netReceivedCents: 122, salePriceCents: 125,
    });
    const view = toItemView(item, { stores, settings: SETTINGS, statsIndex: buildStatsIndex([item]), now: NOW, thresholds: { fastTurnoverDays: 7, slowItemDays: 21 } });
    expect(view.minPrices).toBeNull();
    expect(view.saleProfitUsdCents).toBe(22);
    expect(view.aging).toEqual({ turnaroundDays: 4, turnaroundBucket: 'GIRO_RAPIDO', daysHeld: 4 });
  });
});

describe('MAX_AMOUNT_CENTS nas funções puras (D50/D63)', () => {
  const MAX = 1e10;
  const item = { acquiredAt: '2026-11-01T00:00:00.000Z', tradeUnlockAt: null };

  test('buildItemRecord: no teto passa; acima dá INVALID_AMOUNT', () => {
    const ctx = { store: csfloat(), settings: SETTINGS, now: NOW };
    expect(buildItemRecord(base({ purchasePriceCents: MAX }), ctx).purchasePriceCents).toBe(MAX);
    expect(codeOf(() => buildItemRecord(base({ purchasePriceCents: MAX + 1 }), ctx))).toBe('INVALID_AMOUNT');
  });

  test('buildItemRecord na edição: valor legado acima do teto não travado se o preço não foi informado', () => {
    const existing = { ...base(), purchaseCurrency: 'USD', status: 'EM_ESTOQUE' };
    const ctx = { store: csfloat(), settings: SETTINGS, now: NOW, existing };
    expect(buildItemRecord(base({ purchasePriceCents: 9e15 }), { ...ctx, priceInformed: false }).purchasePriceCents).toBe(9e15);
    expect(codeOf(() => buildItemRecord(base({ purchasePriceCents: 9e15 }), { ...ctx, priceInformed: true }))).toBe('INVALID_AMOUNT');
  });

  test('buildSaleRecord: acima do teto dá INVALID_AMOUNT; no teto passa', () => {
    const ctx = { store: csfloat(), settings: SETTINGS, now: NOW };
    const input = (p) => ({ salePriceCents: p, soldAt: '2026-11-10T12:00:00.000Z' });
    expect(codeOf(() => buildSaleRecord(item, input(MAX + 1), ctx))).toBe('INVALID_AMOUNT');
    expect(buildSaleRecord(item, input(MAX), ctx).record.salePriceCents).toBe(MAX);
  });

  test('GANHEI com troca de moeda e sem preço informado: custo 0 e sem PURCHASE_PRICE_REQUIRED', () => {
    const existing = { ...base(), purchaseCurrency: 'BRL', status: 'EM_ESTOQUE' };
    const r = buildItemRecord(
      base({ acquisitionType: 'GANHEI', purchaseStoreId: null, purchasePriceCents: 0 }),
      { store: null, settings: SETTINGS, now: NOW, existing, priceInformed: false }
    );
    expect(r).toMatchObject({ purchasePriceCents: 0, purchaseCurrency: 'USD' });
  });
});

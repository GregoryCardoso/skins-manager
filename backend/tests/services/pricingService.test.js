'use strict';

const {
  findMinSalePriceCents,
  minPriceForStore,
  minPricesForItem,
  computeSale,
} = require('../../src/services/pricingService');
const { getSaleFeeStrategy } = require('../../src/services/fees');
const { ValidationError } = require('../../src/errors/AppError');
const { closeDb } = require('../../src/config/database');
const Store = require('../../src/models/Store');
const { freshDb } = require('../helpers/fixtures');
const { CSF, STEAM_PARAMS, csfloat, steam, csmoney, usdItem } = require('../helpers/storeFixtures');

const SETTINGS = { usdBrlRate: 5.0 };

afterAll(() => closeDb());

describe('Testes obrigatórios da CSFloat — preço mínimo (C5–C7)', () => {
  test.each([
    ['C5', 100, 103],
    ['C6', 2, 3],
    ['C7', 0, 1],
  ])('%s: findMinSalePriceCents custo %i USD → %i', (_id, cost, expected) => {
    expect(findMinSalePriceCents(cost, CSF)).toBe(expected);
  });

  test.each([
    ['C5', 100, 103],
    ['C6', 2, 3],
    ['C7', 0, 1],
  ])('%s: minPricesForItem (loja CSFloat do seed) custo %i USD → %i', (_id, cost, expected) => {
    const result = minPricesForItem({ item: usdItem({ purchasePriceCents: cost }), stores: [csfloat()], settings: SETTINGS });
    expect(result).toEqual([{ storeId: 1, storeName: 'CSFloat', currency: 'USD', minPriceCents: expected, warning: null, warningCode: null }]);
  });
});

describe('C8 — taxa de venda nula → null + "taxas não configuradas"', () => {
  test('C8: loja CSMoney do seed (lida do banco :memory:)', () => {
    freshDb();
    const seeded = Store.findAll().find((s) => s.name === 'CSMoney');
    expect(seeded.saleFeeType).toBeNull();
    expect(seeded.saleFeeRate).toBeNull();
    const result = minPriceForStore({ costCents: 100, costCurrency: 'USD', costFxRate: null, store: seeded, settings: SETTINGS });
    expect(result).toEqual({
      storeId: seeded.id, storeName: 'CSMoney', currency: 'USD', minPriceCents: null, warning: 'taxas não configuradas', warningCode: 'FEES_NOT_CONFIGURED',
    });
  });

  test.each([
    ['só rate nulo', { saleFeeRate: null }],
    ['só type nulo', { saleFeeType: null }],
  ])('C8: %s', (_label, overrides) => {
    const result = minPriceForStore({ costCents: 100, costCurrency: 'USD', costFxRate: null, store: csfloat(overrides), settings: SETTINGS });
    expect(result).toMatchObject({ minPriceCents: null, warning: 'taxas não configuradas' });
  });

  test('C8: CSMoney fixture também retorna null + aviso', () => {
    const result = minPriceForStore({ costCents: 0, costCurrency: 'USD', costFxRate: null, store: csmoney(), settings: SETTINGS });
    expect(result).toMatchObject({ minPriceCents: null, warning: 'taxas não configuradas' });
  });
});

describe('C9–C11 — taxa de saque não afeta o mínimo (D32)', () => {
  test('C9: custo 100 com withdrawalFeeRate 0.025/0.005/null e fixa 0/50 → sempre 103', () => {
    const results = [];
    for (const withdrawalFeeRate of [0.025, 0.005, null]) {
      for (const withdrawalFixedFeeCents of [0, 50]) {
        const store = csfloat({ withdrawalFeeRate, withdrawalFixedFeeCents });
        const r = minPricesForItem({ item: usdItem({ purchasePriceCents: 100 }), stores: [store], settings: SETTINGS });
        expect(r[0].minPriceCents).toBe(103);
        results.push(r);
      }
    }
    for (const r of results) expect(r).toEqual(results[0]);
  });

  test('C10: com e sem lista de saques no contexto → resultados idênticos', () => {
    const item = usdItem({ purchasePriceCents: 100 });
    const stores = [csfloat(), steam(), csmoney()];
    const withdrawals = [
      { id: 1, storeId: 1, amountStoreCents: 1000, amountBrlCents: 4000, withdrawnAt: '2026-11-10T12:00:00.000Z' },
      { id: 2, storeId: 1, amountStoreCents: 1000, amountBrlCents: 6000, withdrawnAt: '2026-11-11T12:00:00.000Z' },
    ];
    const without = minPricesForItem({ item, stores, settings: SETTINGS });
    const withList = minPricesForItem({ item, stores, settings: SETTINGS, withdrawals });
    expect(withList).toEqual(without);
    expect(without[0].minPriceCents).toBe(103);
  });

  test('C11: cada entrada tem exatamente as chaves esperadas e nenhuma de saque', () => {
    const items = [
      usdItem({ purchasePriceCents: 100 }),
      usdItem({ purchasePriceCents: 0 }),
      usdItem({ purchasePriceCents: 5000, purchaseCurrency: 'BRL', fxRateAtPurchase: 5.0 }),
    ];
    for (const item of items) {
      const result = minPricesForItem({ item, stores: [csfloat(), steam(), csmoney()], settings: SETTINGS });
      expect(result).toHaveLength(3);
      for (const entry of result) {
        expect(Object.keys(entry).sort()).toEqual(['currency', 'minPriceCents', 'storeId', 'storeName', 'warning', 'warningCode']);
        for (const key of Object.keys(entry)) expect(key).not.toMatch(/sac|withdraw/i);
      }
    }
  });
});

describe('pricingService — demais casos', () => {
  test('Steam BRL: custo 100 BRL → 115', () => {
    const item = usdItem({ purchasePriceCents: 100, purchaseCurrency: 'BRL', fxRateAtPurchase: 5.0 });
    expect(minPricesForItem({ item, stores: [steam()], settings: SETTINGS })[0].minPriceCents).toBe(115);
    expect(findMinSalePriceCents(100, STEAM_PARAMS)).toBe(115);
  });

  test('Steam BRL: custo 0 → 1', () => {
    expect(findMinSalePriceCents(0, STEAM_PARAMS)).toBe(1);
  });

  test('item USD 1000 + Steam com usdBrlRate 5.0 → custo 5000 BRL → 5750', () => {
    const r = minPricesForItem({ item: usdItem({ purchasePriceCents: 1000 }), stores: [steam()], settings: SETTINGS });
    expect(r[0]).toEqual({ storeId: 2, storeName: 'Steam', currency: 'BRL', minPriceCents: 5750, warning: null, warningCode: null });
  });

  test('usdBrlRate nulo → Steam null + "cotação não configurada"', () => {
    const r = minPricesForItem({ item: usdItem({ purchasePriceCents: 1000 }), stores: [steam()], settings: { usdBrlRate: null } });
    expect(r[0]).toMatchObject({ minPriceCents: null, warning: 'cotação não configurada' });
  });

  test('item BRL 5000 com fxRateAtPurchase 5.0 na CSFloat → 1021', () => {
    const item = usdItem({ purchasePriceCents: 5000, purchaseCurrency: 'BRL', fxRateAtPurchase: 5.0 });
    expect(minPricesForItem({ item, stores: [csfloat()], settings: SETTINGS })[0].minPriceCents).toBe(1021);
  });

  test('custo BRL→USD usa CEIL (5001 BRL / 5.0 = 1000.2 → 1001 de custo)', () => {
    const r = minPriceForStore({ costCents: 5001, costCurrency: 'BRL', costFxRate: 5.0, store: csfloat(), settings: SETTINGS });
    expect(r.minPriceCents).toBe(findMinSalePriceCents(1001, CSF));
  });

  test('item BRL sem fxRateAtPurchase em loja USD → "cotação não configurada"', () => {
    const r = minPriceForStore({ costCents: 5000, costCurrency: 'BRL', costFxRate: null, store: csfloat(), settings: SETTINGS });
    expect(r).toMatchObject({ minPriceCents: null, warning: 'cotação não configurada' });
  });

  test('loja inativa é omitida; ordem recebida preservada', () => {
    const stores = [steam(), csfloat({ isActive: false }), csmoney()];
    const r = minPricesForItem({ item: usdItem(), stores, settings: SETTINGS });
    expect(r.map((e) => e.storeName)).toEqual(['Steam', 'CSMoney']);
  });

  test.each([
    ['DEDUCTED ROUND', { ...CSF, rounding: 'ROUND' }],
    ['DEDUCTED FLOOR', { ...CSF, rounding: 'FLOOR' }],
    ['DEDUCTED FLOOR + minFee 3', { ...CSF, rounding: 'FLOOR', minFeeCents: 3 }],
    ['ADDED ROUND', { ...STEAM_PARAMS, rounding: 'ROUND' }],
    ['ADDED FLOOR', { ...STEAM_PARAMS, rounding: 'FLOOR' }],
  ])('%s: mínimo igual à força bruta em 1..5000', (_label, params) => {
    const strategy = getSaleFeeStrategy(params.feeType);
    for (const cost of [0, 1, 2, 3, 49, 50, 51, 99, 100, 101, 124, 125, 999, 1000, 1234, 2500, 4000]) {
      let brute = null;
      for (let g = 1; g <= 5000; g += 1) {
        if (strategy.net(g, params) >= cost) {
          brute = g;
          break;
        }
      }
      expect(findMinSalePriceCents(cost, params)).toBe(brute);
    }
  });

  test('custo negativo ou decimal → ValidationError', () => {
    expect(() => findMinSalePriceCents(-1, CSF)).toThrow(ValidationError);
    expect(() => findMinSalePriceCents(1.5, CSF)).toThrow(ValidationError);
  });
});

describe('pricingService.computeSale', () => {
  test('CSFloat 125 → netReceived 122 + snapshot completo', () => {
    expect(computeSale({ salePriceCents: 125, store: csfloat() })).toEqual({
      netReceivedCents: 122,
      feeCents: 3,
      snapshot: {
        saleFeeTypeApplied: 'DEDUCTED',
        saleFeeRateApplied: 0.02,
        saleFeeRoundingApplied: 'CEIL',
        saleMinFeeCentsApplied: null,
        saleFixedFeeCentsApplied: 0,
      },
    });
  });

  test('Steam 115 (preço do comprador) → netReceived 100', () => {
    const r = computeSale({ salePriceCents: 115, store: steam() });
    expect(r.netReceivedCents).toBe(100);
    expect(r.feeCents).toBe(15);
    expect(r.snapshot.saleFeeTypeApplied).toBe('ADDED');
  });

  test('loja sem taxa → FEES_NOT_CONFIGURED', () => {
    expect(() => computeSale({ salePriceCents: 100, store: csmoney() })).toThrow(
      expect.objectContaining({ name: 'ValidationError', code: 'FEES_NOT_CONFIGURED' })
    );
  });

  test.each([0, -1, 1.5, '100', null])('preço inválido (%p) → ValidationError', (price) => {
    expect(() => computeSale({ salePriceCents: price, store: csfloat() })).toThrow(ValidationError);
  });

  test('minFee maior que o preço → ValidationError (líquido negativo)', () => {
    expect(() => computeSale({ salePriceCents: 30, store: csfloat({ saleMinFeeCents: 50 }) })).toThrow(ValidationError);
  });
});

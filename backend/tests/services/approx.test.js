'use strict';

// "≈" calculado no backend (D101, 4B2-Q1): approxCounterpart e minPrices[].approx.
const { approxCounterpart, fromUsdCents, toUsdCents } = require('../../src/services/currencyService');
const { minPriceForStore, minPricesForItem } = require('../../src/services/pricingService');
const { csfloat, steam, csmoney } = require('../helpers/storeFixtures');

describe('approxCounterpart', () => {
  test('USD -> BRL com ROUND: 103 centavos a 5,40 = 556', () => {
    expect(approxCounterpart(103, 'USD', 5.4)).toEqual({ currency: 'BRL', cents: 556 });
  });

  test('BRL -> USD com ROUND: 556 a 5,40 = 103', () => {
    expect(approxCounterpart(556, 'BRL', 5.4)).toEqual({ currency: 'USD', cents: 103 });
  });

  test('arredonda para o mais próximo, não para cima nem para baixo', () => {
    // 100 * 5.404 = 540.4 -> 540 ; 100 * 5.406 = 540.6 -> 541
    expect(approxCounterpart(100, 'USD', 5.404).cents).toBe(540);
    expect(approxCounterpart(100, 'USD', 5.406).cents).toBe(541);
    // 1 / 5.4 = 0.185 -> 0 ; 3 / 5.4 = 0.55 -> 1
    expect(approxCounterpart(1, 'BRL', 5.4).cents).toBe(0);
    expect(approxCounterpart(3, 'BRL', 5.4).cents).toBe(1);
  });

  test('é coerente com as funções de conversão em modo ROUND', () => {
    expect(approxCounterpart(777, 'USD', 5.37).cents).toBe(fromUsdCents(777, 'BRL', 5.37, 'ROUND'));
    expect(approxCounterpart(777, 'BRL', 5.37).cents).toBe(toUsdCents(777, 'BRL', 5.37, 'ROUND'));
  });

  test('valor 0 é válido (0 -> 0)', () => {
    expect(approxCounterpart(0, 'USD', 5.4)).toEqual({ currency: 'BRL', cents: 0 });
  });

  test.each([null, undefined, 0, -5.4, NaN, Infinity, 'abc', '5.4', {}])('cotação %p -> null', (rate) => {
    expect(approxCounterpart(103, 'USD', rate)).toBeNull();
    expect(approxCounterpart(103, 'BRL', rate)).toBeNull();
  });

  test.each([null, undefined, NaN, 1.5, '103', Infinity])('cents %p -> null', (cents) => {
    expect(approxCounterpart(cents, 'USD', 5.4)).toBeNull();
  });

  test('moeda desconhecida -> null', () => {
    expect(approxCounterpart(100, 'EUR', 5.4)).toBeNull();
  });
});

describe('pricingService: approx em minPriceForStore', () => {
  const call = (store, settings, cost = 100) =>
    minPriceForStore({ costCents: cost, costCurrency: 'USD', costFxRate: null, store, settings });

  test('loja USD com preço: approx em BRL', () => {
    const r = call(csfloat(), { usdBrlRate: 5.4 });
    expect(r.minPriceCents).toBe(103);
    expect(r.approx).toEqual({ currency: 'BRL', cents: 556 });
  });

  test('loja BRL com preço: approx em USD', () => {
    const r = call(steam(), { usdBrlRate: 5.4 });
    expect(r.minPriceCents).toEqual(expect.any(Number));
    expect(r.approx).toEqual({ currency: 'USD', cents: approxCounterpart(r.minPriceCents, 'BRL', 5.4).cents });
    expect(r.approx.currency).toBe('USD');
  });

  test('sem cotação: loja USD mantém o preço e approx null', () => {
    for (const settings of [{ usdBrlRate: null }, { usdBrlRate: 0 }, {}, null]) {
      const r = call(csfloat(), settings);
      expect(r.minPriceCents).toBe(103);
      expect(r.approx).toBeNull();
    }
  });

  test('sem preço (taxas não configuradas / cotação ausente na Steam): approx null e a chave existe', () => {
    const noFees = call(csmoney(), { usdBrlRate: 5.4 });
    expect(noFees.minPriceCents).toBeNull();
    expect(noFees).toHaveProperty('approx', null);
    const noRate = call(steam(), { usdBrlRate: null });
    expect(noRate.minPriceCents).toBeNull();
    expect(noRate).toHaveProperty('approx', null);
  });

  test('mudar a cotação muda só approx, não minPriceCents (loja USD)', () => {
    const a = call(csfloat(), { usdBrlRate: 5.0 });
    const b = call(csfloat(), { usdBrlRate: 6.0 });
    expect(a.minPriceCents).toBe(b.minPriceCents);
    expect(a.approx.cents).toBe(515);
    expect(b.approx.cents).toBe(618);
  });

  test('minPricesForItem: todas as entradas trazem a chave approx', () => {
    const list = minPricesForItem({
      item: { purchasePriceCents: 100, purchaseCurrency: 'USD', fxRateAtPurchase: null },
      stores: [csfloat(), steam(), csmoney()], settings: { usdBrlRate: 5.4 },
    });
    expect(list).toHaveLength(3);
    for (const m of list) expect(m).toHaveProperty('approx');
    expect(list.find((m) => m.storeName === 'CSFloat').approx).toEqual({ currency: 'BRL', cents: 556 });
    expect(list.find((m) => m.storeName === 'CSMoney').approx).toBeNull();
  });
});

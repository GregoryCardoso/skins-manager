'use strict';

// toUsdBase e approxBrlOf (8.5, D225): conversão para a moeda base (USD), com ROUND por parcela.
const { toUsdBase, approxBrlOf } = require('../../src/services/currencyService');

const RATE = 5.4321;

describe('toUsdBase', () => {
  test('zero: parcela 0, nunca nula nem estimada, com ou sem cotação e em qualquer moeda', () => {
    for (const currency of ['USD', 'BRL']) {
      for (const rate of [RATE, null, undefined, 0]) {
        expect(toUsdBase(0, currency, rate)).toEqual({ usdCents: 0, approxBrlCents: 0, estimated: false });
      }
    }
  });

  test('USD com cotação: exato, "≈ R$" com ROUND (12346 -> 67065; FLOOR daria 67064)', () => {
    expect(toUsdBase(12346, 'USD', RATE)).toEqual({ usdCents: 12346, approxBrlCents: 67065, estimated: false });
  });

  test('USD sem cotação: US$ exato e "≈ R$" nulo', () => {
    for (const rate of [null, undefined, 0, -1, NaN]) {
      expect(toUsdBase(12346, 'USD', rate)).toEqual({ usdCents: 12346, approxBrlCents: null, estimated: false });
    }
  });

  test('BRL com cotação: US$ convertido (ROUND) e estimado; "≈ R$" é o valor nativo', () => {
    expect(toUsdBase(4590, 'BRL', RATE)).toEqual({ usdCents: 845, approxBrlCents: 4590, estimated: true }); // 844,98
    expect(toUsdBase(30000, 'BRL', RATE)).toEqual({ usdCents: 5523, approxBrlCents: 30000, estimated: true }); // 5522,73
    expect(toUsdBase(10000, 'BRL', RATE)).toEqual({ usdCents: 1841, approxBrlCents: 10000, estimated: true }); // 1840,91
  });

  test('BRL sem cotação: US$ nulo, "≈ R$" nativo, estimado', () => {
    expect(toUsdBase(4590, 'BRL', null)).toEqual({ usdCents: null, approxBrlCents: 4590, estimated: true });
  });

  test('meio centavo arredonda para cima: 1 BRL a 2,0 -> 1 (0,5)', () => {
    expect(toUsdBase(1, 'BRL', 2).usdCents).toBe(1);
  });

  test('moeda inválida -> INVALID_CURRENCY', () => {
    expect(() => toUsdBase(100, 'EUR', RATE)).toThrow(expect.objectContaining({ code: 'INVALID_CURRENCY' }));
  });
});

describe('approxBrlOf', () => {
  test('ROUND sobre o total já somado (21859 -> 118740)', () => {
    expect(approxBrlOf(21859, RATE)).toBe(118740);
    expect(approxBrlOf(14723, RATE)).toBe(79977);
  });

  test('nulo sem valor ou sem cotação válida', () => {
    expect(approxBrlOf(null, RATE)).toBeNull();
    expect(approxBrlOf(undefined, RATE)).toBeNull();
    expect(approxBrlOf(100, null)).toBeNull();
    expect(approxBrlOf(100, 0)).toBeNull();
  });

  test('negativo arredonda afastando de zero e nunca devolve -0', () => {
    expect(approxBrlOf(-5, 0.5)).toBe(-3); // -2,5 -> -3
    expect(approxBrlOf(-21859, RATE)).toBe(-118740);
    expect(Object.is(approxBrlOf(-1, 0.1), -0)).toBe(false); // -0,1 -> 0
    expect(approxBrlOf(-1, 0.1)).toBe(0);
    expect(approxBrlOf(0, RATE)).toBe(0);
  });
});

'use strict';

const { toUsdCents, fromUsdCents, convertCents } = require('../../src/services/currencyService');
const { ValidationError } = require('../../src/errors/AppError');

describe('currencyService', () => {
  test('USD inalterado (mesmo sem cotação)', () => {
    expect(toUsdCents(1234, 'USD', null)).toBe(1234);
    expect(fromUsdCents(1234, 'USD', undefined)).toBe(1234);
  });

  test('BRL 5000 / 5.0 = 1000 USD', () => {
    expect(toUsdCents(5000, 'BRL', 5.0)).toBe(1000);
  });

  test('fromUsdCents 1000 × 5.0 = 5000 BRL', () => {
    expect(fromUsdCents(1000, 'BRL', 5.0)).toBe(5000);
  });

  test.each([null, undefined, 0, -5, NaN])('BRL sem cotação válida (%p) → ValidationError', (rate) => {
    expect(() => toUsdCents(5000, 'BRL', rate)).toThrow(ValidationError);
    expect(() => fromUsdCents(5000, 'BRL', rate)).toThrow(ValidationError);
  });

  test('moeda inválida → ValidationError', () => {
    expect(() => toUsdCents(100, 'XXX', 5)).toThrow(ValidationError);
  });

  test('convertCents na mesma moeda não converte (nem exige cotação)', () => {
    expect(convertCents(1234, 'BRL', 'BRL')).toBe(1234);
    expect(convertCents(1234, 'USD', 'USD', {})).toBe(1234);
  });

  test('convertCents BRL → USD e USD → BRL', () => {
    expect(convertCents(5000, 'BRL', 'USD', { fromFxRate: 5.0 })).toBe(1000);
    expect(convertCents(1000, 'USD', 'BRL', { toFxRate: 5.0 })).toBe(5000);
  });

  test('modos CEIL/FLOOR/ROUND em toUsdCents (1001 / 5 = 200.2)', () => {
    expect(toUsdCents(1001, 'BRL', 5, 'CEIL')).toBe(201);
    expect(toUsdCents(1001, 'BRL', 5, 'FLOOR')).toBe(200);
    expect(toUsdCents(1001, 'BRL', 5, 'ROUND')).toBe(200);
    expect(toUsdCents(1001, 'BRL', 5)).toBe(200); // padrão ROUND
  });

  test('modos CEIL/FLOOR/ROUND em fromUsdCents (101 × 5.55 = 560.55)', () => {
    expect(fromUsdCents(101, 'BRL', 5.55, 'CEIL')).toBe(561);
    expect(fromUsdCents(101, 'BRL', 5.55, 'FLOOR')).toBe(560);
    expect(fromUsdCents(101, 'BRL', 5.55, 'ROUND')).toBe(561);
  });

  test('convertCents respeita o modo (CEIL)', () => {
    expect(convertCents(1001, 'BRL', 'USD', { fromFxRate: 5 }, 'CEIL')).toBe(201);
  });
});

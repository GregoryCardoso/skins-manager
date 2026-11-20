'use strict';

const { applyRateRounding, roundCents } = require('../../../src/services/fees/rounding');
const { ValidationError } = require('../../../src/errors/AppError');

describe('fees/rounding — applyRateRounding (D34)', () => {
  test('0.07 × 100 CEIL = 7 (sem ruído de ponto flutuante)', () => {
    expect(0.07 * 100).not.toBe(7); // prova do ruído que a função evita
    expect(applyRateRounding(100, 0.07, 'CEIL')).toBe(7);
  });

  test('0.15 × 20 CEIL = 3', () => {
    expect(applyRateRounding(20, 0.15, 'CEIL')).toBe(3);
  });

  test('0.02 × 125: CEIL 3, ROUND 3 (meio para cima), FLOOR 2', () => {
    expect(applyRateRounding(125, 0.02, 'CEIL')).toBe(3);
    expect(applyRateRounding(125, 0.02, 'ROUND')).toBe(3);
    expect(applyRateRounding(125, 0.02, 'FLOOR')).toBe(2);
  });

  test('0.02 × 124 ROUND = 2', () => {
    expect(applyRateRounding(124, 0.02, 'ROUND')).toBe(2);
  });

  test('base 0 → 0 em todos os modos', () => {
    for (const mode of ['CEIL', 'ROUND', 'FLOOR']) expect(applyRateRounding(0, 0.02, mode)).toBe(0);
  });

  test.each([-1, 1.5, NaN, '100'])('base inválida (%p) → ValidationError', (base) => {
    expect(() => applyRateRounding(base, 0.02, 'CEIL')).toThrow(ValidationError);
  });

  test('modo inválido → ValidationError', () => {
    expect(() => applyRateRounding(100, 0.02, 'UP')).toThrow(ValidationError);
  });
});

describe('fees/rounding — roundCents (D34)', () => {
  test('roundCents(50999.999999999996, FLOOR) = 51000 (snap de ruído)', () => {
    expect(roundCents(50999.999999999996, 'FLOOR')).toBe(51000);
  });

  test('roundCents(-2.5, ROUND) = -3 (meio afastando de zero)', () => {
    expect(roundCents(-2.5, 'ROUND')).toBe(-3);
  });

  test('roundCents 2.5 ROUND = 3; CEIL/FLOOR de 2.1', () => {
    expect(roundCents(2.5, 'ROUND')).toBe(3);
    expect(roundCents(2.1, 'CEIL')).toBe(3);
    expect(roundCents(2.1, 'FLOOR')).toBe(2);
  });

  test('não devolve -0', () => {
    expect(Object.is(roundCents(-0.2, 'ROUND'), 0)).toBe(true);
  });
});

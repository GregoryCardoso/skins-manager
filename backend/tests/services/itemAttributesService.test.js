'use strict';

const {
  CATEGORIES,
  WEAPON_CATEGORIES,
  isWeaponCategory,
  deriveExterior,
  normalizeAttributes,
} = require('../../src/services/itemAttributesService');
const { ValidationError } = require('../../src/errors/AppError');

const code = (c) => expect.objectContaining({ name: 'ValidationError', code: c });

describe('itemAttributesService — constantes', () => {
  test('categorias e armas', () => {
    expect(CATEGORIES).toHaveLength(10);
    expect(WEAPON_CATEGORIES).toEqual(['SKIN', 'FACA', 'LUVA']);
    expect(isWeaponCategory('FACA')).toBe(true);
    expect(isWeaponCategory('CAIXA')).toBe(false);
  });
});

describe('itemAttributesService.deriveExterior', () => {
  test.each([
    [0, 'FN'],
    [0.0699, 'FN'],
    [0.07, 'MW'],
    [0.15, 'FT'],
    [0.38, 'WW'],
    [0.45, 'BS'],
    [1, 'BS'],
  ])('float %p → %s', (f, ext) => {
    expect(deriveExterior(f)).toBe(ext);
  });

  test('null/undefined → null', () => {
    expect(deriveExterior(null)).toBeNull();
    expect(deriveExterior(undefined)).toBeNull();
  });

  test.each([-0.01, 1.01, NaN, Infinity, '0.1'])('float inválido %p → ValidationError', (f) => {
    expect(() => deriveExterior(f)).toThrow(ValidationError);
  });
});

describe('itemAttributesService.normalizeAttributes', () => {
  test('exterior FN com float 0.10 → EXTERIOR_MISMATCH', () => {
    expect(() => normalizeAttributes({ category: 'SKIN', floatValue: 0.1, exterior: 'FN' })).toThrow(code('EXTERIOR_MISMATCH'));
  });

  test('exterior coerente com o float é aceito; ausente é derivado', () => {
    expect(normalizeAttributes({ category: 'SKIN', floatValue: 0.1, exterior: 'MW' }).exterior).toBe('MW');
    expect(normalizeAttributes({ category: 'SKIN', floatValue: 0.1 }).exterior).toBe('MW');
  });

  test('exterior manual sem float é aceito', () => {
    expect(normalizeAttributes({ category: 'SKIN', exterior: 'FT' })).toEqual({
      variant: 'NORMAL', floatValue: null, exterior: 'FT', paintSeed: null, phase: null,
    });
  });

  test('exterior fora do enum → erro', () => {
    expect(() => normalizeAttributes({ category: 'SKIN', exterior: 'XX' })).toThrow(ValidationError);
  });

  test('variant padrão NORMAL', () => {
    expect(normalizeAttributes({ category: 'SKIN' }).variant).toBe('NORMAL');
    expect(normalizeAttributes({ category: 'FACA', variant: null }).variant).toBe('NORMAL');
  });

  test('LUVA STATTRAK → erro; LUVA NORMAL ok', () => {
    expect(() => normalizeAttributes({ category: 'LUVA', variant: 'STATTRAK' })).toThrow(ValidationError);
    expect(normalizeAttributes({ category: 'LUVA', variant: 'NORMAL' }).variant).toBe('NORMAL');
  });

  test('FACA SOUVENIR → erro; FACA STATTRAK ok', () => {
    expect(() => normalizeAttributes({ category: 'FACA', variant: 'SOUVENIR' })).toThrow(ValidationError);
    expect(normalizeAttributes({ category: 'FACA', variant: 'STATTRAK' }).variant).toBe('STATTRAK');
  });

  test('variant inválida → erro', () => {
    expect(() => normalizeAttributes({ category: 'SKIN', variant: 'GOLD' })).toThrow(ValidationError);
  });

  test('categoria inválida → erro', () => {
    expect(() => normalizeAttributes({ category: 'ARMA' })).toThrow(ValidationError);
  });

  test.each([
    ['CAIXA com float', { category: 'CAIXA', floatValue: 0.1 }],
    ['STICKER com variant', { category: 'STICKER', variant: 'NORMAL' }],
    ['PERSONAGEM com paintSeed', { category: 'PERSONAGEM', paintSeed: 5 }],
    ['CAPSULA com exterior', { category: 'CAPSULA', exterior: 'FN' }],
    ['PINGENTE com phase', { category: 'PINGENTE', phase: 'Ruby' }],
  ])('P7: %s → ATTRIBUTES_NOT_ALLOWED', (_label, input) => {
    expect(() => normalizeAttributes(input)).toThrow(code('ATTRIBUTES_NOT_ALLOWED'));
  });

  test('CAIXA sem atributos (ou todos null) → todos null', () => {
    const allNull = { variant: null, floatValue: null, exterior: null, paintSeed: null, phase: null };
    expect(normalizeAttributes({ category: 'CAIXA' })).toEqual(allNull);
    expect(normalizeAttributes({ category: 'CAIXA', ...allNull })).toEqual(allNull);
  });

  test.each([-1, 1001, 1.5])('paintSeed %p → erro', (seed) => {
    expect(() => normalizeAttributes({ category: 'SKIN', paintSeed: seed })).toThrow(ValidationError);
  });

  test.each([0, 1000])('paintSeed %p aceito', (seed) => {
    expect(normalizeAttributes({ category: 'SKIN', paintSeed: seed }).paintSeed).toBe(seed);
  });

  test('phase "  " → null; phase com espaços é aparada', () => {
    expect(normalizeAttributes({ category: 'FACA', phase: '  ' }).phase).toBeNull();
    expect(normalizeAttributes({ category: 'FACA', phase: '  Doppler Phase 2 ' }).phase).toBe('Doppler Phase 2');
  });
});

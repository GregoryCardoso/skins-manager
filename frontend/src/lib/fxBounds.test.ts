import { describe, expect, test } from 'vitest';
import { boundsFor, boundsParams, formatBound, isOutOfBounds } from './fxBounds';

const MAP = { BRL: { min: 0.5, max: 100 }, IDR: { min: 1500, max: 1500000 } };

describe('boundsFor', () => {
  test('devolve a faixa da moeda; sem faixa, null (USD, moeda desconhecida, mapa ausente)', () => {
    expect(boundsFor(MAP, 'BRL')).toEqual({ min: 0.5, max: 100 });
    expect(boundsFor(MAP, 'USD')).toBeNull();
    expect(boundsFor(undefined, 'BRL')).toBeNull();
    expect(boundsFor(null, 'BRL')).toBeNull();
  });
  test('faixa malformada é ignorada', () => {
    expect(boundsFor({ BRL: { min: Number.NaN, max: 1 } }, 'BRL')).toBeNull();
  });
});

describe('formatBound e boundsParams', () => {
  test('no formato do idioma: vírgula em pt-BR, ponto em en, separador de milhar', () => {
    expect(formatBound(0.5, 'pt-BR')).toBe('0,5');
    expect(formatBound(0.5, 'en')).toBe('0.5');
    expect(formatBound(1500000, 'en')).toBe('1,500,000');
    expect(formatBound(1500000, 'de')).toBe('1.500.000');
  });
  test('boundsParams devolve min e max já formatados', () => {
    expect(boundsParams(MAP.BRL, 'pt-BR')).toEqual({ min: '0,5', max: '100' });
  });
});

describe('isOutOfBounds', () => {
  test('só compara: dentro (inclusive nos limites) e fora', () => {
    expect(isOutOfBounds(5, MAP.BRL)).toBe(false);
    expect(isOutOfBounds(0.5, MAP.BRL)).toBe(false);
    expect(isOutOfBounds(100, MAP.BRL)).toBe(false);
    expect(isOutOfBounds(0.49, MAP.BRL)).toBe(true);
    expect(isOutOfBounds(100.01, MAP.BRL)).toBe(true);
  });
  test('sem número ou sem faixa nunca avisa', () => {
    expect(isOutOfBounds(null, MAP.BRL)).toBe(false);
    expect(isOutOfBounds(9999, null)).toBe(false);
  });
});

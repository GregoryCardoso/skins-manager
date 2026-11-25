import { describe, expect, test } from 'vitest';
import { formatDecimalInput, parseDecimalInput, parseMoneyToCents, usesCommaDecimal } from './numberInput';

describe('separador decimal pelo Intl de cada idioma (D369)', () => {
  test.each(['pt-BR', 'es', 'ru', 'tr', 'fr', 'it', 'de', 'pl', 'uk'])('%s usa vírgula decimal: "1.234,56" e "5,4"', (language) => {
    expect(usesCommaDecimal(language)).toBe(true);
    expect(parseDecimalInput('1.234,56', language)).toBe(1234.56);
    expect(parseDecimalInput('5,4', language)).toBe(5.4);
  });

  test.each(['en', 'ja', 'ko', 'zh-CN'])('%s usa ponto decimal: "1,234.56", "5.4" e "5,4" sem ponto', (language) => {
    expect(usesCommaDecimal(language)).toBe(false);
    expect(parseDecimalInput('1,234.56', language)).toBe(1234.56);
    expect(parseDecimalInput('5.4', language)).toBe(5.4);
    expect(parseDecimalInput('5,4', language)).toBe(5.4);
  });

  test('espaço (inclusive o fino e o inseparável do francês e do russo) como milhar', () => {
    expect(parseDecimalInput('1 234,56', 'fr')).toBe(1234.56);
    expect(parseDecimalInput('1 234,56', 'ru')).toBe(1234.56);
    expect(parseMoneyToCents('1 234,56', 'de')).toBe(123456);
  });

  test('código desconhecido cai no formato do inglês (ponto)', () => {
    expect(usesCommaDecimal('xx')).toBe(false);
  });
});

describe('parseDecimalInput pt-BR', () => {
  test.each([
    ['5,40', 5.4], ['5.40', 5.4], ['5', 5], ['0,01', 0.01], ['1.234,56', 1234.56], ['  5,4  ', 5.4], ['5 , 4', 5.4], ['5,4123', 5.4123],
  ])('%p -> %p', (text, expected) => {
    expect(parseDecimalInput(text, 'pt-BR')).toBe(expected);
  });
});

describe('parseDecimalInput en', () => {
  test.each([
    ['5.40', 5.4], ['5,40', 5.4], ['1,234.56', 1234.56], ['7', 7], ['0.5', 0.5],
  ])('%p -> %p', (text, expected) => {
    expect(parseDecimalInput(text, 'en')).toBe(expected);
  });
});

describe('parseDecimalInput inválidos', () => {
  test.each(['abc', '', '   ', '0', '0,00', '-1', '-5,4', '5,4,3', '5..4', ',5', '5,', '1e3', 'Infinity', 'NaN', '5,4abc', '+5', '--1'])(
    '%p -> null', (text) => {
      expect(parseDecimalInput(text, 'pt-BR')).toBeNull();
      expect(parseDecimalInput(text, 'en')).toBeNull();
    },
  );
});

describe('formatDecimalInput', () => {
  test('formato do idioma, sem milhar', () => {
    expect(formatDecimalInput(5.4, 'pt-BR')).toBe('5,4');
    expect(formatDecimalInput(5.4, 'en')).toBe('5.4');
    expect(formatDecimalInput(1234.56, 'pt-BR')).toBe('1234,56');
  });

  test('ida e volta', () => {
    for (const lang of ['pt-BR', 'en']) expect(parseDecimalInput(formatDecimalInput(5.4123, lang), lang)).toBe(5.4123);
  });
});

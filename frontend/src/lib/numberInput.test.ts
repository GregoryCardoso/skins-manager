import { describe, expect, test } from 'vitest';
import { formatDecimalInput, parseDecimalInput } from './numberInput';

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

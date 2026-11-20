import { describe, expect, test } from 'vitest';
import { formatCentsInput, parseFloatInput, parseIntegerInput, parseMoneyToCents } from './numberInput';

describe('parseMoneyToCents', () => {
  test.each([
    ['1,25', 'pt-BR', 125], ['1.25', 'pt-BR', 125], ['1.25', 'en', 125], ['1,25', 'en', 125],
    ['1.234,56', 'pt-BR', 123456], ['1,234.56', 'en', 123456], ['0', 'pt-BR', 0], ['0,00', 'pt-BR', 0],
    ['5', 'pt-BR', 500], ['5,5', 'pt-BR', 550], ['  2,10 ', 'pt-BR', 210], ['0,01', 'pt-BR', 1],
  ])('%p (%s) -> %p', (text, lang, expected) => {
    expect(parseMoneyToCents(text, lang)).toBe(expected);
  });

  test.each(['0,005', '-1', 'abc', '', '1,2,3', '1,234', 'R$ 5', '1e3'])('%p é inválido em pt-BR', (text) => {
    expect(parseMoneyToCents(text, 'pt-BR')).toBeNull();
  });

  test('valor gigante fora do inteiro seguro é inválido', () => {
    expect(parseMoneyToCents('99999999999999999999', 'en')).toBeNull();
  });
});

describe('formatCentsInput', () => {
  test('sempre 2 casas, no formato do idioma, e ida e volta', () => {
    expect(formatCentsInput(125, 'pt-BR')).toBe('1,25');
    expect(formatCentsInput(125, 'en')).toBe('1.25');
    expect(formatCentsInput(100000, 'pt-BR')).toBe('1000,00');
    for (const cents of [0, 1, 99, 100, 12345]) {
      expect(parseMoneyToCents(formatCentsInput(cents, 'pt-BR'), 'pt-BR')).toBe(cents);
    }
  });
});

describe('parseFloatInput', () => {
  test.each([['0,0123', 'pt-BR', 0.0123], ['0.0123', 'en', 0.0123], ['0', 'pt-BR', 0], ['1', 'pt-BR', 1], ['0,123456789', 'pt-BR', 0.123456789]])(
    '%p (%s) -> %p',
    (text, lang, expected) => expect(parseFloatInput(text, lang)).toBe(expected),
  );
  test.each(['', 'abc', '-0,1', '0,1,2'])('%p é inválido', (text) => expect(parseFloatInput(text, 'pt-BR')).toBeNull());
});

describe('parseIntegerInput', () => {
  test('inteiros sem sinal', () => {
    expect(parseIntegerInput('0')).toBe(0);
    expect(parseIntegerInput(' 661 ')).toBe(661);
    for (const bad of ['', '-1', '1,5', '1.5', 'abc']) expect(parseIntegerInput(bad)).toBeNull();
  });
});

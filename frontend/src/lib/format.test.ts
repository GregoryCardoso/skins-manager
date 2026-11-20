import { describe, expect, test } from 'vitest';
import {
  formatApprox, formatDate, formatDateTime, formatFloat, formatInteger, formatMoney, formatRate, formatRemaining, remainingToText,
} from './format';
import { translatePlural } from '@/i18n/translate';
import ptBR from '@/i18n/pt-BR.json';
import en from '@/i18n/en.json';

// Intl usa espaço não separável entre símbolo e número.
const norm = (s: string) => s.replace(/[  ]/g, ' ');
const UNITS = { d: 'd', h: 'h', min: 'min' };

describe('formatMoney', () => {
  test('USD e BRL em pt-BR', () => {
    expect(norm(formatMoney(12345, 'USD', 'pt-BR'))).toBe('US$ 123,45');
    expect(norm(formatMoney(12345, 'BRL', 'pt-BR'))).toBe('R$ 123,45');
  });

  test('USD e BRL em en', () => {
    expect(norm(formatMoney(12345, 'USD', 'en'))).toBe('$123.45');
    expect(norm(formatMoney(12345, 'BRL', 'en'))).toMatch(/^R\$\s?123\.45$/);
  });

  test('zero e centavos únicos', () => {
    expect(norm(formatMoney(0, 'USD', 'pt-BR'))).toBe('US$ 0,00');
    expect(norm(formatMoney(3, 'USD', 'pt-BR'))).toBe('US$ 0,03');
    expect(norm(formatMoney(100, 'BRL', 'pt-BR'))).toBe('R$ 1,00');
  });

  test('milhar', () => {
    expect(norm(formatMoney(123456789, 'BRL', 'pt-BR'))).toBe('R$ 1.234.567,89');
    expect(norm(formatMoney(123456789, 'USD', 'en'))).toBe('$1,234,567.89');
  });
});

describe('formatApprox (sempre 2 casas, D104)', () => {
  test('USD 0,03 não vira "0"', () => {
    expect(norm(formatApprox({ currency: 'USD', cents: 3 }, 'pt-BR'))).toBe('US$ 0,03');
  });
  test('BRL 556 -> R$ 5,56', () => {
    expect(norm(formatApprox({ currency: 'BRL', cents: 556 }, 'pt-BR'))).toBe('R$ 5,56');
  });
  test('valor inteiro mantém 2 casas', () => {
    expect(norm(formatApprox({ currency: 'BRL', cents: 62400 }, 'pt-BR'))).toBe('R$ 624,00');
  });
});

describe('formatFloat (sem arredondar)', () => {
  test('mantém todas as casas gravadas', () => {
    expect(formatFloat(0.2134, 'pt-BR')).toBe('0,2134');
    expect(formatFloat(0.2134, 'en')).toBe('0.2134');
    expect(formatFloat(0.123456789012, 'pt-BR')).toBe('0,123456789012');
  });
  test('extremos e sem separador de milhar', () => {
    expect(formatFloat(0, 'pt-BR')).toBe('0');
    expect(formatFloat(1, 'en')).toBe('1');
    expect(formatFloat(0.07, 'en')).toBe('0.07');
  });
});

describe('formatRemaining (D39)', () => {
  test('60 000 ms = 1 min; 61 000 ms = 2 min (ceil)', () => {
    expect(formatRemaining(60_000)).toEqual({ d: 0, h: 0, min: 1 });
    expect(formatRemaining(61_000)).toEqual({ d: 0, h: 0, min: 2 });
  });

  test('nunca 0 min enquanto bloqueado', () => {
    expect(formatRemaining(1)).toEqual({ d: 0, h: 0, min: 1 });
    expect(formatRemaining(0)).toEqual({ d: 0, h: 0, min: 1 });
    expect(formatRemaining(-5000)).toEqual({ d: 0, h: 0, min: 1 });
    expect(formatRemaining(59_999)).toEqual({ d: 0, h: 0, min: 1 });
  });

  test('1 dia exato = 1d 0h 0min', () => {
    const parts = formatRemaining(86_400_000);
    expect(parts).toEqual({ d: 1, h: 0, min: 0 });
    expect(remainingToText(parts, UNITS)).toBe('1d 0h 0min');
  });

  test('3 h 5 min', () => {
    const parts = formatRemaining((3 * 60 + 5) * 60_000);
    expect(parts).toEqual({ d: 0, h: 3, min: 5 });
    expect(remainingToText(parts, UNITS)).toBe('3h 5min');
  });

  test('exemplo da especificação: 2d 14h 20min', () => {
    const ms = ((2 * 24 + 14) * 60 + 20) * 60_000;
    expect(remainingToText(formatRemaining(ms), UNITS)).toBe('2d 14h 20min');
  });

  test('omite só as unidades zeradas à esquerda', () => {
    expect(remainingToText(formatRemaining(12 * 60_000), UNITS)).toBe('12min');
    expect(remainingToText(formatRemaining(3 * 3_600_000), UNITS)).toBe('3h 0min');
    expect(remainingToText(formatRemaining(29 * 3_600_000), UNITS)).toBe('1d 5h 0min');
    expect(remainingToText(formatRemaining(6 * 86_400_000), UNITS)).toBe('6d 0h 0min');
  });

  test('unidades traduzíveis', () => {
    expect(remainingToText({ d: 1, h: 2, min: 3 }, { d: 'dia', h: 'hora', min: 'minuto' })).toBe('1dia 2hora 3minuto');
  });
});

describe('plural de dias (translatePlural)', () => {
  test('pt-BR', () => {
    expect(translatePlural(ptBR, 'common.dayCount', 1, 'pt-BR')).toBe('1 dia');
    expect(translatePlural(ptBR, 'common.dayCount', 2, 'pt-BR')).toBe('2 dias');
    expect(translatePlural(ptBR, 'common.dayCount', 22, 'pt-BR')).toBe('22 dias');
  });

  test('pt-BR: 0 segue a regra CLDR do idioma (Intl.PluralRules)', () => {
    const expected = new Intl.PluralRules('pt-BR').select(0) === 'one' ? '0 dia' : '0 dias';
    expect(translatePlural(ptBR, 'common.dayCount', 0, 'pt-BR')).toBe(expected);
  });

  test('en', () => {
    expect(translatePlural(en, 'common.dayCount', 1, 'en')).toBe('1 day');
    expect(translatePlural(en, 'common.dayCount', 0, 'en')).toBe('0 days');
    expect(translatePlural(en, 'common.dayCount', 8, 'en')).toBe('8 days');
  });
});

describe('outras formatações', () => {
  test('formatInteger', () => {
    expect(formatInteger(14780, 'pt-BR')).toBe('14.780');
    expect(formatInteger(14780, 'en')).toBe('14,780');
  });

  test('formatRate: 2 a 4 casas', () => {
    expect(norm(formatRate(5.4, 'pt-BR'))).toBe('R$ 5,40');
    expect(norm(formatRate(5.4123, 'pt-BR'))).toBe('R$ 5,4123');
  });

  test('formatDate / formatDateTime: data inválida devolve o texto original', () => {
    expect(formatDate('lixo', 'pt-BR')).toBe('lixo');
    expect(formatDateTime('lixo', 'pt-BR')).toBe('lixo');
    expect(formatDate('2026-11-19T15:00:00.000Z', 'pt-BR')).toMatch(/26/);
  });
});

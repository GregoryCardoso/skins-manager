import { describe, expect, test } from 'vitest';
import { moneyTexts } from './baseMoney';

// 8.5 (D225, D231): o "≈" no valor principal só aparece quando houve conversão; o "≈ R$" abaixo vem do backend.
describe('moneyTexts', () => {
  test('valor exato (estimated false): sem "≈" no principal, com o "≈ R$" abaixo', () => {
    expect(moneyTexts({ cents: 24196, estimated: false, approxCents: 131435, approxCurrency: 'BRL' }, 'pt-BR')).toEqual({
      main: expect.stringContaining('241,96'), mainEstimated: false, approx: expect.stringContaining('1.314,35'),
    });
  });

  test('valor estimado (estimated true): o principal ganha o "≈"', () => {
    const texts = moneyTexts({ cents: 21859, estimated: true, approxCents: 118740, approxCurrency: 'BRL' }, 'en');
    expect(texts.main).toBe('$218.59');
    expect(texts.mainEstimated).toBe(true);
    expect(texts.approx).toContain('1,187.40');
  });

  test('sem cotação: o "≈ R$" some e o valor exato segue', () => {
    expect(moneyTexts({ cents: 24196, estimated: false, approxCents: null }, 'pt-BR')).toMatchObject({ mainEstimated: false, approx: null });
    expect(moneyTexts({ cents: 100 }, 'pt-BR').approx).toBeNull();
  });

  test('valor indisponível (nulo): principal nulo, nunca "≈"', () => {
    expect(moneyTexts({ cents: null, estimated: true, approxCents: null }, 'pt-BR')).toEqual({ main: null, mainEstimated: false, approx: null });
  });

  test('loja em R$: principal em R$ e "≈ US$" abaixo', () => {
    const texts = moneyTexts({ cents: 4590, currency: 'BRL', approxCents: 845, approxCurrency: 'USD' }, 'en');
    expect(texts.main).toContain('45.90');
    expect(texts.approx).toBe('$8.45');
  });

  test('zero não é tratado como indisponível', () => {
    expect(moneyTexts({ cents: 0, approxCents: 0, approxCurrency: 'BRL' }, 'en')).toMatchObject({ main: '$0.00', approx: expect.stringContaining('0.00') });
  });
});

import { describe, expect, test } from 'vitest';
import {
  CURRENCIES, ZERO_DECIMAL_CURRENCIES, currencyLabel, currencyName, currencyOptions, currencySymbol, hasNoDecimals, isCurrencyCode,
} from './currencies';
import { formatApprox, formatMoney, formatRate } from './format';
import { moneyTexts, storeCounterpart } from './baseMoney';

// Intl usa espaço não separável entre símbolo e número.
const norm = (s: string) => s.replace(/[  ]/g, ' ');

describe('lista de moedas (11.3, D369)', () => {
  test('são as 17 moedas, USD primeiro e sem repetição', () => {
    expect(CURRENCIES).toHaveLength(17);
    expect(CURRENCIES[0]).toBe('USD');
    expect(new Set(CURRENCIES).size).toBe(17);
    expect([...CURRENCIES].sort()).toEqual(
      ['USD', 'BRL', 'EUR', 'RUB', 'TRY', 'CNY', 'PLN', 'UAH', 'JPY', 'KRW', 'GBP', 'KZT', 'CAD', 'AUD', 'MXN', 'ARS', 'CLP'].sort(),
    );
  });

  test('JPY, KRW e CLP não têm casas decimais; as outras 14 têm', () => {
    expect([...ZERO_DECIMAL_CURRENCIES].sort()).toEqual(['CLP', 'JPY', 'KRW']);
    for (const code of CURRENCIES) expect(hasNoDecimals(code)).toBe(['JPY', 'KRW', 'CLP'].includes(code));
  });

  test('isCurrencyCode só aceita as 17', () => {
    expect(isCurrencyCode('EUR')).toBe(true);
    expect(isCurrencyCode('CHF')).toBe(false);
    expect(isCurrencyCode('eur')).toBe(false);
    expect(isCurrencyCode(null)).toBe(false);
  });
});

describe('texto de cada moeda no seletor (código, símbolo e nome no idioma atual)', () => {
  test('o nome vem do Intl.DisplayNames no idioma da tela', () => {
    expect(currencyName('EUR', 'pt-BR').toLowerCase()).toBe('euro');
    expect(currencyName('BRL', 'en')).toBe('Brazilian Real');
    expect(currencyName('USD', 'pt-BR')).toMatch(/dólar/i);
  });

  test('o símbolo e o rótulo montam "código símbolo — nome"', () => {
    expect(currencySymbol('EUR', 'en')).toBe('€');
    expect(currencySymbol('BRL', 'pt-BR')).toBe('R$');
    expect(currencyLabel('EUR', 'pt-BR')).toMatch(/^EUR € — euro$/i);
    expect(currencyLabel('BRL', 'en')).toBe('BRL R$ — Brazilian Real');
  });

  test('símbolo igual ao código não se repete', () => {
    // CHF não é uma das 17, mas o Intl o conhece e o símbolo estreito é o próprio código.
    expect(currencyLabel('CHF', 'en').startsWith('CHF — ')).toBe(true);
  });

  test('moeda desconhecida pelo Intl cai no código, sem lançar erro', () => {
    expect(currencyName('XYZ', 'en')).toBe('XYZ');
    expect(currencySymbol('XYZ', 'en')).toBe('XYZ');
    expect(currencyLabel('XYZ', 'en')).toBe('XYZ');
    expect(currencyName('EUR', 'xx-invalid-locale-')).toBe('EUR');
  });

  test('as 17 opções saem na ordem da lista, cada uma com o código no começo do texto', () => {
    const options = currencyOptions('en');
    expect(options.map((o) => o.code)).toEqual([...CURRENCIES]);
    for (const option of options) {
      expect(option.label.startsWith(option.code)).toBe(true);
      expect(option.label).toContain('—');
    }
  });

  test('trocar o idioma muda o texto, nunca a lista de moedas', () => {
    const en = currencyOptions('en');
    const pt = currencyOptions('pt-BR');
    expect(pt.map((o) => o.code)).toEqual(en.map((o) => o.code));
    expect(pt.find((o) => o.code === 'GBP')?.label).not.toBe(en.find((o) => o.code === 'GBP')?.label);
  });
});

describe('formatMoney com as moedas sem casas decimais (JPY, KRW e CLP)', () => {
  test('JPY: 150000 centavos = ¥ 1.500, sem casas, em pt-BR e en', () => {
    expect(norm(formatMoney(150000, 'JPY', 'en'))).toMatch(/^[¥￥]1,500$/);
    expect(norm(formatMoney(150000, 'JPY', 'pt-BR'))).toBe('JP¥ 1.500');
  });

  test('KRW e CLP também saem inteiros', () => {
    expect(norm(formatMoney(138950000, 'KRW', 'en'))).toBe('₩1,389,500');
    expect(norm(formatMoney(95000000, 'CLP', 'en'))).toMatch(/^CLP\s?950,000$/);
    expect(formatMoney(95000000, 'CLP', 'pt-BR')).not.toMatch(/,\d\d$/);
  });

  test.each(['JPY', 'KRW', 'CLP'])('%s: nunca mostra centavos, mesmo com 0,50 da unidade', (code) => {
    expect(formatMoney(1050, code, 'en')).not.toMatch(/\.\d/);
    expect(formatMoney(1050, code, 'pt-BR')).not.toMatch(/,\d/);
  });

  test('as outras moedas continuam com 2 casas', () => {
    expect(norm(formatMoney(12345, 'EUR', 'pt-BR'))).toBe('€ 123,45');
    expect(norm(formatMoney(12345, 'GBP', 'en'))).toBe('£123.45');
    expect(norm(formatMoney(5, 'MXN', 'en'))).toBe('MX$0.05');
    expect(norm(formatMoney(0, 'ARS', 'en'))).toBe('ARS 0.00');
  });

  test('formatApprox usa a moeda recebida', () => {
    expect(norm(formatApprox({ currency: 'JPY', cents: 2250000 }, 'en'))).toBe('¥22,500');
    expect(norm(formatApprox({ currency: 'USD', cents: 3 }, 'pt-BR'))).toBe('US$ 0,03');
  });
});

describe('formatRate por moeda ("unidades da moeda por 1 US$")', () => {
  test('sem moeda, BRL (como antes)', () => {
    expect(norm(formatRate(5.4, 'pt-BR'))).toBe('R$ 5,40');
    expect(norm(formatRate(5.4123, 'pt-BR'))).toBe('R$ 5,4123');
  });

  test('outras moedas, de 2 a 4 casas, inclusive as sem casas na exibição de valores', () => {
    expect(norm(formatRate(151.2345, 'en', 'JPY'))).toBe('¥151.2345');
    expect(norm(formatRate(1389.5, 'en', 'KRW'))).toBe('₩1,389.50');
    expect(norm(formatRate(0.9142, 'pt-BR', 'EUR'))).toBe('€ 0,9142');
  });
});

describe('"≈" na moeda escolhida (moneyTexts)', () => {
  test('o "≈" sai na moeda que veio na resposta, com a formatação dela', () => {
    expect(moneyTexts({ cents: 10000, estimated: false, approxCents: 1500000, approxCurrency: 'JPY' }, 'en')).toMatchObject({ approx: '¥15,000' });
    expect(moneyTexts({ cents: 10000, approxCents: 9142, approxCurrency: 'EUR' }, 'pt-BR').approx).toContain('91,42');
    expect(moneyTexts({ cents: 10000, approxCents: 13895000, approxCurrency: 'KRW' }, 'en').approx).toBe('₩138,950');
  });

  test('com USD como moeda de conversão o backend manda null e nada aparece', () => {
    expect(moneyTexts({ cents: 10000, approxCents: null, approxCurrency: 'USD' }, 'en').approx).toBeNull();
  });

  test('sem a moeda da resposta, nunca se supõe uma (nada de BRL fixo)', () => {
    expect(moneyTexts({ cents: 10000, approxCents: 54000 }, 'pt-BR').approx).toBeNull();
    expect(moneyTexts({ cents: 10000, approxCents: 54000, approxCurrency: null }, 'pt-BR').approx).toBeNull();
  });
});

describe('storeCounterpart: o "≈" ao lado do saldo de uma loja (2.10)', () => {
  test('loja em US$: o "≈" é a moeda de conversão; sem valor, nada', () => {
    expect(storeCounterpart({ currency: 'USD', usdCents: 1000, approxCents: 5400, approxCurrency: 'BRL' })).toEqual({ currency: 'BRL', cents: 5400 });
    expect(storeCounterpart({ currency: 'USD', usdCents: 1000, approxCents: null, approxCurrency: 'USD' })).toBeNull();
    expect(storeCounterpart({ currency: 'USD', usdCents: 1000, approxCents: 5400, approxCurrency: undefined })).toBeNull();
  });

  test('loja em R$ com moeda de conversão BRL: "≈ US$" (igual a antes da 11.3)', () => {
    expect(storeCounterpart({ currency: 'BRL', usdCents: 185, approxCents: 1000, approxCurrency: 'BRL' })).toEqual({ currency: 'USD', cents: 185 });
  });

  test('loja em R$ com uma terceira moeda de conversão: o "≈" é nela', () => {
    expect(storeCounterpart({ currency: 'BRL', usdCents: 185, approxCents: 171, approxCurrency: 'EUR' })).toEqual({ currency: 'EUR', cents: 171 });
  });

  test('loja em R$ com US$ como moeda de conversão: "≈ US$"; sem cotação, nada', () => {
    expect(storeCounterpart({ currency: 'BRL', usdCents: 185, approxCents: null, approxCurrency: 'USD' })).toEqual({ currency: 'USD', cents: 185 });
    expect(storeCounterpart({ currency: 'BRL', usdCents: null, approxCents: null, approxCurrency: 'USD' })).toBeNull();
  });
});

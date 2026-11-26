'use strict';

// 11.2 (D369, Adendo 1): as 17 moedas, a unidade mínima, o "≈" na moeda de conversão (arredondado na unidade do destino) e o contexto
// `fx` ({ displayCurrency, rates }). Funções puras: nenhuma consulta ao banco nem à rede.
const {
  CURRENCIES, minorUnitCents, assertCurrency, normalizeFx, fxFromSettings, rateOf, displayCurrencyOf, approxOf, approxCounterpart,
  toUsdBase, toUsdCents, fromUsdCents, convertCents,
} = require('../../src/services/currencyService');
const { roundToUnit } = require('../../src/services/fees/rounding');

// As 42 moedas (17 da D369 + 25 da 11.11), na ordem de exibição: USD primeiro e as outras em ordem alfabética.
const ALL = [
  'USD', 'AED', 'ARS', 'AUD', 'BRL', 'CAD', 'CHF', 'CLP', 'CNY', 'COP', 'CRC', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS',
  'INR', 'JPY', 'KRW', 'KZT', 'MXN', 'MYR', 'NOK', 'NZD', 'PEN', 'PHP', 'PLN', 'QAR', 'RUB', 'SAR', 'SEK', 'SGD', 'THB', 'TRY',
  'TWD', 'UAH', 'UYU', 'VND', 'ZAR',
];
const ZERO = ['CLP', 'COP', 'CRC', 'HUF', 'IDR', 'JPY', 'KRW', 'TWD', 'VND'];
const fx = (displayCurrency, rates) => ({ displayCurrency, rates });

describe('as 42 moedas e a unidade mínima', () => {
  test('CURRENCIES tem exatamente as 42 moedas, na ordem de exibição (USD primeiro, as outras 41 em ordem alfabética)', () => {
    expect([...CURRENCIES]).toEqual(ALL);
    expect(CURRENCIES).toHaveLength(42);
    expect(CURRENCIES.slice(1)).toEqual([...CURRENCIES.slice(1)].sort());
  });

  test.each(ZERO)('%s não tem casas decimais: unidade mínima = 100 centavos', (currency) => {
    expect(minorUnitCents(currency)).toBe(100);
  });

  test.each(ALL.filter((c) => !ZERO.includes(c)))('%s tem 2 casas: unidade mínima = 1', (currency) => {
    expect(minorUnitCents(currency)).toBe(1);
  });

  test('a lista fixa bate com o Intl (maximumFractionDigits), salvo as moedas que a Steam e o uso comum mostram sem centavos', () => {
    // O ICU de cada versão do Node/Electron difere em TWD, CRC (e, em versões antigas, IDR, VND, COP e HUF): a lista fixa manda (11.11).
    const FORCED = ['IDR', 'VND', 'COP', 'CRC', 'HUF', 'TWD'];
    for (const currency of ALL) {
      const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
      if (FORCED.includes(currency)) expect(minorUnitCents(currency)).toBe(100);
      else expect(minorUnitCents(currency)).toBe(digits === 0 ? 100 : 1);
    }
    // As 3 originais continuam sem casas também no Intl.
    for (const currency of ['JPY', 'KRW', 'CLP']) {
      expect(new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits).toBe(0);
    }
  });

  test('moeda desconhecida ou em minúsculas -> INVALID_CURRENCY', () => {
    for (const bad of ['XXX', 'eur', '', undefined, null]) {
      expect(() => minorUnitCents(bad)).toThrow(expect.objectContaining({ code: 'INVALID_CURRENCY' }));
      expect(() => assertCurrency(bad)).toThrow(expect.objectContaining({ code: 'INVALID_CURRENCY' }));
    }
  });

  test.each(ALL)('%s converte USD <-> moeda e dá FX_RATE_REQUIRED sem cotação (exceto USD)', (currency) => {
    if (currency === 'USD') {
      expect(toUsdCents(123, 'USD', null)).toBe(123);
      return;
    }
    expect(() => toUsdCents(100, currency, null)).toThrow(expect.objectContaining({ code: 'FX_RATE_REQUIRED' }));
    expect(() => fromUsdCents(100, currency, 0)).toThrow(expect.objectContaining({ code: 'FX_RATE_REQUIRED' }));
    expect(toUsdCents(1000, currency, 2)).toBe(500);
  });
});

describe('arredondamento na unidade mínima', () => {
  test('roundToUnit com unidade 1 é o mesmo que roundCents', () => {
    expect(roundToUnit(2.5, 1, 'ROUND')).toBe(3);
    expect(roundToUnit(-2.5, 1, 'ROUND')).toBe(-3);
  });

  test('roundToUnit com 100 arredonda para o inteiro da moeda (em centavos) nos três modos', () => {
    expect(roundToUnit(15049, 100, 'ROUND')).toBe(15000);
    expect(roundToUnit(15050, 100, 'ROUND')).toBe(15100);
    expect(roundToUnit(15001, 100, 'CEIL')).toBe(15100);
    expect(roundToUnit(15099, 100, 'FLOOR')).toBe(15000);
    expect(Object.is(roundToUnit(-1, 100, 'ROUND'), -0)).toBe(false);
  });

  test('unidade inválida é recusada', () => {
    for (const unit of [0, -1, 1.5, NaN]) expect(() => roundToUnit(10, unit, 'ROUND')).toThrow();
  });

  test('fromUsdCents para JPY devolve múltiplo de 100 (US$ 1,00 a 159,172 = ¥ 159)', () => {
    expect(fromUsdCents(100, 'JPY', 159.172)).toBe(15900);
    expect(fromUsdCents(1234, 'KRW', 1347.22) % 100).toBe(0);
    expect(fromUsdCents(1234, 'CLP', 1041.53) % 100).toBe(0);
  });

  test('convertCents entre moedas passa pelo USD e arredonda na unidade do destino', () => {
    // 10000 centavos de EUR (€ 100) a 0,914 EUR/USD = US$ 109,40; em JPY a 159,172
    expect(convertCents(10000, 'EUR', 'JPY', { fromFxRate: 0.914, toFxRate: 159.172 })).toBe(1741500);
  });
});

describe('contexto fx', () => {
  test('número = cotação do BRL com a moeda de conversão BRL (legado); nulo = BRL sem cotação', () => {
    expect(normalizeFx(5.4)).toEqual({ displayCurrency: 'BRL', rates: { BRL: 5.4 } });
    expect(normalizeFx(null)).toEqual({ displayCurrency: 'BRL', rates: {} });
    expect(normalizeFx(undefined)).toEqual({ displayCurrency: 'BRL', rates: {} });
    expect(normalizeFx(0)).toEqual({ displayCurrency: 'BRL', rates: {} });
  });

  test('objeto vale como está; sem moeda de conversão assume USD', () => {
    expect(normalizeFx({ displayCurrency: 'EUR', rates: { EUR: 0.9 } })).toEqual({ displayCurrency: 'EUR', rates: { EUR: 0.9 } });
    expect(normalizeFx({ rates: {} })).toEqual({ displayCurrency: 'USD', rates: {} });
  });

  test('fxFromSettings usa rates/displayCurrency e cai no usdBrlRate legado', () => {
    expect(fxFromSettings({ displayCurrency: 'EUR', rates: { EUR: 0.9, BRL: 5 }, usdBrlRate: 99 })).toEqual({ displayCurrency: 'EUR', rates: { EUR: 0.9, BRL: 5 } });
    expect(fxFromSettings({ usdBrlRate: 5 })).toEqual({ displayCurrency: 'BRL', rates: { BRL: 5 } });
    expect(fxFromSettings({ usdBrlRate: null })).toEqual({ displayCurrency: 'BRL', rates: {} });
    expect(fxFromSettings(null)).toEqual({ displayCurrency: 'BRL', rates: {} });
  });

  test('rateOf: USD é 1; cotação inválida ou ausente é nula', () => {
    expect(rateOf(fx('EUR', { EUR: 0.9 }), 'USD')).toBe(1);
    expect(rateOf(fx('EUR', { EUR: 0.9 }), 'EUR')).toBe(0.9);
    expect(rateOf(fx('EUR', { EUR: 0 }), 'EUR')).toBeNull();
    expect(rateOf(fx('EUR', {}), 'BRL')).toBeNull();
    expect(displayCurrencyOf(fx('JPY', {}))).toBe('JPY');
  });
});

describe('approxCounterpart (regra do "≈", 4.2)', () => {
  const rates = { BRL: 5.4321, EUR: 0.914, JPY: 159.172 };

  test('com BRL: igual ao de antes (USD -> R$ e R$ -> US$)', () => {
    expect(approxCounterpart(9200, 'USD', fx('BRL', rates))).toEqual({ currency: 'BRL', cents: 49975 });
    expect(approxCounterpart(30000, 'BRL', fx('BRL', rates))).toEqual({ currency: 'USD', cents: 5523 });
    expect(approxCounterpart(9200, 'USD', 5.4321)).toEqual({ currency: 'BRL', cents: 49975 }); // legado: número
  });

  test('C diferente de D: mostra D (via USD, um só arredondamento)', () => {
    expect(approxCounterpart(10000, 'USD', fx('EUR', rates))).toEqual({ currency: 'EUR', cents: 9140 });
    // R$ 100,00 -> EUR: 10000 / 5,4321 * 0,914 = 1682,5...
    expect(approxCounterpart(10000, 'BRL', fx('EUR', rates))).toEqual({ currency: 'EUR', cents: Math.round((10000 / 5.4321) * 0.914) });
  });

  test('C igual a D (diferente de USD): mostra US$', () => {
    expect(approxCounterpart(9140, 'EUR', fx('EUR', rates))).toEqual({ currency: 'USD', cents: 10000 });
  });

  test('C = D = USD: nada', () => {
    expect(approxCounterpart(100, 'USD', fx('USD', rates))).toBeNull();
  });

  test('USD como moeda de conversão e valor em BRL: mostra "≈ US$"', () => {
    expect(approxCounterpart(5432, 'BRL', fx('USD', rates))).toEqual({ currency: 'USD', cents: 1000 });
  });

  test('sem cotação (da moeda do valor ou da de conversão) ou sem valor: nulo', () => {
    expect(approxCounterpart(100, 'USD', fx('EUR', {}))).toBeNull();
    expect(approxCounterpart(100, 'BRL', fx('EUR', { EUR: 0.9 }))).toBeNull();
    expect(approxCounterpart(100, 'BRL', fx('EUR', { BRL: 5 }))).toBeNull();
    expect(approxCounterpart(null, 'USD', fx('EUR', rates))).toBeNull();
    expect(approxCounterpart(1.5, 'USD', fx('EUR', rates))).toBeNull();
  });

  test('o "≈" é arredondado na unidade da moeda de destino: JPY, KRW e CLP em múltiplos de 100', () => {
    const jpy = approxCounterpart(10000, 'USD', fx('JPY', rates));
    expect(jpy).toEqual({ currency: 'JPY', cents: 1591700 });
    for (const [currency, rate] of [['KRW', 1347.22], ['CLP', 1041.53]]) {
      const r = approxCounterpart(12345, 'USD', fx(currency, { [currency]: rate }));
      expect(r.currency).toBe(currency);
      expect(r.cents % 100).toBe(0);
    }
    expect(approxCounterpart(12345, 'USD', fx('KRW', { KRW: 1347.22 })).cents).toBe(16631400); // 123,45 x 1347,22 = 166.314,3 -> ₩ 166.314
  });

  test('nunca devolve -0', () => {
    const r = approxCounterpart(-1, 'USD', fx('JPY', { JPY: 0.1 }));
    expect(Object.is(r.cents, -0)).toBe(false);
  });
});

describe('approxOf (total em USD)', () => {
  test('BRL: igual ao approxBrlOf de antes', () => {
    expect(approxOf(21859, fx('BRL', { BRL: 5.4321 }))).toBe(118740);
    expect(approxOf(14723, fx('BRL', { BRL: 5.4321 }))).toBe(79977);
  });

  test('USD como moeda de conversão: nulo (sem linha "≈")', () => {
    expect(approxOf(1000, fx('USD', { BRL: 5 }))).toBeNull();
  });

  test('sem cotação, sem valor ou valor inválido: nulo; negativo afasta do zero e nunca dá -0', () => {
    expect(approxOf(100, fx('EUR', {}))).toBeNull();
    expect(approxOf(null, fx('EUR', { EUR: 0.9 }))).toBeNull();
    expect(approxOf(undefined, fx('EUR', { EUR: 0.9 }))).toBeNull();
    expect(approxOf(-5, fx('BRL', { BRL: 0.5 }))).toBe(-3);
    expect(Object.is(approxOf(-1, fx('BRL', { BRL: 0.1 })), -0)).toBe(false);
  });

  test('JPY: múltiplo de 100', () => {
    expect(approxOf(1999, fx('JPY', { JPY: 159.172 })) % 100).toBe(0);
  });
});

describe('toUsdBase com a moeda de conversão', () => {
  const rates = { BRL: 5.4321, EUR: 0.914, JPY: 159.172 };

  test('moeda de conversão EUR: valor em USD vira "≈ EUR"; valor em BRL converte para USD (estimado) e "≈ EUR"', () => {
    expect(toUsdBase(10000, 'USD', fx('EUR', rates))).toEqual({ usdCents: 10000, approxCents: 9140, approxCurrency: 'EUR', estimated: false });
    const brl = toUsdBase(30000, 'BRL', fx('EUR', rates));
    expect(brl).toMatchObject({ usdCents: 5523, approxCurrency: 'EUR', estimated: true });
    expect(brl.approxCents).toBe(Math.round((30000 / 5.4321) * 0.914));
  });

  test('moeda de conversão USD: sem "≈" (nulo) em qualquer valor; o valor em BRL ainda vira US$ estimado', () => {
    expect(toUsdBase(10000, 'USD', fx('USD', rates))).toEqual({ usdCents: 10000, approxCents: null, approxCurrency: 'USD', estimated: false });
    expect(toUsdBase(30000, 'BRL', fx('USD', rates))).toEqual({ usdCents: 5523, approxCents: null, approxCurrency: 'USD', estimated: true });
  });

  test('moeda de conversão BRL e valor em BRL: o "≈" é o próprio valor nativo, mesmo sem cotação', () => {
    expect(toUsdBase(4590, 'BRL', fx('BRL', {}))).toEqual({ usdCents: null, approxCents: 4590, approxCurrency: 'BRL', estimated: true });
  });

  test('valor em BRL e moeda de conversão sem cotação: US$ calculado, "≈" nulo', () => {
    expect(toUsdBase(30000, 'BRL', fx('EUR', { BRL: 5.4321 }))).toEqual({ usdCents: 5523, approxCents: null, approxCurrency: 'EUR', estimated: true });
  });

  test('zero: parcela 0 (nunca nula nem estimada); "≈" 0 só quando há moeda de conversão', () => {
    expect(toUsdBase(0, 'BRL', fx('EUR', {}))).toEqual({ usdCents: 0, approxCents: 0, approxCurrency: 'EUR', estimated: false });
    expect(toUsdBase(0, 'USD', fx('USD', {}))).toEqual({ usdCents: 0, approxCents: null, approxCurrency: 'USD', estimated: false });
  });

  test('JPY como moeda de conversão: "≈" em múltiplo de 100', () => {
    expect(toUsdBase(12345, 'USD', fx('JPY', rates)).approxCents % 100).toBe(0);
  });
});

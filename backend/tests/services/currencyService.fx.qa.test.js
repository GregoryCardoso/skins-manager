'use strict';

// QA 11.2: bordas do "≈" (moedas sem casas decimais, negativos, zero, cotação ausente/inválida, uma única conversão via USD).
const {
  approxCounterpart, approxOf, toUsdBase, convertCents, fromUsdCents, minorUnitCents,
} = require('../../src/services/currencyService');

const fx = (displayCurrency, rates) => ({ displayCurrency, rates });
const NO_NAN = (value) => {
  if (value === null) return;
  expect(Number.isNaN(value)).toBe(false);
  expect(Number.isFinite(value)).toBe(true);
};

describe.each(['JPY', 'KRW', 'CLP'])('%s: inteiro, sem centavos', (currency) => {
  const rates = { [currency]: 149.5, BRL: 5 };

  test('minorUnitCents = 100 e todo "≈" é múltiplo de 100', () => {
    expect(minorUnitCents(currency)).toBe(100);
    for (const usd of [1, 49, 50, 99, 100, 101, 12345, 99999, 1234567]) {
      const approx = approxOf(usd, fx(currency, rates));
      expect(approx % 100).toBe(0);
      const viaBrl = approxCounterpart(usd * 5, 'BRL', fx(currency, rates));
      expect(viaBrl.cents % 100).toBe(0);
    }
  });

  test('arredonda para o inteiro mais próximo (metade afasta do zero)', () => {
    // 1,00 US$ a 149,5 = 149,5 -> 150 (15000 centavos)
    expect(approxOf(100, fx(currency, rates))).toBe(15000);
    // 0,01 US$ = 1,495 -> 1 (100)
    expect(approxOf(1, fx(currency, rates))).toBe(100);
    // 0,003... não é possível em centavos; 0 continua 0
    expect(approxOf(0, fx(currency, rates))).toBe(0);
  });

  test('negativos arredondam simetricamente, sem -0', () => {
    expect(approxOf(-100, fx(currency, rates))).toBe(-15000);
    expect(approxOf(-1, fx(currency, rates))).toBe(-100);
    const tiny = fx(currency, { [currency]: 0.1 });
    expect(Object.is(approxOf(-1, tiny), -0)).toBe(false);
    expect(approxOf(-1, tiny)).toBe(0);
    expect(Object.is(approxCounterpart(-1, 'USD', tiny).cents, -0)).toBe(false);
  });

  test('o valor nativo na moeda sem casas mostra "≈ US$" com centavos normais', () => {
    expect(approxCounterpart(14950 * 100, currency, fx(currency, rates))).toEqual({ currency: 'USD', cents: 10000 });
  });
});

describe('zero e negativo em moedas comuns', () => {
  const rates = { BRL: 5, EUR: 0.9 };
  test('zero devolve 0 (não nulo), e negativo mantém o sinal', () => {
    expect(approxCounterpart(0, 'USD', fx('BRL', rates))).toEqual({ currency: 'BRL', cents: 0 });
    expect(approxCounterpart(-250, 'USD', fx('BRL', rates))).toEqual({ currency: 'BRL', cents: -1250 });
    expect(approxCounterpart(-250, 'BRL', fx('BRL', rates))).toEqual({ currency: 'USD', cents: -50 });
    expect(approxOf(-250, fx('EUR', rates))).toBe(-225);
  });
  test('metade arredonda afastando do zero nos dois sinais', () => {
    expect(approxOf(5, fx('EUR', { EUR: 0.5 }))).toBe(3); // 2,5 -> 3
    expect(approxOf(-5, fx('EUR', { EUR: 0.5 }))).toBe(-3);
  });
});

describe('cotação ausente ou inválida: nulo, sem lançar e sem NaN', () => {
  const bad = [undefined, null, 0, -1, NaN, Infinity, '5', {}];
  test.each(bad)('cotação da moeda de conversão = %p', (rate) => {
    const ctx = fx('EUR', { EUR: rate, BRL: 5 });
    expect(() => approxOf(100, ctx)).not.toThrow();
    expect(approxOf(100, ctx)).toBeNull();
    expect(approxCounterpart(100, 'USD', ctx)).toBeNull();
    expect(approxCounterpart(100, 'BRL', ctx)).toBeNull();
    const base = toUsdBase(500, 'BRL', ctx);
    expect(base.approxCents).toBeNull();
    expect(base.usdCents).toBe(100);
    NO_NAN(base.usdCents);
  });
  test.each(bad)('cotação da moeda do valor = %p: US$ nulo, "≈" nulo', (rate) => {
    const ctx = fx('EUR', { EUR: 0.9, BRL: rate });
    expect(approxCounterpart(100, 'BRL', ctx)).toBeNull();
    const base = toUsdBase(500, 'BRL', ctx);
    expect(base.usdCents).toBeNull();
    expect(base.approxCents).toBeNull();
  });
  test('contexto vazio, nulo e indefinido não lançam', () => {
    for (const ctx of [null, undefined, {}, fx('EUR', undefined)]) {
      expect(() => approxOf(100, ctx)).not.toThrow();
      expect(() => approxCounterpart(100, 'USD', ctx)).not.toThrow();
      expect(() => toUsdBase(100, 'USD', ctx)).not.toThrow();
    }
  });
  test('entradas não inteiras ou não numéricas dão nulo, nunca NaN', () => {
    const ctx = fx('EUR', { EUR: 0.9 });
    for (const v of [NaN, Infinity, 1.5, '100', null, undefined]) {
      expect(approxOf(v, ctx)).toBeNull();
      expect(approxCounterpart(v, 'USD', ctx)).toBeNull();
    }
  });
});

describe('uma única conversão via USD (BRL -> EUR)', () => {
  test('não arredonda o USD intermediário: o resultado bate com a conta direta', () => {
    const ctx = fx('EUR', { BRL: 5.43, EUR: 0.914 });
    // 1 centavo de BRL = 0,18416 centavo de USD; a conta direta com um só arredondamento
    for (const cents of [1, 3, 7, 99, 543, 10001, 987654]) {
      const expected = Math.round((cents / 5.43) * 0.914);
      expect(approxCounterpart(cents, 'BRL', ctx)).toEqual({ currency: 'EUR', cents: expected });
    }
    // dois arredondamentos dariam outro resultado em algum destes casos; o valor aqui prova que o intermediário não é arredondado
    const twoStep = (cents) => Math.round(Math.round(cents / 5.43) * 0.914);
    const diffs = [1, 3, 7, 99, 543, 10001, 987654].filter((c) => twoStep(c) !== Math.round((c / 5.43) * 0.914));
    expect(diffs.length).toBeGreaterThan(0);
  });
  test('toUsdBase: o "≈" em EUR de um valor em BRL não depende do USD arredondado', () => {
    const ctx = fx('EUR', { BRL: 5.43, EUR: 0.914 });
    const base = toUsdBase(7, 'BRL', ctx);
    expect(base.approxCents).toBe(Math.round((7 / 5.43) * 0.914));
    expect(base.usdCents).toBe(Math.round(7 / 5.43));
  });
  test('convertCents (pública) entre duas moedas sem casas decimais', () => {
    expect(convertCents(15900, 'JPY', 'KRW', { fromFxRate: 159, toFxRate: 1350 })).toBe(135000);
    expect(fromUsdCents(100, 'KRW', 1349.2)).toBe(134900);
  });
});

describe('moeda de conversão BRL: igual ao comportamento anterior', () => {
  const ctx = fx('BRL', { BRL: 5.4321 });
  test('USD -> R$ e R$ -> US$ batem com a fórmula antiga (round(c * rate), round(c / rate))', () => {
    for (const c of [0, 1, 99, 100, 12345, 99999, -100, -1]) {
      const old = (c === 0 ? 0 : Math.sign(c) * Math.round(Math.abs(c) * 5.4321)) || 0;
      expect(approxCounterpart(c, 'USD', ctx)).toEqual({ currency: 'BRL', cents: old });
      expect(approxOf(c, ctx)).toBe(old);
      const back = (c === 0 ? 0 : Math.sign(c) * Math.round(Math.abs(c) / 5.4321)) || 0;
      expect(approxCounterpart(c, 'BRL', ctx)).toEqual({ currency: 'USD', cents: back });
    }
  });
  test('número legado como contexto equivale ao objeto BRL', () => {
    expect(approxCounterpart(1000, 'USD', 5.4321)).toEqual(approxCounterpart(1000, 'USD', ctx));
  });
});

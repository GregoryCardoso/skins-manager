'use strict';

// 11.11 (complemento): teto de valor por moeda (mesmo valor em dólar para todas) e segurança numérica dos cálculos no teto.
// Puros: sem banco, sem rede.
const {
  CURRENCIES, ZERO_DECIMAL_CURRENCIES, FX_MANUAL_RATE_BOUNDS, MAX_AMOUNT_CENTS_BY_CURRENCY, MAX_ANY_AMOUNT_CENTS, maxAmountCents,
} = require('../../src/config/constants');
const { buildStoreRecord } = require('../../src/services/storeService');
const { buildWithdrawalRecord } = require('../../src/services/withdrawalService');
const { buildDepositRecord } = require('../../src/services/depositService');
const { applyRateRounding } = require('../../src/services/fees/rounding');
const { splitPool } = require('../../src/services/operations/costService');
const { findMinSalePriceCents, computeSale, minPriceForStore } = require('../../src/services/pricingService');
const { toUsdCents, fromUsdCents, convertCents, toUsdBase } = require('../../src/services/currencyService');
const { computeRealProfit } = require('../../src/services/profitService');
const { getSaleFeeStrategy, saleFeeParamsFromStore } = require('../../src/services/fees');
const { csfloat } = require('../helpers/storeFixtures');

const NOW = new Date('2026-11-26T15:00:00.000Z');
const unitOf = (currency) => (ZERO_DECIMAL_CURRENCIES.includes(currency) ? 100 : 1);
const geometricMean = (code) => (code === 'USD' ? 1 : Math.sqrt(FX_MANUAL_RATE_BOUNDS[code].min * FX_MANUAL_RATE_BOUNDS[code].max));
const codeOf = (fn) => { try { fn(); } catch (err) { return { code: err.code, field: err.field, params: err.params }; } return null; };

// Divisão inteira exata em BigInt, arredondando meio para cima (valores >= 0): a referência dos cálculos abaixo.
const roundDiv = (num, den) => Number((BigInt(num) * 2n + BigInt(den)) / (2n * BigInt(den)));

const SAMPLE = ['USD', 'BRL', 'EUR', 'JPY', 'KRW', 'IDR', 'VND', 'COP'];

describe('tabela do teto por moeda', () => {
  test('valores literais das moedas de referência', () => {
    expect(maxAmountCents('USD')).toBe(1e10);
    expect(maxAmountCents('BRL')).toBe(1e10);
    expect(maxAmountCents('EUR')).toBe(1e10);
    expect(maxAmountCents('JPY')).toBe(2e11);
    expect(maxAmountCents('KRW')).toBe(2e12);
    expect(maxAmountCents('IDR')).toBe(2e13);
    expect(maxAmountCents('VND')).toBe(5e13);
    expect(maxAmountCents('COP')).toBe(5e12);
  });

  test('uma entrada por moeda, tabela congelada, moeda desconhecida usa o maior teto (inclusive nomes herdados do Object)', () => {
    expect(Object.keys(MAX_AMOUNT_CENTS_BY_CURRENCY)).toEqual([...CURRENCIES]);
    expect(Object.isFrozen(MAX_AMOUNT_CENTS_BY_CURRENCY)).toBe(true);
    expect(MAX_ANY_AMOUNT_CENTS).toBe(Math.max(...Object.values(MAX_AMOUNT_CENTS_BY_CURRENCY)));
    for (const unknown of ['XXX', undefined, null, 'constructor', '__proto__', 'toString']) expect(maxAmountCents(unknown)).toBe(MAX_ANY_AMOUNT_CENTS);
  });

  test('nunca abaixo do teto antigo (1e10), sempre múltiplo da unidade mínima e equivalente a pelo menos US$ 10 milhões', () => {
    for (const code of CURRENCIES) {
      const cap = maxAmountCents(code);
      expect(cap).toBeGreaterThanOrEqual(1e10);
      expect(cap % (unitOf(code) * 100)).toBe(0); // inteiro de unidades inteiras também nas moedas sem casas
      // equivalente em dólar na cotação de referência (média geométrica da faixa manual): >= US$ 11 milhões
      const usd = cap / 100 / geometricMean(code);
      expect(usd).toBeGreaterThanOrEqual(11e6);
      // ... e a folga de 10% na cotação ainda deixa US$ 10 milhões
      expect(cap / 100 / (geometricMean(code) * 1.1)).toBeGreaterThanOrEqual(10e6);
    }
  });

  test('moedas fortes ficam no teto antigo', () => {
    for (const code of ['USD', 'EUR', 'GBP', 'CHF', 'CAD', 'AUD', 'SGD', 'PLN', 'BRL', 'CNY']) expect(maxAmountCents(code)).toBe(1e10);
  });
});

describe.each(SAMPLE)('%s: o teto é aceito e teto + 1 unidade é recusado', (currency) => {
  const cap = maxAmountCents(currency);
  const over = cap + unitOf(currency);

  test('taxa fixa e mínima da loja', () => {
    const base = { name: 'Loja', currency, saleFeeType: 'DEDUCTED', saleFeeRate: 0.02 };
    for (const field of ['saleFixedFeeCents', 'saleMinFeeCents', 'withdrawalFixedFeeCents']) {
      expect(buildStoreRecord({ ...base, [field]: cap })[field]).toBe(cap);
      expect(codeOf(() => buildStoreRecord({ ...base, [field]: over }))).toMatchObject({
        code: 'INVALID_AMOUNT', field, params: { maxCents: cap, currency },
      });
    }
  });

  test('valor sacado e valor recebido (moeda própria)', () => {
    const store = csfloat({ currency });
    const input = { storeId: 1, amountStoreCents: cap, withdrawnAt: '2026-11-10T12:00:00.000Z' };
    expect(buildWithdrawalRecord(input, { store, now: NOW }).amountStoreCents).toBe(cap);
    expect(codeOf(() => buildWithdrawalRecord({ ...input, amountStoreCents: over }, { store, now: NOW }))).toMatchObject({
      code: 'INVALID_AMOUNT', field: 'amountStoreCents', params: { maxCents: cap, currency },
    });
    const received = { ...input, amountStoreCents: 100, amountBrlCurrency: currency };
    expect(buildWithdrawalRecord({ ...received, amountBrlCents: cap }, { store, now: NOW }).amountBrlCents).toBe(cap);
    expect(codeOf(() => buildWithdrawalRecord({ ...received, amountBrlCents: over }, { store, now: NOW }))).toMatchObject({
      code: 'INVALID_AMOUNT', field: 'amountBrlCents', params: { maxCents: cap, currency },
    });
  });

  test('valor pago do aporte (moeda própria)', () => {
    const store = csfloat({ currency: 'USD' });
    const input = { storeId: 1, amountStoreCents: 100, amountBrlCurrency: currency, depositedAt: '2026-11-10T12:00:00.000Z' };
    expect(buildDepositRecord({ ...input, amountBrlCents: cap }, { store, now: NOW }).amountBrlCents).toBe(cap);
    expect(codeOf(() => buildDepositRecord({ ...input, amountBrlCents: over }, { store, now: NOW }))).toMatchObject({
      code: 'INVALID_AMOUNT', field: 'amountBrlCents', params: { maxCents: cap, currency },
    });
  });
});

describe('aporte em USD: o teto é o do dólar', () => {
  test('1e10 aceito e 1e10 + 1 recusado, na taxa e no valor creditado', () => {
    const store = csfloat({ currency: 'USD' });
    const input = { storeId: 1, amountStoreCents: 1e10, depositedAt: '2026-11-10T12:00:00.000Z' };
    expect(buildDepositRecord(input, { store, now: NOW }).amountStoreCents).toBe(1e10);
    expect(codeOf(() => buildDepositRecord({ ...input, amountStoreCents: 1e10 + 1 }, { store, now: NOW }))).toMatchObject({ code: 'INVALID_AMOUNT', params: { maxCents: 1e10, currency: 'USD' } });
    expect(codeOf(() => buildDepositRecord({ ...input, feeCents: 1e10 + 1 }, { store, now: NOW }))).toMatchObject({ code: 'INVALID_FEE', params: { maxCents: 1e10, currency: 'USD' } });
    expect(buildDepositRecord({ ...input, feeCents: 1e10 }, { store, now: NOW }).feeCents).toBe(1e10);
  });
});

// Lojas com taxa pesada no teto: VND (5e13) e IDR (2e13), as maiores da tabela.
describe.each([['VND', 26000], ['IDR', 16500]])('%s: cálculos no teto sem perda de precisão (taxa por moeda %s)', (currency, rate) => {
  const cap = maxAmountCents(currency);
  const store = (overrides) => csfloat({ currency, saleFeeType: 'DEDUCTED', saleFeeRate: 0.15, saleFeeRounding: 'CEIL', saleFixedFeeCents: 0, ...overrides });

  test('taxa percentual: base x taxa em BigInt, igual ao cálculo exato, em todos os arredondamentos', () => {
    for (const unit of [1, 100]) {
      for (const [mode, expected] of [
        ['FLOOR', (n, d) => Number(BigInt(n) / BigInt(d))],
        ['CEIL', (n, d) => Number((BigInt(n) + BigInt(d) - 1n) / BigInt(d))],
        ['ROUND', (n, d) => roundDiv(n, d)],
      ]) {
        for (const base of [cap, cap - 1, cap - 7777, 49999999999999]) {
          // taxa de 15,5555% = 155555 ppm: base x ppm / (1e6 x unit) x unit
          const exact = expected(BigInt(base) * 155555n, 1000000n * BigInt(unit)) * unit;
          expect(applyRateRounding(base, 0.155555, mode, unit)).toBe(exact);
        }
      }
    }
  });

  test('DEDUCTED: líquido e taxa da venda no teto (fee + net = preço, taxa de 15%, unidade da moeda)', () => {
    const sale = computeSale({ salePriceCents: cap, store: store() });
    expect(sale.feeCents).toBe(cap * 0.15); // 7,5e12 / 3e12: exato, múltiplo de 100
    expect(sale.netReceivedCents).toBe(cap - sale.feeCents);
    expect(sale.feeCents + sale.netReceivedCents).toBe(cap);
  });

  test('ADDED: o preço no teto devolve o maior líquido cujo preço do comprador cabe nele', () => {
    const params = saleFeeParamsFromStore(store({ saleFeeType: 'ADDED' }));
    const strategy = getSaleFeeStrategy('ADDED');
    const net = strategy.net(cap, params);
    expect(strategy.net(cap, params) + strategy.fee(net, params)).toBeLessThanOrEqual(cap);
    expect(net + params.unitCents + strategy.fee(net + params.unitCents, params)).toBeGreaterThan(cap);
    expect(Number.isSafeInteger(net)).toBe(true);
  });

  test.each(['DEDUCTED', 'ADDED'])('%s: preço mínimo para um custo no teto é o menor cujo líquido cobre o custo', (feeType) => {
    const params = saleFeeParamsFromStore(store({ saleFeeType: feeType }));
    const strategy = getSaleFeeStrategy(feeType);
    const cost = cap;
    const min = findMinSalePriceCents(cost, params);
    expect(strategy.net(min, params)).toBeGreaterThanOrEqual(cost);
    expect(strategy.net(min - params.unitCents, params)).toBeLessThan(cost);
    expect(min % params.unitCents).toBe(0);
  });

  test('preço mínimo de um item em USD no teto em uma loja da moeda, pela cotação das configurações', () => {
    const settings = { displayCurrency: 'USD', rates: { [currency]: rate } };
    const result = minPriceForStore({ costCents: 1e10, costCurrency: 'USD', costFxRate: null, store: store(), settings });
    expect(result.warningCode).toBeNull();
    const costNative = fromUsdCents(1e10, currency, rate, 'CEIL');
    expect(costNative).toBe(Math.ceil((1e10 * rate) / 100) * 100); // 2,6e14 (VND): exato, múltiplo de 100
    expect(getSaleFeeStrategy('DEDUCTED').net(result.minPriceCents, saleFeeParamsFromStore(store()))).toBeGreaterThanOrEqual(costNative);
  });

  test('conversão do teto para USD e de volta, e para a moeda de conversão, bate com a conta exata', () => {
    const usd = toUsdCents(cap, currency, rate);
    expect(usd).toBe(roundDiv(cap, rate));
    expect(fromUsdCents(usd, currency, rate)).toBe(Math.round((usd * rate) / 100) * 100);
    // para outra moeda de conversão (BRL 5,5; EUR 0,86; USD)
    const fx = { displayCurrency: 'BRL', rates: { [currency]: rate, BRL: 5.5 } };
    const base = toUsdBase(cap, currency, fx);
    expect(base.usdCents).toBe(usd);
    expect(base.approxCents).toBe(Math.round(((cap / rate) * 5.5)));
    expect(convertCents(cap, currency, 'EUR', { fromFxRate: rate, toFxRate: 0.86 })).toBe(Math.round((cap / rate) * 0.86));
  });

  test('lucro real com 5 itens no teto, saques e aportes: soma exata em USD', () => {
    const item = (id) => ({
      id, status: 'EM_ESTOQUE', acquisitionType: 'COMPRA', purchaseStoreId: 9, purchasePriceCents: cap, purchaseCurrency: currency,
      fxRateAtPurchase: rate, offSaleAt: null,
    });
    const nativeStore = store({ id: 9, currency });
    const settings = { displayCurrency: 'USD', rates: { [currency]: rate } };
    const withdrawals = [{ id: 1, storeId: 9, amountStoreCents: cap, feeCents: 0, withdrawnAt: '2026-11-01T12:00:00.000Z' }];
    const result = computeRealProfit({
      stockItems: [1, 2, 3, 4, 5].map(item), stores: [nativeStore], withdrawals, settings, balances: { stores: [] },
    });
    const unit = roundDiv(cap, rate);
    expect(result.stockUsdCents).toBe(unit * 5);
    expect(result.withdrawalsNetUsdCents).toBe(unit);
    expect(result.realProfitUsdCents).toBe(unit * 5 + unit);
  });

  test('divisão do custo por pontos-base no teto (BigInt): sem perda do último centavo', () => {
    const pool = 49999999999999;
    const shares = [{ id: 1, bp: 1234 }, { id: 2, bp: 8766 }];
    const out = splitPool(pool, shares);
    const first = Number((BigInt(pool) * 1234n) / 10000n);
    const second = Number((BigInt(pool) * 8766n) / 10000n);
    // o que sobra do piso vai para a maior fração (id 2)
    expect(out.get(1)).toBe(first);
    expect(out.get(2)).toBe(second + (pool - first - second));
    expect(out.get(1) + out.get(2)).toBe(pool);
  });
});

describe('análise numérica: nenhum produto intermediário passa de Number.MAX_SAFE_INTEGER nas cotações de referência', () => {
  test('teto de qualquer moeda convertido para qualquer outra pela média geométrica das cotações fica abaixo do inteiro seguro', () => {
    let worst = 0;
    for (const from of CURRENCIES) {
      for (const to of CURRENCIES) {
        if (from === to) continue;
        const converted = (maxAmountCents(from) / geometricMean(from)) * geometricMean(to);
        worst = Math.max(worst, converted);
      }
    }
    expect(worst).toBeLessThan(Number.MAX_SAFE_INTEGER / 10); // folga de 10x (a pior combinação é CHF -> VND, ~2,9e14)
  });

  test('cotações 30% piores para cada lado continuam abaixo do inteiro seguro', () => {
    for (const from of CURRENCIES) {
      for (const to of CURRENCIES) {
        if (from === to) continue;
        const converted = (maxAmountCents(from) / (geometricMean(from) / 1.3)) * (geometricMean(to) * 1.3);
        expect(converted).toBeLessThan(Number.MAX_SAFE_INTEGER);
      }
    }
  });

  test('o produto base x ppm (a causa do estouro em Number) passa do inteiro seguro e o cálculo em BigInt resolve', () => {
    expect(maxAmountCents('VND') * 150000).toBeGreaterThan(Number.MAX_SAFE_INTEGER); // 7,5e18
    expect(applyRateRounding(maxAmountCents('VND'), 0.15, 'CEIL', 100)).toBe(7.5e12);
  });
});

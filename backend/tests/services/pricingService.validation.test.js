'use strict';

// I2 (D45): pricingService rejeita parâmetros de taxa inválidos sem travar; limite de iterações.
const { findMinSalePriceCents, computeSale, minPriceForStore } = require('../../src/services/pricingService');
const { saleFeeParamsFromStore } = require('../../src/services/fees');
const deducted = require('../../src/services/fees/deductedSaleFee');
const { MAX_PRICE_SEARCH_ITERATIONS } = require('../../src/services/fees/saleFeeFormula');
const { ValidationError } = require('../../src/errors/AppError');
const { CSF, STEAM_PARAMS, csfloat, steam, csmoney } = require('../helpers/storeFixtures');

function expectCode(fn, code) {
  let caught;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ValidationError);
  expect(caught.code).toBe(code);
}

const BAD_RATES = [
  ['taxa = 1', 1],
  ['taxa > 1', 1.5],
  ['taxa negativa', -0.01],
];
const BASES = [
  ['DEDUCTED', CSF],
  ['ADDED', STEAM_PARAMS],
];

describe('findMinSalePriceCents com taxa inválida → INVALID_FEE_PARAMS (sem travar)', () => {
  describe.each(BASES)('%s', (_type, base) => {
    test.each(BAD_RATES)('%s', (_name, rate) => {
      const started = Date.now();
      expectCode(() => findMinSalePriceCents(100, { ...base, rate }), 'INVALID_FEE_PARAMS');
      expectCode(() => findMinSalePriceCents(0, { ...base, rate }), 'INVALID_FEE_PARAMS');
      expect(Date.now() - started).toBeLessThan(1000);
    }, 2000);
  });
});

describe('computeSale com loja de taxa inválida → INVALID_FEE_PARAMS', () => {
  test.each(BAD_RATES)('DEDUCTED (CSFloat): %s', (_name, rate) => {
    expectCode(() => computeSale({ salePriceCents: 125, store: csfloat({ saleFeeRate: rate }) }), 'INVALID_FEE_PARAMS');
  }, 2000);

  test.each(BAD_RATES)('ADDED (Steam): %s', (_name, rate) => {
    expectCode(() => computeSale({ salePriceCents: 115, store: steam({ saleFeeRate: rate }) }), 'INVALID_FEE_PARAMS');
  }, 2000);

  test('rounding / fixa / mínima inválidos na loja', () => {
    expectCode(() => computeSale({ salePriceCents: 125, store: csfloat({ saleFeeRounding: 'UP' }) }), 'INVALID_FEE_PARAMS');
    expectCode(() => computeSale({ salePriceCents: 125, store: csfloat({ saleFixedFeeCents: -1 }) }), 'INVALID_FEE_PARAMS');
    expectCode(() => computeSale({ salePriceCents: 125, store: csfloat({ saleMinFeeCents: 1.5 }) }), 'INVALID_FEE_PARAMS');
  });

  test('loja com taxas nulas continua FEES_NOT_CONFIGURED', () => {
    expectCode(() => computeSale({ salePriceCents: 100, store: csmoney() }), 'FEES_NOT_CONFIGURED');
  });
});

describe('saleFeeParamsFromStore com loja de taxa inválida', () => {
  test.each(BAD_RATES)('CSFloat: %s → INVALID_FEE_PARAMS', (_name, rate) => {
    expectCode(() => saleFeeParamsFromStore(csfloat({ saleFeeRate: rate })), 'INVALID_FEE_PARAMS');
  });

  test.each(BAD_RATES)('Steam: %s → INVALID_FEE_PARAMS', (_name, rate) => {
    expectCode(() => saleFeeParamsFromStore(steam({ saleFeeRate: rate })), 'INVALID_FEE_PARAMS');
  });

  test('rounding inválido explícito → INVALID_FEE_PARAMS; rounding nulo cai no padrão CEIL', () => {
    expectCode(() => saleFeeParamsFromStore(csfloat({ saleFeeRounding: 'X' })), 'INVALID_FEE_PARAMS');
    expect(saleFeeParamsFromStore(csfloat({ saleFeeRounding: null })).rounding).toBe('CEIL');
  });

  test('taxas nulas continuam retornando null', () => {
    expect(saleFeeParamsFromStore(csmoney())).toBeNull();
    expect(saleFeeParamsFromStore(csfloat({ saleFeeRate: null }))).toBeNull();
    expect(saleFeeParamsFromStore(steam({ saleFeeType: null }))).toBeNull();
  });

  test('minPriceForStore propaga INVALID_FEE_PARAMS e mantém o aviso para taxas nulas', () => {
    expectCode(
      () => minPriceForStore({ costCents: 100, costCurrency: 'USD', costFxRate: null, store: csfloat({ saleFeeRate: 1 }), settings: null }),
      'INVALID_FEE_PARAMS'
    );
    expect(
      minPriceForStore({ costCents: 100, costCurrency: 'USD', costFxRate: null, store: csmoney(), settings: null })
    ).toMatchObject({ minPriceCents: null, warning: 'taxas não configuradas' });
  });
});

describe('PRICE_SEARCH_LIMIT', () => {
  afterEach(() => jest.restoreAllMocks());

  test('findMinSalePriceCents: net nunca alcança o custo (laço de subida) → PRICE_SEARCH_LIMIT', () => {
    jest.spyOn(deducted, 'estimateGross').mockReturnValue(1);
    const net = jest.spyOn(deducted, 'net').mockImplementation(() => 0);
    expectCode(() => findMinSalePriceCents(100, CSF), 'PRICE_SEARCH_LIMIT');
    expect(net.mock.calls.length).toBeLessThanOrEqual(MAX_PRICE_SEARCH_ITERATIONS + 2);
  }, 10000);

  test('findMinSalePriceCents: estimativa enorme e net sempre suficiente (laço de descida) → PRICE_SEARCH_LIMIT', () => {
    jest.spyOn(deducted, 'estimateGross').mockReturnValue(Number.MAX_SAFE_INTEGER);
    jest.spyOn(deducted, 'net').mockImplementation(() => 1e9);
    expectCode(() => findMinSalePriceCents(100, CSF), 'PRICE_SEARCH_LIMIT');
  }, 10000);

  test('findMinSalePriceCents: custo enorme com params reais não estoura (estimativa já é boa)', () => {
    const cost = 1e12;
    const min = findMinSalePriceCents(cost, CSF);
    expect(deducted.net(min, CSF)).toBeGreaterThanOrEqual(cost);
    expect(deducted.net(min - 1, CSF)).toBeLessThan(cost);
  });

  test('addedSaleFee.net: fórmula divergente da estimativa → PRICE_SEARCH_LIMIT', () => {
    jest.isolateModules(() => {
      jest.doMock('../../src/services/fees/saleFeeFormula', () => {
        const actual = jest.requireActual('../../src/services/fees/saleFeeFormula');
        // Taxa sempre 0: a estimativa floor(g / 1,5) fica ~g/3 abaixo do real e o ajuste estoura o limite.
        return { ...actual, computeSaleFee: () => 0 };
      });
      const isolatedAdded = require('../../src/services/fees/addedSaleFee');
      const { ValidationError: IsolatedValidationError } = require('../../src/errors/AppError');
      let caught;
      try {
        isolatedAdded.net(1000000, { ...STEAM_PARAMS, rate: 0.5 });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(IsolatedValidationError);
      expect(caught.code).toBe('PRICE_SEARCH_LIMIT');
    });
    jest.dontMock('../../src/services/fees/saleFeeFormula');
  }, 10000);
});

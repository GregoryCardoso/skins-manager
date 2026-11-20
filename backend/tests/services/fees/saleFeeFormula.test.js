'use strict';

// I1 (D45): a fórmula da taxa de venda tem fonte única em fees/saleFeeFormula.js.
const { computeSaleFee, MAX_PRICE_SEARCH_ITERATIONS } = require('../../../src/services/fees/saleFeeFormula');
const deducted = require('../../../src/services/fees/deductedSaleFee');
const added = require('../../../src/services/fees/addedSaleFee');
const fees = require('../../../src/services/fees');
const { CSF, STEAM_PARAMS } = require('../../helpers/storeFixtures');

const WITH_MIN_FIXED = Object.freeze({ feeType: 'DEDUCTED', rate: 0.05, rounding: 'ROUND', minFeeCents: 30, fixedFeeCents: 10 });
const FLOOR_PARAMS = Object.freeze({ feeType: 'ADDED', rate: 0.07, rounding: 'FLOOR', minFeeCents: 0, fixedFeeCents: 3 });

const CASES = [
  ['CSFloat', CSF],
  ['Steam', STEAM_PARAMS],
  ['minFee + fixedFee (ROUND)', WITH_MIN_FIXED],
  ['FLOOR + fixedFee', FLOOR_PARAMS],
];

describe('saleFeeFormula.computeSaleFee — fonte única (I1)', () => {
  test.each(CASES)('%s: deducted.fee e added.fee iguais à fórmula para bases 0..2000', (_name, params) => {
    for (let base = 0; base <= 2000; base += 1) {
      const expected = computeSaleFee(base, params);
      expect(deducted.fee(base, params)).toBe(expected);
      expect(added.fee(base, params)).toBe(expected);
      expect(fees.computeSaleFee(base, { ...params, feeType: 'DEDUCTED' })).toBe(expected);
      expect(fees.computeSaleFee(base, { ...params, feeType: 'ADDED' })).toBe(expected);
    }
  });

  test('valores de referência da fórmula max(arredondar(base × rate), minFee ?? 0) + fixa', () => {
    expect(computeSaleFee(100, CSF)).toBe(2);
    expect(computeSaleFee(101, CSF)).toBe(3); // 2,02 → CEIL 3
    expect(computeSaleFee(0, CSF)).toBe(0);
    expect(computeSaleFee(100, STEAM_PARAMS)).toBe(15);
    expect(computeSaleFee(100, WITH_MIN_FIXED)).toBe(40); // max(5, 30) + 10
    expect(computeSaleFee(1000, WITH_MIN_FIXED)).toBe(60); // max(50, 30) + 10
    expect(computeSaleFee(1010, WITH_MIN_FIXED)).toBe(61); // 50,5 → ROUND 51, + 10
    expect(computeSaleFee(100, FLOOR_PARAMS)).toBe(10); // 7 + 3
    expect(computeSaleFee(114, FLOOR_PARAMS)).toBe(10); // 7,98 → FLOOR 7, + 3
  });

  test('MAX_PRICE_SEARCH_ITERATIONS é um inteiro positivo e é reexportado por fees/index', () => {
    expect(Number.isInteger(MAX_PRICE_SEARCH_ITERATIONS)).toBe(true);
    expect(MAX_PRICE_SEARCH_ITERATIONS).toBeGreaterThan(0);
    expect(fees.MAX_PRICE_SEARCH_ITERATIONS).toBe(MAX_PRICE_SEARCH_ITERATIONS);
  });
});

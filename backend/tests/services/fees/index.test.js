'use strict';

const { getSaleFeeStrategy, saleFeeParamsFromStore, computeSaleFee } = require('../../../src/services/fees');
const deducted = require('../../../src/services/fees/deductedSaleFee');
const added = require('../../../src/services/fees/addedSaleFee');
const { ValidationError } = require('../../../src/errors/AppError');
const { csfloat, steam, csmoney } = require('../../helpers/storeFixtures');

describe('fees/index', () => {
  test('escolhe a Strategy pelo tipo', () => {
    expect(getSaleFeeStrategy('DEDUCTED')).toBe(deducted);
    expect(getSaleFeeStrategy('ADDED')).toBe(added);
  });

  test.each(['X', null, undefined, 'toString', 'deducted'])('tipo inválido (%p) lança', (type) => {
    expect(() => getSaleFeeStrategy(type)).toThrow(ValidationError);
  });

  test('saleFeeParamsFromStore da CSFloat', () => {
    expect(saleFeeParamsFromStore(csfloat())).toEqual({
      feeType: 'DEDUCTED', rate: 0.02, rounding: 'CEIL', minFeeCents: null, fixedFeeCents: 0,
    });
  });

  test('saleFeeParamsFromStore com tipo/taxa nulos → null', () => {
    expect(saleFeeParamsFromStore(csmoney())).toBeNull();
    expect(saleFeeParamsFromStore(csfloat({ saleFeeRate: null }))).toBeNull();
    expect(saleFeeParamsFromStore(csfloat({ saleFeeType: null }))).toBeNull();
    expect(saleFeeParamsFromStore(null)).toBeNull();
  });

  test('saleMinFeeCents nulo é preservado como null (não vira 0)', () => {
    expect(saleFeeParamsFromStore(steam({ saleMinFeeCents: null })).minFeeCents).toBeNull();
    expect(saleFeeParamsFromStore(steam({ saleMinFeeCents: 7 })).minFeeCents).toBe(7);
  });

  test('computeSaleFee despacha pela Strategy', () => {
    expect(computeSaleFee(100, saleFeeParamsFromStore(steam()))).toBe(15);
    expect(computeSaleFee(100, saleFeeParamsFromStore(csfloat()))).toBe(2);
  });
});

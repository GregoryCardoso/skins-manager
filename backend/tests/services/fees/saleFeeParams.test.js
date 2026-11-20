'use strict';

// I2 (D45): validação dos parâmetros da taxa de venda.
const { assertSaleFeeParams } = require('../../../src/services/fees/saleFeeParams');
const fees = require('../../../src/services/fees');
const { ValidationError } = require('../../../src/errors/AppError');
const { CSF } = require('../../helpers/storeFixtures');

const p = (overrides) => ({ ...CSF, ...overrides });

function expectInvalid(params) {
  let caught;
  try {
    assertSaleFeeParams(params);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ValidationError);
  expect(caught.code).toBe('INVALID_FEE_PARAMS');
  expect(caught.status).toBe(400);
}

describe('assertSaleFeeParams — rejeita (INVALID_FEE_PARAMS)', () => {
  test.each([
    ['rate = 1', 1],
    ['rate > 1 (1.5)', 1.5],
    ['rate negativo (-0.01)', -0.01],
    ['rate 0.9999995 (arredonda para 1e6 ppm)', 0.9999995],
    ['rate NaN', NaN],
    ['rate Infinity', Infinity],
    ['rate -Infinity', -Infinity],
    ['rate string', '0.02'],
    ['rate null', null],
    ['rate undefined', undefined],
  ])('%s', (_name, rate) => {
    expectInvalid(p({ rate }));
  });

  test.each([['ceil'], ['UP'], [''], [null], [undefined], [1]])('rounding inválido (%p)', (rounding) => {
    expectInvalid(p({ rounding }));
  });

  test.each([[-1], [1.5], [NaN], ['0'], [null], [undefined]])('fixedFeeCents inválido (%p)', (fixedFeeCents) => {
    expectInvalid(p({ fixedFeeCents }));
  });

  test.each([[-1], [2.5], [NaN], [Infinity], ['5']])('minFeeCents inválido (%p)', (minFeeCents) => {
    expectInvalid(p({ minFeeCents }));
  });

  test.each([[null], [undefined], [0.02], ['params'], [true]])('params não objeto (%p)', (params) => {
    expectInvalid(params);
  });

  test('é reexportado por fees/index', () => {
    expect(fees.assertSaleFeeParams).toBe(assertSaleFeeParams);
  });
});

describe('assertSaleFeeParams — aceita', () => {
  test.each([
    ['rate 0', { rate: 0 }],
    ['rate 0.999999', { rate: 0.999999 }],
    ['minFeeCents null', { minFeeCents: null }],
    ['minFeeCents undefined', { minFeeCents: undefined }],
    ['minFeeCents 0', { minFeeCents: 0 }],
    ['minFeeCents 50', { minFeeCents: 50 }],
    ['fixedFeeCents 0', { fixedFeeCents: 0 }],
    ['fixedFeeCents 30', { fixedFeeCents: 30 }],
    ['rounding ROUND', { rounding: 'ROUND' }],
    ['rounding FLOOR', { rounding: 'FLOOR' }],
  ])('%s', (_name, overrides) => {
    expect(() => assertSaleFeeParams(p(overrides))).not.toThrow();
  });

  test('params sem a chave minFeeCents', () => {
    const rest = { ...CSF };
    delete rest.minFeeCents;
    expect(() => assertSaleFeeParams(rest)).not.toThrow();
  });
});

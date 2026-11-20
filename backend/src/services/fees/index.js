'use strict';

const { ValidationError } = require('../../errors/AppError');
const deducted = require('./deductedSaleFee');
const added = require('./addedSaleFee');
const { computeSaleFee: computeSaleFeeFormula, MAX_PRICE_SEARCH_ITERATIONS } = require('./saleFeeFormula');
const { assertSaleFeeParams } = require('./saleFeeParams');

const STRATEGIES = { DEDUCTED: deducted, ADDED: added };

function getSaleFeeStrategy(saleFeeType) {
  const strategy = Object.prototype.hasOwnProperty.call(STRATEGIES, saleFeeType) ? STRATEGIES[saleFeeType] : null;
  if (!strategy) {
    throw new ValidationError(`Tipo de taxa de venda desconhecido: ${saleFeeType}`, 'INVALID_FEE_TYPE');
  }
  return strategy;
}

// Retorna null quando a taxa de venda necessária não está configurada (nunca assume 0).
function saleFeeParamsFromStore(store) {
  if (!store || store.saleFeeType == null || store.saleFeeRate == null) return null;
  const params = {
    feeType: store.saleFeeType,
    rate: store.saleFeeRate,
    rounding: store.saleFeeRounding ?? 'CEIL',
    minFeeCents: store.saleMinFeeCents ?? null,
    fixedFeeCents: store.saleFixedFeeCents ?? 0,
  };
  assertSaleFeeParams(params);
  return params;
}

// Valida o tipo e delega à fórmula única (2.4): max(arredondar(base × rate), minFee ?? 0) + fixa.
function computeSaleFee(baseCents, params) {
  getSaleFeeStrategy(params.feeType);
  return computeSaleFeeFormula(baseCents, params);
}

module.exports = {
  getSaleFeeStrategy,
  saleFeeParamsFromStore,
  computeSaleFee,
  assertSaleFeeParams,
  MAX_PRICE_SEARCH_ITERATIONS,
};

'use strict';

const { ValidationError } = require('../../errors/AppError');
const deducted = require('./deductedSaleFee');
const added = require('./addedSaleFee');
const { computeSaleFee: computeSaleFeeFormula, MAX_PRICE_SEARCH_ITERATIONS } = require('./saleFeeFormula');
const { assertSaleFeeParams } = require('./saleFeeParams');
const { ZERO_DECIMAL_CURRENCIES } = require('../../config/constants');

const STRATEGIES = { DEDUCTED: deducted, ADDED: added };

function getSaleFeeStrategy(saleFeeType) {
  const strategy = Object.prototype.hasOwnProperty.call(STRATEGIES, saleFeeType) ? STRATEGIES[saleFeeType] : null;
  if (!strategy) {
    throw new ValidationError(`Tipo de taxa de venda desconhecido: ${saleFeeType}`, 'INVALID_FEE_TYPE');
  }
  return strategy;
}

// Parâmetros da taxa a partir dos campos de uma loja AINDA NÃO gravada (rascunho do formulário, 12.8): o mesmo cálculo de
// `saleFeeParamsFromStore`, sem exigir um registro. Campos com os mesmos nomes da loja. Retorna null sem tipo ou taxa (nunca assume 0).
function saleFeeParamsFromDraft(draft) {
  if (!draft || draft.saleFeeType == null || draft.saleFeeRate == null) return null;
  const params = {
    feeType: draft.saleFeeType,
    rate: draft.saleFeeRate,
    rounding: draft.saleFeeRounding ?? 'CEIL',
    minFeeCents: draft.saleMinFeeCents ?? null,
    fixedFeeCents: draft.saleFixedFeeCents ?? 0,
    // Unidade mínima da moeda da loja (D369 A3): 100 em JPY, KRW e CLP; 1 nas demais.
    unitCents: ZERO_DECIMAL_CURRENCIES.includes(draft.currency) ? 100 : 1,
  };
  assertSaleFeeParams(params);
  return params;
}

// Retorna null quando a taxa de venda necessária não está configurada (nunca assume 0).
function saleFeeParamsFromStore(store) {
  return saleFeeParamsFromDraft(store);
}

// Valida o tipo e delega à fórmula única (2.4): max(arredondar(base × rate), minFee ?? 0) + fixa.
function computeSaleFee(baseCents, params) {
  getSaleFeeStrategy(params.feeType);
  return computeSaleFeeFormula(baseCents, params);
}

module.exports = {
  getSaleFeeStrategy,
  saleFeeParamsFromStore,
  saleFeeParamsFromDraft,
  computeSaleFee,
  assertSaleFeeParams,
  MAX_PRICE_SEARCH_ITERATIONS,
};

'use strict';

const { ValidationError } = require('../../errors/AppError');
const { MODES } = require('./rounding');

const CODE = 'INVALID_FEE_PARAMS';
const show = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
const fail = (field, rule, value) => {
  throw new ValidationError(`Parâmetro de taxa inválido: ${field} ${rule} (recebido: ${show(value)}).`, CODE);
};

// Valida params normalizados da taxa de venda (D34/D35). Lança ValidationError INVALID_FEE_PARAMS.
function assertSaleFeeParams(params) {
  if (params === null || typeof params !== 'object') fail('params', 'deve ser um objeto', params);
  const { rate, rounding, fixedFeeCents, minFeeCents, unitCents } = params;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || Math.round(rate * 1e6) >= 1e6) {
    fail('rate', 'deve ser um número finito com 0 <= rate < 1', rate);
  }
  if (!MODES.includes(rounding)) fail('rounding', `deve ser um de ${MODES.join(', ')}`, rounding);
  if (!Number.isInteger(fixedFeeCents) || fixedFeeCents < 0) {
    fail('fixedFeeCents', 'deve ser um inteiro >= 0', fixedFeeCents);
  }
  if (minFeeCents != null && (!Number.isInteger(minFeeCents) || minFeeCents < 0)) {
    fail('minFeeCents', 'deve ser nulo ou um inteiro >= 0', minFeeCents);
  }
  if (unitCents != null && (!Number.isInteger(unitCents) || unitCents < 1)) {
    fail('unitCents', 'deve ser nulo ou um inteiro >= 1', unitCents);
  }
}

module.exports = { assertSaleFeeParams };

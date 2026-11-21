'use strict';

// Forma do corpo do POST de saldos e da query do histórico (D204). Regras ficam no storeBalanceService.
const { ValidationError } = require('../errors/AppError');
const { isPlainObject, rejectUnknownFields } = require('./validationHelpers');

const BODY_FIELDS = Object.freeze({
  storeId: { type: 'number', integer: true },
  balanceCents: { type: 'number' },
  recordedAt: { type: 'string' },
});

function validateStoreBalanceCreateBody(req, res, next) {
  const body = req.body;
  if (!isPlainObject(body)) return next(new ValidationError('O corpo da requisição deve ser um objeto JSON.', 'INVALID_BODY'));
  try {
    rejectUnknownFields(body, BODY_FIELDS);
  } catch (err) {
    return next(err);
  }
  for (const [key, rule] of Object.entries(BODY_FIELDS)) {
    const value = body[key];
    if (value === undefined || value === null) {
      return next(new ValidationError(`O campo ${key} é obrigatório.`, 'REQUIRED_FIELD', { field: key }));
    }
    const typeOk = typeof value === rule.type && (rule.type !== 'number' || Number.isFinite(value));
    if (!typeOk || (rule.integer && !Number.isSafeInteger(value))) {
      return next(new ValidationError(`O campo ${key} tem um tipo inválido.`, 'INVALID_FIELD', { field: key }));
    }
  }
  return next();
}

// ?storeId= opcional: inteiro positivo (só dígitos); qualquer outra coisa é INVALID_QUERY.
function validateStoreBalanceQuery(req, res, next) {
  const parsed = {};
  const raw = req.query.storeId;
  if (raw !== undefined) {
    const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(value) || value < 1) {
      return next(new ValidationError('Valor inválido para storeId.', 'INVALID_QUERY', { field: 'storeId' }));
    }
    parsed.storeId = value;
  }
  req.validatedQuery = parsed;
  return next();
}

module.exports = { validateStoreBalanceCreateBody, validateStoreBalanceQuery };

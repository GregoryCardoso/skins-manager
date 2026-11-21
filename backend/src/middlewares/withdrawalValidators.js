'use strict';

// Forma do corpo de POST/PATCH de saques e da query da sugestão de taxa (D203). Regras ficam no withdrawalService.
const { ValidationError } = require('../errors/AppError');
const { isPlainObject, rejectUnknownFields } = require('./validationHelpers');

// `nullable`: aceita `null` na forma (o service decide: storeId nulo = STORE_REQUIRED; feeCents nulo = "não informada").
const BODY_FIELDS = Object.freeze({
  storeId: { type: 'number', nullable: true, integer: true },
  amountStoreCents: { type: 'number', nullable: false },
  feeCents: { type: 'number', nullable: true },
  amountBrlCents: { type: 'number', nullable: false },
  withdrawnAt: { type: 'string', nullable: false },
  note: { type: 'string', nullable: true },
});

function checkBodyShape(body, { requireKeys }) {
  if (!isPlainObject(body)) {
    return new ValidationError('O corpo da requisição deve ser um objeto JSON.', 'INVALID_BODY');
  }
  try {
    rejectUnknownFields(body, BODY_FIELDS);
  } catch (err) {
    return err;
  }
  if (requireKeys) {
    if (body.storeId === undefined || body.storeId === null) {
      return new ValidationError('A loja do saque é obrigatória.', 'STORE_REQUIRED', { field: 'storeId' });
    }
    for (const key of ['amountStoreCents', 'amountBrlCents', 'withdrawnAt']) {
      if (body[key] === undefined || body[key] === null) {
        return new ValidationError(`O campo ${key} é obrigatório.`, 'REQUIRED_FIELD', { field: key });
      }
    }
  } else if (Object.keys(body).length === 0) {
    return new ValidationError('Informe ao menos um campo para alterar.', 'INVALID_BODY');
  }
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) continue;
    const rule = BODY_FIELDS[key];
    if (value === null) {
      if (!rule.nullable) return new ValidationError(`O campo ${key} é obrigatório.`, 'REQUIRED_FIELD', { field: key });
      continue;
    }
    const typeOk = typeof value === rule.type && (rule.type !== 'number' || Number.isFinite(value));
    if (!typeOk || (rule.integer && !Number.isSafeInteger(value))) {
      return new ValidationError(`O campo ${key} tem um tipo inválido.`, 'INVALID_FIELD', { field: key });
    }
  }
  return null;
}

const validateWithdrawalCreateBody = (req, res, next) => next(checkBodyShape(req.body, { requireKeys: true }) || undefined);
const validateWithdrawalPatchBody = (req, res, next) => next(checkBodyShape(req.body, { requireKeys: false }) || undefined);

// ?storeId=&amountStoreCents=: dois inteiros positivos (só dígitos); qualquer outra coisa é INVALID_QUERY.
function validateFeeSuggestionQuery(req, res, next) {
  const parsed = {};
  for (const key of ['storeId', 'amountStoreCents']) {
    const raw = req.query[key];
    const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(value) || value < 1) {
      return next(new ValidationError(`Valor inválido para ${key}.`, 'INVALID_QUERY', { field: key }));
    }
    parsed[key] = value;
  }
  req.validatedQuery = parsed;
  return next();
}

module.exports = { validateWithdrawalCreateBody, validateWithdrawalPatchBody, validateFeeSuggestionQuery };

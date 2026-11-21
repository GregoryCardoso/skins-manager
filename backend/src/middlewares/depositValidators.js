'use strict';

// Forma do corpo de POST/PATCH de aportes (D202). Valores e regras de negócio ficam no depositService.
const { ValidationError } = require('../errors/AppError');
const { isPlainObject, rejectUnknownFields } = require('./validationHelpers');

const BODY_FIELDS = Object.freeze({
  amountBrlCents: { type: 'number', nullable: false },
  depositedAt: { type: 'string', nullable: false },
  storeId: { type: 'number', nullable: true },
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
    for (const key of ['amountBrlCents', 'depositedAt']) {
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
    if (!typeOk || (key === 'storeId' && !Number.isSafeInteger(value))) {
      return new ValidationError(`O campo ${key} tem um tipo inválido.`, 'INVALID_FIELD', { field: key });
    }
  }
  return null;
}

const validateDepositCreateBody = (req, res, next) => next(checkBodyShape(req.body, { requireKeys: true }) || undefined);
const validateDepositPatchBody = (req, res, next) => next(checkBodyShape(req.body, { requireKeys: false }) || undefined);

module.exports = { validateDepositCreateBody, validateDepositPatchBody };

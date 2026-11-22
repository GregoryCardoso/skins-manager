'use strict';

// Forma dos corpos e queries de saldos (D204, D246). Regras ficam no storeBalanceService.
const { ValidationError } = require('../errors/AppError');
const { isNil, isPlainObject, rejectUnknownFields } = require('./validationHelpers');

const invalidField = (key) => new ValidationError(`O campo ${key} tem um tipo inválido.`, 'INVALID_FIELD', { field: key });
const requiredField = (key) => new ValidationError(`O campo ${key} é obrigatório.`, 'REQUIRED_FIELD', { field: key });

const isType = (value, type, integer) => {
  if (typeof value !== type) return false;
  if (type !== 'number') return true;
  return Number.isFinite(value) && (!integer || Number.isSafeInteger(value));
};

// Valida `body` contra `rules` ({ campo: { type, integer, required } }); `note` aceita texto ou nulo.
function checkBody(body, rules) {
  if (!isPlainObject(body)) throw new ValidationError('O corpo da requisição deve ser um objeto JSON.', 'INVALID_BODY');
  rejectUnknownFields(body, rules);
  for (const [key, rule] of Object.entries(rules)) {
    const value = body[key];
    if (isNil(value)) {
      if (rule.required) throw requiredField(key);
      continue;
    }
    if (!isType(value, rule.type, rule.integer)) throw invalidField(key);
  }
}

const withErrors = (rules) => (req, res, next) => {
  try {
    checkBody(req.body, rules);
  } catch (err) {
    return next(err);
  }
  return next();
};

const CHECK_FIELDS = Object.freeze({
  storeId: { type: 'number', integer: true, required: true },
  balanceCents: { type: 'number', integer: true, required: true },
  recordedAt: { type: 'string', required: true },
  adjust: { type: 'boolean' },
  note: { type: 'string' },
});

const validateStoreBalanceCheckBody = withErrors(CHECK_FIELDS);

const invalidQuery = (key) => new ValidationError(`Valor inválido para ${key}.`, 'INVALID_QUERY', { field: key });

// ?storeId= opcional: inteiro positivo (só dígitos); qualquer outra coisa é INVALID_QUERY.
function validateStoreBalanceQuery(req, res, next) {
  const parsed = {};
  const raw = req.query.storeId;
  if (raw !== undefined) {
    const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(value) || value < 1) return next(invalidQuery('storeId'));
    parsed.storeId = value;
  }
  req.validatedQuery = parsed;
  return next();
}

// Prévia da conferência: storeId, balanceCents e recordedAt (forma apenas; o service valida o resto).
function validateCheckPreviewQuery(req, res, next) {
  const parsed = {};
  const allowed = ['storeId', 'balanceCents', 'recordedAt'];
  const unknown = Object.keys(req.query).find((key) => !allowed.includes(key));
  if (unknown) return next(invalidQuery(unknown));
  for (const key of allowed) {
    const raw = req.query[key];
    if (raw === undefined) return next(requiredField(key));
    if (typeof raw !== 'string') return next(invalidQuery(key));
    if (key === 'recordedAt') {
      parsed[key] = raw;
      continue;
    }
    const value = /^-?\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(value) || (key === 'storeId' && value < 1)) return next(invalidQuery(key));
    parsed[key] = value;
  }
  req.validatedQuery = parsed;
  return next();
}

module.exports = {
  validateStoreBalanceCheckBody, validateStoreBalanceQuery, validateCheckPreviewQuery,
};

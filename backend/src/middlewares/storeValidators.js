const { ValidationError } = require('../errors/AppError');
const { MAX_AMOUNT_CENTS } = require('../config/constants');
const { isPlainObject } = require('./validationHelpers');

function validateStoreQuery(req, res, next) {
  const raw = req.query.activeOnly;
  if (raw !== undefined && raw !== 'true' && raw !== 'false') {
    return next(new ValidationError('activeOnly deve ser "true" ou "false".', 'INVALID_QUERY', { field: 'activeOnly' }));
  }
  req.validatedQuery = { activeOnly: raw === 'true' };
  return next();
}

// `salePriceCents`: inteiro > 0 e <= teto, em texto decimal puro.
function validateSaleQuoteQuery(req, res, next) {
  const raw = req.query.salePriceCents;
  const value = typeof raw === 'string' && /^\d{1,16}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_AMOUNT_CENTS) {
    return next(new ValidationError(
      'salePriceCents deve ser um inteiro de centavos maior que 0.', 'INVALID_QUERY', { field: 'salePriceCents' }
    ));
  }
  req.validatedQuery = { salePriceCents: value };
  return next();
}

// Forma do corpo de POST/PATCH (D156). Valores e regras de negócio ficam no storeService.
const STRING = 'string';
const NUMBER = 'number';
const BOOLEAN = 'boolean';
// tipo esperado e se aceita null
const BODY_FIELDS = Object.freeze({
  name: { type: STRING, nullable: false },
  currency: { type: STRING, nullable: false },
  saleFeeType: { type: STRING, nullable: true },
  saleFeeRate: { type: NUMBER, nullable: true },
  saleFeeRounding: { type: STRING, nullable: false },
  saleMinFeeCents: { type: NUMBER, nullable: true },
  saleFixedFeeCents: { type: NUMBER, nullable: false },
  allowsWithdrawal: { type: BOOLEAN, nullable: false },
  withdrawalFeeRate: { type: NUMBER, nullable: true },
  withdrawalFixedFeeCents: { type: NUMBER, nullable: false },
  isActive: { type: BOOLEAN, nullable: false },
  isPrimary: { type: BOOLEAN, nullable: false },
});

function checkBodyShape(body, { requireKeys }) {
  if (!isPlainObject(body)) {
    return new ValidationError('O corpo da requisição deve ser um objeto JSON.', 'INVALID_BODY');
  }
  const keys = Object.keys(body);
  const unknown = keys.find((k) => !Object.prototype.hasOwnProperty.call(BODY_FIELDS, k));
  if (unknown) return new ValidationError(`Campo desconhecido: ${unknown}`, 'UNKNOWN_FIELD', { field: unknown });
  if (requireKeys) {
    for (const key of ['name', 'currency']) {
      if (body[key] === undefined) {
        return new ValidationError(`O campo ${key} é obrigatório.`, 'REQUIRED_FIELD', { field: key });
      }
    }
  } else if (keys.length === 0) {
    return new ValidationError('Informe ao menos um campo para alterar.', 'INVALID_BODY');
  }
  for (const key of keys) {
    const value = body[key];
    if (value === undefined) continue;
    const rule = BODY_FIELDS[key];
    if (value === null ? !rule.nullable : typeof value !== rule.type) {
      return new ValidationError(`O campo ${key} tem um tipo inválido.`, 'INVALID_FIELD', { field: key });
    }
  }
  return null;
}

const validateStoreCreateBody = (req, res, next) => next(checkBodyShape(req.body, { requireKeys: true }) || undefined);
const validateStorePatchBody = (req, res, next) => next(checkBodyShape(req.body, { requireKeys: false }) || undefined);

module.exports = { validateStoreQuery, validateSaleQuoteQuery, validateStoreCreateBody, validateStorePatchBody };

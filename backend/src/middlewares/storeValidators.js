const { ValidationError } = require('../errors/AppError');
const { MAX_ANY_AMOUNT_CENTS, CURRENCIES } = require('../config/constants');
const { isPlainObject, rejectUnknownFields } = require('./validationHelpers');

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
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_ANY_AMOUNT_CENTS) {
    return next(new ValidationError(
      'salePriceCents deve ser um inteiro de centavos maior que 0.', 'INVALID_QUERY', { field: 'salePriceCents' }
    ));
  }
  req.validatedQuery = { salePriceCents: value };
  return next();
}

// Prévia da taxa de uma loja ainda não gravada (12.8): só a forma dos parâmetros (texto -> número). O valor e a moeda são do service.
const FEE_PREVIEW_FIELDS = ['currency', 'saleFeeType', 'rate', 'rounding', 'minCents', 'fixedCents', 'priceCents'];
const invalidQuery = (field, message) => new ValidationError(message, 'INVALID_QUERY', { field });

function parseCentsQuery(raw, field, { allowZero }) {
  if (raw === undefined || raw === '') return { value: null };
  const value = typeof raw === 'string' && /^\d{1,16}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || (!allowZero && value <= 0) || value > MAX_ANY_AMOUNT_CENTS) {
    return { error: invalidQuery(field, `${field} deve ser um inteiro de centavos ${allowZero ? 'maior ou igual a 0' : 'maior que 0'}.`) };
  }
  return { value };
}

function validateFeePreviewQuery(req, res, next) {
  const q = req.query;
  const unknown = Object.keys(q).find((key) => !FEE_PREVIEW_FIELDS.includes(key));
  if (unknown !== undefined) return next(invalidQuery(unknown, `Parâmetro desconhecido: ${unknown}.`));
  if (typeof q.currency !== 'string' || !CURRENCIES.includes(q.currency)) {
    return next(invalidQuery('currency', `currency inválida. Use ${CURRENCIES.join(', ')}.`));
  }
  if (q.saleFeeType !== 'DEDUCTED' && q.saleFeeType !== 'ADDED') {
    return next(invalidQuery('saleFeeType', 'saleFeeType deve ser DEDUCTED ou ADDED.'));
  }
  const rate = typeof q.rate === 'string' && /^\d+(\.\d+)?$/.test(q.rate) ? Number(q.rate) : NaN;
  if (!Number.isFinite(rate)) return next(invalidQuery('rate', 'rate deve ser um número (fração, de 0 a menos de 1).'));
  if (q.rounding !== undefined && !['CEIL', 'ROUND', 'FLOOR'].includes(q.rounding)) {
    return next(invalidQuery('rounding', 'rounding deve ser CEIL, ROUND ou FLOOR.'));
  }
  const min = parseCentsQuery(q.minCents, 'minCents', { allowZero: true });
  const fixed = parseCentsQuery(q.fixedCents, 'fixedCents', { allowZero: true });
  const price = parseCentsQuery(q.priceCents, 'priceCents', { allowZero: false });
  const failed = min.error || fixed.error || price.error;
  if (failed) return next(failed);
  req.validatedQuery = {
    currency: q.currency,
    saleFeeType: q.saleFeeType,
    rate,
    rounding: q.rounding ?? 'CEIL',
    minCents: min.value,
    fixedCents: fixed.value ?? 0,
    priceCents: price.value,
  };
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
  saleHoldDays: { type: NUMBER, nullable: false },
  isActive: { type: BOOLEAN, nullable: false },
  isPrimary: { type: BOOLEAN, nullable: false },
});

function checkBodyShape(body, { requireKeys }) {
  if (!isPlainObject(body)) {
    return new ValidationError('O corpo da requisição deve ser um objeto JSON.', 'INVALID_BODY');
  }
  const keys = Object.keys(body);
  try {
    rejectUnknownFields(body, BODY_FIELDS);
  } catch (err) {
    return err;
  }
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

module.exports = { validateStoreQuery, validateSaleQuoteQuery, validateFeePreviewQuery, validateStoreCreateBody, validateStorePatchBody };

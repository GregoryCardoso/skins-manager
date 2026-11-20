const { ValidationError } = require('../errors/AppError');
const { MAX_AMOUNT_CENTS } = require('../config/constants');

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

module.exports = { validateStoreQuery, validateSaleQuoteQuery };

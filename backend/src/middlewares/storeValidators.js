const { ValidationError } = require('../errors/AppError');

function validateStoreQuery(req, res, next) {
  const raw = req.query.activeOnly;
  if (raw !== undefined && raw !== 'true' && raw !== 'false') {
    return next(new ValidationError('activeOnly deve ser "true" ou "false".', 'INVALID_QUERY'));
  }
  req.validatedQuery = { activeOnly: raw === 'true' };
  return next();
}

module.exports = { validateStoreQuery };

const { ValidationError } = require('../errors/AppError');

// `:id` precisa ser um inteiro seguro >= 1; senão 400 INVALID_ID.
function validateIdParam(req, res, next) {
  const raw = req.params.id;
  const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id < 1) {
    return next(new ValidationError('Identificador inválido.', 'INVALID_ID'));
  }
  req.params.id = id;
  return next();
}

module.exports = validateIdParam;

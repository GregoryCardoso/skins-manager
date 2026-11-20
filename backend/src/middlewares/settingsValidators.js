const { ValidationError } = require('../errors/AppError');

// Validação de forma; o valor (> 0) é validado pelo settingsService.
function validateFxRateBody(req, res, next) {
  const body = req.body;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return next(new ValidationError('O corpo da requisição deve ser um objeto JSON.', 'INVALID_BODY'));
  }
  const unknown = Object.keys(body).find((k) => k !== 'usdBrlRate');
  if (unknown) return next(new ValidationError(`Campo desconhecido: ${unknown}`, 'UNKNOWN_FIELD'));
  if (body.usdBrlRate === undefined) {
    return next(new ValidationError('O campo usdBrlRate é obrigatório.', 'REQUIRED_FIELD'));
  }
  if (typeof body.usdBrlRate !== 'number') {
    return next(new ValidationError('usdBrlRate deve ser um número.', 'INVALID_FIELD'));
  }
  return next();
}

module.exports = { validateFxRateBody };

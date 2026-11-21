const { ValidationError } = require('../errors/AppError');
const { isPlainObject, rejectUnknownFields, requireJsonContentType } = require('./validationHelpers');

const invalidBody = (message) => new ValidationError(message, 'INVALID_BODY');

// Validação de forma; o valor (> 0) é validado pelo settingsService.
function validateFxRateBody(req, res, next) {
  const body = req.body;
  if (!isPlainObject(body)) throw invalidBody('O corpo da requisição deve ser um objeto JSON.');
  rejectUnknownFields(body, ['usdBrlRate']);
  if (body.usdBrlRate === undefined) {
    throw new ValidationError('O campo usdBrlRate é obrigatório.', 'REQUIRED_FIELD', { field: 'usdBrlRate' });
  }
  if (typeof body.usdBrlRate !== 'number') {
    throw new ValidationError('usdBrlRate deve ser um número.', 'INVALID_FIELD', { field: 'usdBrlRate' });
  }
  return next();
}

// PATCH /api/settings (D83, D159, D162): tema, idioma, fonte da cotação e os limites de giro. Os valores permitidos são checados no service.
const TEXT_KEYS = ['theme', 'language', 'fxRefreshSource'];
const DAYS_KEYS = ['fastTurnoverDays', 'slowItemDays']; // número ou null; o tipo é checado no service (códigos próprios)

function validatePreferencesBody(req, res, next) {
  const body = req.body;
  if (!isPlainObject(body) || Object.keys(body).length === 0) {
    throw invalidBody('Informe ao menos um campo (theme, language, fxRefreshSource, fastTurnoverDays ou slowItemDays) em um objeto JSON.');
  }
  rejectUnknownFields(body, [...TEXT_KEYS, ...DAYS_KEYS]);
  const invalid = TEXT_KEYS.find((k) => body[k] !== undefined && typeof body[k] !== 'string');
  if (invalid) throw new ValidationError(`O campo ${invalid} deve ser texto.`, 'INVALID_FIELD', { field: invalid });
  return next();
}

// POST /api/settings/fx-rate/refresh (D147, D162): corpo `{}` e Content-Type JSON obrigatório.
function validateFxRefreshBody(req, res, next) {
  requireJsonContentType(req);
  const body = req.body === undefined ? {} : req.body;
  if (!isPlainObject(body)) throw invalidBody('O corpo da requisição deve ser um objeto JSON.');
  rejectUnknownFields(body, []);
  return next();
}

module.exports = { validateFxRateBody, validatePreferencesBody, validateFxRefreshBody };

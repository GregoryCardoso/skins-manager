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
const TEXT_KEYS = ['theme', 'language', 'inventoryView', 'fxRefreshSource'];
const DAYS_KEYS = ['fastTurnoverDays', 'slowItemDays']; // número ou null; o tipo é checado no service (códigos próprios)

function validatePreferencesBody(req, res, next) {
  const body = req.body;
  if (!isPlainObject(body) || Object.keys(body).length === 0) {
    throw invalidBody('Informe ao menos um campo (theme, language, inventoryView, fxRefreshSource, fastTurnoverDays ou slowItemDays) em um objeto JSON.');
  }
  rejectUnknownFields(body, [...TEXT_KEYS, ...DAYS_KEYS]);
  const invalid = TEXT_KEYS.find((k) => k !== 'inventoryView' && body[k] !== undefined && typeof body[k] !== 'string');
  if (invalid) throw new ValidationError(`O campo ${invalid} deve ser texto.`, 'INVALID_FIELD', { field: invalid });
  return next();
}

// POST /api/settings/fx-rate/refresh (D147, D162): corpo `{}` e Content-Type JSON obrigatório.
// POST fx-rate/refresh: `{}` (botão "atualizar cotação") ou `{ trigger: 'AUTO' }` (ao abrir o app, D338).
function validateFxRefreshBody(req, res, next) {
  requireJsonContentType(req);
  const body = req.body === undefined ? {} : req.body;
  if (!isPlainObject(body)) throw invalidBody('O corpo da requisição deve ser um objeto JSON.');
  rejectUnknownFields(body, ['trigger']);
  if (body.trigger !== undefined && !['MANUAL', 'AUTO'].includes(body.trigger)) {
    throw new ValidationError('trigger deve ser MANUAL ou AUTO.', 'INVALID_FIELD', { field: 'trigger' });
  }
  req.body = body;
  return next();
}

// PUT /api/settings/steam-store (D363): `{ storeId: number | null }`. A existência da loja é conferida no service.
function validateSteamStoreBody(req, res, next) {
  const body = req.body;
  if (!isPlainObject(body)) throw invalidBody('O corpo da requisição deve ser um objeto JSON.');
  rejectUnknownFields(body, ['storeId']);
  if (body.storeId === undefined) throw new ValidationError('O campo storeId é obrigatório (use null para limpar).', 'REQUIRED_FIELD', { field: 'storeId' });
  if (body.storeId !== null && !Number.isSafeInteger(body.storeId)) {
    throw new ValidationError('storeId deve ser um número inteiro ou null.', 'INVALID_FIELD', { field: 'storeId' });
  }
  return next();
}

module.exports = { validateFxRateBody, validatePreferencesBody, validateFxRefreshBody, validateSteamStoreBody };

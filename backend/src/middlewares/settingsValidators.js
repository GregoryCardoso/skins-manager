const { ValidationError } = require('../errors/AppError');
const { isPlainObject, rejectUnknownFields, requireJsonContentType } = require('./validationHelpers');

const invalidBody = (message) => new ValidationError(message, 'INVALID_BODY');

// PUT /api/settings/fx-rate (D369): `{ currency = 'BRL', rate }`; `{ usdBrlRate }` continua aceito (só BRL, compatibilidade até o fim
// da 11.3) e vira `{ currency: 'BRL', rate }`. Validação de forma; a moeda e o valor (> 0, faixa da moeda) são validados no service.
function validateFxRateBody(req, res, next) {
  const body = req.body;
  if (!isPlainObject(body)) throw invalidBody('O corpo da requisição deve ser um objeto JSON.');
  rejectUnknownFields(body, ['usdBrlRate', 'currency', 'rate']);
  const legacy = body.usdBrlRate !== undefined;
  if (legacy && (body.rate !== undefined || body.currency !== undefined)) {
    throw new ValidationError('Use usdBrlRate sozinho ou currency com rate, nunca os dois.', 'INVALID_FIELD', { field: 'rate' });
  }
  const field = legacy ? 'usdBrlRate' : 'rate';
  const value = legacy ? body.usdBrlRate : body.rate;
  if (value === undefined) {
    throw new ValidationError(`O campo ${field} é obrigatório.`, 'REQUIRED_FIELD', { field });
  }
  if (typeof value !== 'number') {
    throw new ValidationError(`${field} deve ser um número.`, 'INVALID_FIELD', { field });
  }
  if (body.currency !== undefined && typeof body.currency !== 'string') {
    throw new ValidationError('currency deve ser texto.', 'INVALID_FIELD', { field: 'currency' });
  }
  req.body = { currency: legacy ? 'BRL' : body.currency ?? 'BRL', rate: value };
  return next();
}

// PATCH /api/settings (D83, D159, D162): tema, idioma, fonte da cotação e os limites de giro. Os valores permitidos são checados no service.
const TEXT_KEYS = ['theme', 'language', 'inventoryView', 'fxRefreshSource', 'displayCurrency', 'steamStore'];
const DAYS_KEYS = ['fastTurnoverDays', 'slowItemDays']; // número ou null; o tipo é checado no service (códigos próprios)

function validatePreferencesBody(req, res, next) {
  const body = req.body;
  if (!isPlainObject(body) || Object.keys(body).length === 0) {
    throw invalidBody('Informe ao menos um campo (theme, language, inventoryView, fxRefreshSource, displayCurrency, fastTurnoverDays ou slowItemDays) em um objeto JSON.');
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
  rejectUnknownFields(body, ['trigger', 'currency', 'source']);
  if (body.trigger !== undefined && !['MANUAL', 'AUTO'].includes(body.trigger)) {
    throw new ValidationError('trigger deve ser MANUAL ou AUTO.', 'INVALID_FIELD', { field: 'trigger' });
  }
  if (body.currency !== undefined && typeof body.currency !== 'string') {
    throw new ValidationError('currency deve ser texto.', 'INVALID_FIELD', { field: 'currency' });
  }
  if (body.source !== undefined && typeof body.source !== 'string') {
    throw new ValidationError('source deve ser texto.', 'INVALID_FIELD', { field: 'source' });
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

// GET /api/settings/currency-change-preview?currency=EUR (D369 A5): só `currency`, obrigatório; a moeda é validada no service.
function validateCurrencyPreviewQuery(req, res, next) {
  const unknown = Object.keys(req.query).find((key) => key !== 'currency');
  if (unknown) throw new ValidationError(`Parâmetro desconhecido: ${unknown}`, 'UNKNOWN_FIELD', { field: unknown });
  const { currency } = req.query;
  if (currency === undefined) throw new ValidationError('O parâmetro currency é obrigatório.', 'REQUIRED_FIELD', { field: 'currency' });
  if (typeof currency !== 'string') throw new ValidationError('currency deve ser texto.', 'INVALID_FIELD', { field: 'currency' });
  return next();
}

module.exports = { validateCurrencyPreviewQuery, validateFxRateBody, validatePreferencesBody, validateFxRefreshBody, validateSteamStoreBody };

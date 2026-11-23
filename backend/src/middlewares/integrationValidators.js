'use strict';

// Validação de forma das rotas de integração (D316). Os valores (loja existente e em US$, formato da chave) são checados no service.
const { ValidationError } = require('../errors/AppError');
const { isPlainObject, rejectUnknownFields } = require('./validationHelpers');

const invalidBody = (message) => new ValidationError(message, 'INVALID_BODY');

function requireObjectBody(body) {
  if (!isPlainObject(body)) throw invalidBody('O corpo da requisição deve ser um objeto JSON.');
}

// PATCH: `storeId` (inteiro positivo ou null), `autoImportOnOpen` (booleano, 9.5) e `autoImportPaused` (só `false`: "Reativar" a
// importação ao abrir depois de um desfazer ou de uma troca de conta; pausar é só o app que faz). Pelo menos um campo.
function validateIntegrationPatchBody(req, res, next) {
  const body = req.body;
  requireObjectBody(body);
  rejectUnknownFields(body, ['storeId', 'autoImportOnOpen', 'autoImportPaused']);
  if (body.storeId === undefined && body.autoImportOnOpen === undefined && body.autoImportPaused === undefined) {
    throw invalidBody('Informe o campo storeId, autoImportOnOpen ou autoImportPaused.');
  }
  if (body.storeId !== undefined && body.storeId !== null && (!Number.isInteger(body.storeId) || body.storeId <= 0)) {
    throw new ValidationError('storeId deve ser um inteiro positivo ou nulo.', 'INVALID_FIELD', { field: 'storeId' });
  }
  if (body.autoImportOnOpen !== undefined && typeof body.autoImportOnOpen !== 'boolean') {
    throw new ValidationError('autoImportOnOpen deve ser verdadeiro ou falso.', 'INVALID_FIELD', { field: 'autoImportOnOpen' });
  }
  if (body.autoImportPaused !== undefined && body.autoImportPaused !== false) {
    throw new ValidationError('autoImportPaused só aceita false (reativar).', 'INVALID_FIELD', { field: 'autoImportPaused' });
  }
  return next();
}

// PUT api-key: `{ apiKey }`. O valor nunca aparece em mensagem de erro.
function validateApiKeyBody(req, res, next) {
  const body = req.body;
  requireObjectBody(body);
  rejectUnknownFields(body, ['apiKey']);
  if (body.apiKey === undefined || body.apiKey === null) {
    throw new ValidationError('O campo apiKey é obrigatório.', 'REQUIRED_FIELD', { field: 'apiKey' });
  }
  if (typeof body.apiKey !== 'string') {
    throw new ValidationError('A chave deve ter de 8 a 512 caracteres, sem espaços.', 'INVALID_API_KEY_FORMAT', { field: 'apiKey' });
  }
  return next();
}

// POST test: corpo `{}` (ou vazio).
function validateEmptyBody(req, res, next) {
  const body = req.body === undefined ? {} : req.body;
  requireObjectBody(body);
  rejectUnknownFields(body, []);
  return next();
}

// POST switch-account: `{ confirm: true }`; a falta de confirmação é decidida no service (CONFIRMATION_REQUIRED).
function validateSwitchAccountBody(req, res, next) {
  const body = req.body === undefined ? {} : req.body;
  requireObjectBody(body);
  rejectUnknownFields(body, ['confirm']);
  if (body.confirm !== undefined && typeof body.confirm !== 'boolean') {
    throw new ValidationError('confirm deve ser verdadeiro ou falso.', 'INVALID_FIELD', { field: 'confirm' });
  }
  return next();
}

module.exports = { validateIntegrationPatchBody, validateApiKeyBody, validateEmptyBody, validateSwitchAccountBody };

'use strict';

// Validação de FORMA das rotas de operações (D362 item 10). As regras (estado, limites, datas) ficam nos services.
const { ValidationError } = require('../errors/AppError');
const { isPlainObject, rejectUnknownFields } = require('./validationHelpers');

const fail = (message, code, field) => new ValidationError(message, code, { field });

function wrap(fn) {
  return (req, res, next) => {
    try {
      fn(req);
      next();
    } catch (err) {
      next(err);
    }
  };
}

const isInt = (v) => typeof v === 'number' && Number.isSafeInteger(v);

// Campos de uma aplicação do estoque: `sourceItemId` obrigatório; `slot`, `wear`, `pattern` e `appliedAt` opcionais (nulo = ausente).
function checkApplyFields(body) {
  if (!isInt(body.sourceItemId) || body.sourceItemId < 1) throw fail('Informe a unidade a aplicar (sourceItemId).', 'REQUIRED_FIELD', 'sourceItemId');
  if (body.slot !== undefined && body.slot !== null && !isInt(body.slot)) throw fail('O slot deve ser um número inteiro.', 'INVALID_FIELD', 'slot');
  if (body.pattern !== undefined && body.pattern !== null && !isInt(body.pattern)) throw fail('O pattern deve ser um número inteiro.', 'INVALID_FIELD', 'pattern');
  if (body.wear !== undefined && body.wear !== null && (typeof body.wear !== 'number' || !Number.isFinite(body.wear))) {
    throw fail('O desgaste deve ser um número.', 'INVALID_FIELD', 'wear');
  }
  if (body.appliedAt !== undefined && body.appliedAt !== null && typeof body.appliedAt !== 'string') throw fail('Data inválida.', 'INVALID_FIELD', 'appliedAt');
}

// POST /api/items/:id/apply-component
const validateApplyBody = wrap((req) => {
  const body = req.body;
  if (!isPlainObject(body)) throw fail('O corpo da requisição deve ser um objeto JSON.', 'INVALID_BODY');
  rejectUnknownFields(body, ['sourceItemId', 'slot', 'wear', 'pattern', 'appliedAt']);
  checkApplyFields(body);
});

// POST /api/items/:id/components/:componentId/scrape-off
const validateScrapeBody = wrap((req) => {
  const body = req.body === undefined ? {} : req.body;
  if (!isPlainObject(body)) throw fail('O corpo da requisição deve ser um objeto JSON.', 'INVALID_BODY');
  rejectUnknownFields(body, ['occurredAt']);
  if (body.occurredAt !== undefined && body.occurredAt !== null && typeof body.occurredAt !== 'string') throw fail('Data inválida.', 'INVALID_FIELD', 'occurredAt');
  req.body = body;
});

// POST /api/operations/:id/undo: corpo vazio `{}`.
const validateUndoBody = wrap((req) => {
  const body = req.body === undefined ? {} : req.body;
  if (!isPlainObject(body)) throw fail('O corpo da requisição deve ser um objeto JSON.', 'INVALID_BODY');
  rejectUnknownFields(body, []);
});

// `:componentId` inteiro seguro >= 1.
function validateComponentIdParam(req, res, next) {
  const raw = req.params.componentId;
  const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id < 1) return next(new ValidationError('Identificador inválido.', 'INVALID_ID'));
  req.params.componentId = id;
  return next();
}

module.exports = { validateApplyBody, validateScrapeBody, validateUndoBody, validateComponentIdParam, checkApplyFields };

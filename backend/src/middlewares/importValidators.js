'use strict';

// Validação de forma das rotas de importação (D318 seção 10). Os valores (corte, loja, chave) são checados no service.
const { ValidationError } = require('../errors/AppError');
const { IMPORT_BATCHES_PAGE_SIZE } = require('../config/constants');
const { isPlainObject, rejectUnknownFields } = require('./validationHelpers');

const invalidBody = (message) => new ValidationError(message, 'INVALID_BODY');
const TRIGGERS = ['MANUAL', 'AUTO'];
const MAX_LIMIT = 50;

function requireObjectBody(body) {
  if (!isPlainObject(body)) throw invalidBody('O corpo da requisição deve ser um objeto JSON.');
}

// POST csfloat/run: { trigger?, cutoffAt?, fullScan? }. `cutoffAt` é texto (a data é validada no service).
function validateRunBody(req, res, next) {
  const body = req.body === undefined ? {} : req.body;
  requireObjectBody(body);
  rejectUnknownFields(body, ['trigger', 'cutoffAt', 'fullScan']);
  if (body.trigger !== undefined && !TRIGGERS.includes(body.trigger)) {
    throw new ValidationError('trigger deve ser MANUAL ou AUTO.', 'INVALID_FIELD', { field: 'trigger' });
  }
  if (body.fullScan !== undefined && typeof body.fullScan !== 'boolean') {
    throw new ValidationError('fullScan deve ser verdadeiro ou falso.', 'INVALID_FIELD', { field: 'fullScan' });
  }
  if (body.cutoffAt !== undefined && body.cutoffAt !== null && typeof body.cutoffAt !== 'string') {
    throw new ValidationError('A data de corte é inválida.', 'INVALID_DATE', { field: 'cutoffAt' });
  }
  req.body = body;
  return next();
}

// POST batches/:id/undo: { confirmWarnings? }
function validateUndoBody(req, res, next) {
  const body = req.body === undefined ? {} : req.body;
  requireObjectBody(body);
  rejectUnknownFields(body, ['confirmWarnings']);
  if (body.confirmWarnings !== undefined && typeof body.confirmWarnings !== 'boolean') {
    throw new ValidationError('confirmWarnings deve ser verdadeiro ou falso.', 'INVALID_FIELD', { field: 'confirmWarnings' });
  }
  req.body = body;
  return next();
}

const RESOLVE_ACTIONS = ['REMOVE', 'KEEP', 'CREATE', 'LINK', 'IGNORE'];

// POST entries/:id/resolve: { action, targetId? } (targetId obrigatório só no LINK).
function validateResolveBody(req, res, next) {
  const body = req.body === undefined ? {} : req.body;
  requireObjectBody(body);
  rejectUnknownFields(body, ['action', 'targetId']);
  if (body.action === undefined) throw new ValidationError('Informe a ação.', 'REQUIRED_FIELD', { field: 'action' });
  if (!RESOLVE_ACTIONS.includes(body.action)) {
    throw new ValidationError('Ação inválida.', 'INVALID_FIELD', { field: 'action' });
  }
  if (body.action === 'LINK') {
    if (body.targetId === undefined || body.targetId === null) throw new ValidationError('Escolha o lançamento.', 'REQUIRED_FIELD', { field: 'targetId' });
  }
  if (body.targetId !== undefined && body.targetId !== null && (!Number.isSafeInteger(body.targetId) || body.targetId < 1)) {
    throw new ValidationError('Lançamento inválido.', 'INVALID_FIELD', { field: 'targetId' });
  }
  if (body.action !== 'LINK' && body.targetId !== undefined && body.targetId !== null) {
    throw new ValidationError('targetId só vale para LINK.', 'INVALID_FIELD', { field: 'targetId' });
  }
  req.body = body;
  return next();
}

const invalidQuery = (field) => new ValidationError(`Parâmetro inválido: ${field}.`, 'INVALID_QUERY', { field });

// GET batches?limit=20&before=<id>: guarda `req.importQuery` (o `req.query` do Express 5 é só leitura).
function validateBatchesQuery(req, res, next) {
  const { limit, before, ...rest } = req.query;
  const unknown = Object.keys(rest)[0];
  if (unknown) throw invalidQuery(unknown);
  let parsedLimit = IMPORT_BATCHES_PAGE_SIZE;
  if (limit !== undefined) {
    if (typeof limit !== 'string' || !/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > MAX_LIMIT) throw invalidQuery('limit');
    parsedLimit = Number(limit);
  }
  let parsedBefore = null;
  if (before !== undefined) {
    if (typeof before !== 'string' || !/^\d{1,15}$/.test(before) || Number(before) < 1) throw invalidQuery('before');
    parsedBefore = Number(before);
  }
  req.importQuery = { limit: parsedLimit, before: parsedBefore };
  return next();
}

// GET entries?open=true: `open` só aceita `true`.
function validateEntriesQuery(req, res, next) {
  const { open, ...rest } = req.query;
  const unknown = Object.keys(rest)[0];
  if (unknown) throw invalidQuery(unknown);
  if (open !== 'true') throw invalidQuery('open');
  return next();
}

module.exports = { validateRunBody, validateUndoBody, validateResolveBody, validateBatchesQuery, validateEntriesQuery };

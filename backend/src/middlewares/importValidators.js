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
  // A automática (9.5) só busca o que é novo: sem corte (precisa já existir) e sem varredura completa.
  if (body.trigger === 'AUTO') {
    if (body.cutoffAt !== undefined && body.cutoffAt !== null) {
      throw new ValidationError('A importação automática não define a data de corte.', 'INVALID_FIELD', { field: 'cutoffAt' });
    }
    if (body.fullScan === true) {
      throw new ValidationError('A importação automática não faz varredura completa.', 'INVALID_FIELD', { field: 'fullScan' });
    }
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

const { RESOLVE_ACTIONS, BULK_ACTIONS } = require('../services/imports/entryActions');
const { checkApplyFields } = require('./operationValidators');

const PURCHASE_FIELDS = ['purchaseStoreId', 'purchasePriceCents', 'fxRateAtPurchase', 'acquiredAt', 'tradeUnlockAt'];
const isNilValue = (v) => v === undefined || v === null;
const optionalDateText = (value, field) => {
  if (!isNilValue(value) && typeof value !== 'string') throw new ValidationError('Data inválida.', 'INVALID_DATE', { field });
};

// `purchase` de "Lançar compra" (D327): só os campos que o usuário informa; a identidade do item vem da pendência.
function validatePurchase(purchase) {
  if (!isPlainObject(purchase)) throw new ValidationError('Informe os dados da compra.', 'REQUIRED_FIELD', { field: 'purchase' });
  const extra = Object.keys(purchase).find((key) => !PURCHASE_FIELDS.includes(key));
  if (extra) throw new ValidationError(`Campo desconhecido: ${extra}`, 'UNKNOWN_FIELD', { field: extra });
  if (!Number.isSafeInteger(purchase.purchaseStoreId) || purchase.purchaseStoreId < 1) {
    throw new ValidationError('Informe a loja da compra.', 'PURCHASE_STORE_REQUIRED', { field: 'purchaseStoreId' });
  }
  if (!Number.isSafeInteger(purchase.purchasePriceCents) || purchase.purchasePriceCents < 0) {
    throw new ValidationError('Informe o preço da compra.', 'PURCHASE_PRICE_REQUIRED', { field: 'purchasePriceCents' });
  }
  if (!isNilValue(purchase.fxRateAtPurchase) && (typeof purchase.fxRateAtPurchase !== 'number' || !Number.isFinite(purchase.fxRateAtPurchase))) {
    throw new ValidationError('Cotação inválida.', 'INVALID_FX_RATE', { field: 'fxRateAtPurchase' });
  }
  if (typeof purchase.acquiredAt !== 'string') throw new ValidationError('Informe a data da compra.', 'REQUIRED_FIELD', { field: 'acquiredAt' });
  optionalDateText(purchase.tradeUnlockAt, 'tradeUnlockAt');
}

// POST entries/:id/resolve: { action, targetId? (LINK), purchase + confirmWarnings? (CREATE_PURCHASE), acquiredAt? (MARK_WON) }.
function validateResolveBody(req, res, next) {
  const body = req.body === undefined ? {} : req.body;
  requireObjectBody(body);
  rejectUnknownFields(body, ['action', 'targetId', 'purchase', 'confirmWarnings', 'purchaseOnly', 'acquiredAt', 'sourceItemId', 'appliedAt', 'slot', 'wear', 'pattern']);
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
  if (body.action === 'CREATE_PURCHASE') validatePurchase(body.purchase);
  else if (body.purchase !== undefined) throw new ValidationError('purchase só vale para CREATE_PURCHASE.', 'INVALID_FIELD', { field: 'purchase' });
  if (body.confirmWarnings !== undefined && (body.action !== 'CREATE_PURCHASE' || typeof body.confirmWarnings !== 'boolean')) {
    throw new ValidationError('confirmWarnings só vale para CREATE_PURCHASE (verdadeiro ou falso).', 'INVALID_FIELD', { field: 'confirmWarnings' });
  }
  if (body.purchaseOnly !== undefined && (body.action !== 'CREATE_PURCHASE' || typeof body.purchaseOnly !== 'boolean')) {
    throw new ValidationError('purchaseOnly só vale para CREATE_PURCHASE (verdadeiro ou falso).', 'INVALID_FIELD', { field: 'purchaseOnly' });
  }
  if (body.acquiredAt !== undefined && body.action !== 'MARK_WON') {
    throw new ValidationError('acquiredAt só vale para MARK_WON.', 'INVALID_FIELD', { field: 'acquiredAt' });
  }
  optionalDateText(body.acquiredAt, 'acquiredAt');
  const applyKeys = ['sourceItemId', 'appliedAt', 'slot', 'wear', 'pattern'];
  if (body.action === 'APPLY_FROM_STOCK') {
    checkApplyFields(body);
    if (typeof body.appliedAt !== 'string') throw new ValidationError('Informe a data da aplicação.', 'REQUIRED_FIELD', { field: 'appliedAt' });
  } else {
    const stray = applyKeys.find((key) => body[key] !== undefined);
    if (stray) throw new ValidationError(`${stray} só vale para APPLY_FROM_STOCK.`, 'INVALID_FIELD', { field: stray });
  }
  req.body = body;
  return next();
}

// POST entries/:id/reopen: corpo `{}`.
function validateEmptyBody(req, res, next) {
  const body = req.body === undefined ? {} : req.body;
  requireObjectBody(body);
  rejectUnknownFields(body, []);
  req.body = body;
  return next();
}

// POST entries/bulk-resolve: { action: MARK_WON | IGNORE | REOPEN, entryIds: [1..200 ids], acquiredAt? (só MARK_WON) }.
function validateBulkResolveBody(req, res, next) {
  const body = req.body;
  requireObjectBody(body);
  rejectUnknownFields(body, ['action', 'entryIds', 'acquiredAt']);
  if (body.action === undefined) throw new ValidationError('Informe a ação.', 'REQUIRED_FIELD', { field: 'action' });
  if (!BULK_ACTIONS.includes(body.action)) throw new ValidationError('Ação inválida para o lote.', 'INVALID_FIELD', { field: 'action' });
  const ids = body.entryIds;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 200 || !ids.every((id) => Number.isSafeInteger(id) && id > 0)
    || new Set(ids).size !== ids.length) {
    throw new ValidationError('entryIds deve ter de 1 a 200 ids inteiros positivos, sem repetição.', 'INVALID_FIELD', { field: 'entryIds' });
  }
  if (body.acquiredAt !== undefined && body.action !== 'MARK_WON') {
    throw new ValidationError('acquiredAt só vale para MARK_WON.', 'INVALID_FIELD', { field: 'acquiredAt' });
  }
  optionalDateText(body.acquiredAt, 'acquiredAt');
  return next();
}

// POST csfloat/change-cutoff: { cutoffAt, confirm } (a data é validada no service). Uma só data de corte (Revisão 28).
function validateChangeCutoffBody(req, res, next) {
  const body = req.body;
  requireObjectBody(body);
  rejectUnknownFields(body, ['cutoffAt', 'confirm']);
  if (body.cutoffAt !== undefined && body.cutoffAt !== null && typeof body.cutoffAt !== 'string') {
    throw new ValidationError('A data de corte é inválida.', 'INVALID_DATE', { field: 'cutoffAt' });
  }
  if (body.confirm !== undefined && typeof body.confirm !== 'boolean') {
    throw new ValidationError('confirm deve ser verdadeiro ou falso.', 'INVALID_FIELD', { field: 'confirm' });
  }
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

// GET csfloat/cutoff-preview?cutoffAt=<ISO>
function validateCutoffPreviewQuery(req, res, next) {
  const { cutoffAt, ...rest } = req.query;
  const unknown = Object.keys(rest)[0];
  if (unknown) throw invalidQuery(unknown);
  if (typeof cutoffAt !== 'string' || cutoffAt === '') throw new ValidationError('Informe a data de corte.', 'IMPORT_CUTOFF_REQUIRED', { field: 'cutoffAt' });
  req.importQuery = { cutoffAt };
  return next();
}

// GET entries?open=true (pendências) ou entries?ignored=true (ignoradas, 9.5.1b): exatamente um dos dois, com valor `true`.
function validateEntriesQuery(req, res, next) {
  const { open, ignored, ...rest } = req.query;
  const unknown = Object.keys(rest)[0];
  if (unknown) throw invalidQuery(unknown);
  if (open !== undefined && ignored !== undefined) throw invalidQuery('ignored');
  if (ignored !== undefined) {
    if (ignored !== 'true') throw invalidQuery('ignored');
    req.importQuery = { ignored: true };
    return next();
  }
  if (open !== 'true') throw invalidQuery('open');
  req.importQuery = { ignored: false };
  return next();
}

module.exports = {
  validateRunBody, validateUndoBody, validateResolveBody, validateBulkResolveBody, validateEmptyBody, validateChangeCutoffBody,
  validateCutoffPreviewQuery, validateBatchesQuery, validateEntriesQuery };

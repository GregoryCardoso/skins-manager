'use strict';

// Validação de FORMA das rotas de operações (D362 item 10). As regras (estado, limites, datas) ficam nos services.
const { AppError, ValidationError } = require('../errors/AppError');
const { isPlainObject, rejectUnknownFields } = require('./validationHelpers');
const { checkBody, ACQUISITION_FIELDS } = require('./itemValidators');
const { MAX_AMOUNT_CENTS } = require('../config/constants');

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

// Campos do item obtido na abertura (D363 item 4): os do cadastro, menos os de aquisição (que a operação define). Os de aquisição enviados
// são recusados com `INVALID_OPERATION_INPUT`, antes da validação de forma do resto.
const GENERATED_FORBIDDEN_FIELDS = ['acquisitionType', 'purchaseStoreId', 'purchasePriceCents', 'fxRateAtPurchase', 'acquiredAt'];
const GENERATED_FIELDS = Object.fromEntries(Object.entries(ACQUISITION_FIELDS).filter(([key]) => !GENERATED_FORBIDDEN_FIELDS.includes(key)));
const MAX_NOTE_SHAPE = 2000; // o limite real (500) é do service; aqui só se evita texto gigante

// POST /api/items/:id/open
const validateOpenBody = wrap((req) => {
  const body = req.body;
  if (!isPlainObject(body)) throw fail('O corpo da requisição deve ser um objeto JSON.', 'INVALID_BODY');
  rejectUnknownFields(body, ['keyItemId', 'openedAt', 'decision', 'generated', 'paidPriceCents', 'fxRateAtPurchase', 'note']);
  if (body.keyItemId !== undefined && body.keyItemId !== null && (!isInt(body.keyItemId) || body.keyItemId < 1)) {
    throw fail('A chave deve ser um identificador inteiro.', 'INVALID_FIELD', 'keyItemId');
  }
  if (body.openedAt !== undefined && body.openedAt !== null && typeof body.openedAt !== 'string') throw fail('Data inválida.', 'INVALID_FIELD', 'openedAt');
  if (body.decision !== undefined && body.decision !== null && typeof body.decision !== 'string') throw fail('Decisão inválida.', 'INVALID_FIELD', 'decision');
  if (body.paidPriceCents !== undefined && body.paidPriceCents !== null) {
    if (!isInt(body.paidPriceCents)) throw fail('O preço deve ser um número inteiro de centavos.', 'INVALID_FIELD', 'paidPriceCents');
    if (body.paidPriceCents > MAX_AMOUNT_CENTS) {
      throw new ValidationError('O valor excede o máximo permitido.', 'INVALID_AMOUNT', { field: 'paidPriceCents', params: { maxCents: MAX_AMOUNT_CENTS } });
    }
  }
  if (body.fxRateAtPurchase !== undefined && body.fxRateAtPurchase !== null && (typeof body.fxRateAtPurchase !== 'number' || !Number.isFinite(body.fxRateAtPurchase))) {
    throw fail('A cotação deve ser um número.', 'INVALID_FIELD', 'fxRateAtPurchase');
  }
  if (body.note !== undefined && body.note !== null && (typeof body.note !== 'string' || body.note.length > MAX_NOTE_SHAPE)) {
    throw fail('Observação inválida.', 'INVALID_FIELD', 'note');
  }
  if (body.generated !== undefined && body.generated !== null) {
    if (!isPlainObject(body.generated)) throw fail('O item obtido deve ser um objeto.', 'INVALID_FIELD', 'generated');
    for (const field of GENERATED_FORBIDDEN_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body.generated, field)) {
        throw new AppError(422, 'INVALID_OPERATION_INPUT', 'O item obtido herda a aquisição da abertura; não informe este campo.', {
          field: `generated.${field}`, params: { reason: 'GENERATED_FIELD_NOT_ALLOWED', field },
        });
      }
    }
    checkBody(body.generated, GENERATED_FIELDS, 'create');
  }
});

module.exports = { validateOpenBody, validateApplyBody, validateScrapeBody, validateUndoBody, validateComponentIdParam, checkApplyFields };

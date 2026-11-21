'use strict';

// Saldo estimado em BRL (2.8, 2.10, D163, D165): saldo bruto × cotação das configurações.
// A taxa de saque pertence ao saque e só é registrada quando ele acontece; não entra na estimativa.
// Usado somente no lucro real; nunca no preço mínimo por item.
// Também aqui: regras dos saques (D201, D203). `buildWithdrawalRecord` e `suggestWithdrawalFeeCents` são puros;
// o resto orquestra os models.
const Withdrawal = require('../models/Withdrawal');
const Store = require('../models/Store');
const { ValidationError, NotFoundError } = require('../errors/AppError');
const { MAX_AMOUNT_CENTS, MAX_NOTE_LENGTH } = require('../config/constants');
const { roundCents, applyRateRounding } = require('./fees/rounding');
const { isValidFxRate } = require('./currencyService');
const { parseDate } = require('./dateUtils');
const { assertNotFutureDay } = require('./inventoryAgingService');
const { WARNING_FX, WARNINGS } = require('./warnings');

// `estimated`: true quando o valor em BRL é uma conversão pela cotação; loja em BRL é exata.
// `warning` (texto) e `warningCode` (T48: o frontend traduz pelo código). Conversão com ROUND (T82, D206).
function estimateBalanceBrl({ balanceCents, store, settings }) {
  if (!Number.isSafeInteger(balanceCents) || balanceCents < 0) {
    throw new ValidationError('Saldo deve ser um inteiro de centavos maior ou igual a 0.', 'INVALID_AMOUNT');
  }
  const exact = (estimatedBrlCents) => ({ estimatedBrlCents, estimated: false, warning: null, warningCode: null });
  if (balanceCents === 0) return exact(0);
  if (store.currency === 'BRL') return exact(balanceCents);
  const usdBrlRate = settings ? settings.usdBrlRate : null;
  if (!isValidFxRate(usdBrlRate)) {
    return {
      estimatedBrlCents: null, estimated: true, warning: WARNING_FX, warningCode: WARNINGS.FX_NOT_CONFIGURED.code,
    };
  }
  return {
    estimatedBrlCents: roundCents(balanceCents * usdBrlRate, 'ROUND'), estimated: true, warning: null, warningCode: null,
  };
}

const isNil = (value) => value === null || value === undefined;
const required = (field) => new ValidationError(`O campo ${field} é obrigatório.`, 'REQUIRED_FIELD', { field });

function assertAmount(value, field, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_AMOUNT_CENTS) {
    throw new ValidationError(
      `${label} deve ser um inteiro de centavos maior que 0 e dentro do limite permitido.`, 'INVALID_AMOUNT',
      { field, params: { maxCents: MAX_AMOUNT_CENTS } }
    );
  }
}

// Registro final do saque (puro): gravado + parcial, validado nesta ordem: loja, valor sacado, taxa paga,
// valor recebido, data, nota. `store`: a loja já carregada de `storeId` (null se não encontrada).
// Saque antigo (sem loja) só é editável escolhendo loja e valor (STORE_REQUIRED / REQUIRED_FIELD, D203).
// WITHDRAWAL_NOT_ALLOWED: só ao criar ou ao trocar de loja (E8-Q6); manter a loja gravada é sempre aceito,
// e loja inativa também.
// D221: ao trocar de loja com moeda diferente (ou saque antigo sem loja, moeda anterior desconhecida), o valor sacado
// precisa vir no corpo (`previousStore`: a loja gravada, nula se não havia); a taxa continua validada no registro mesclado.
function buildWithdrawalRecord(input, { existing = null, store = null, previousStore = null, now = new Date() } = {}) {
  const base = existing
    ? {
      storeId: existing.storeId,
      amountStoreCents: existing.amountStoreCents,
      feeCents: existing.feeCents,
      amountBrlCents: existing.amountBrlCents,
      withdrawnAt: existing.withdrawnAt,
      note: existing.note,
    }
    : { storeId: null, amountStoreCents: null, feeCents: null, amountBrlCents: undefined, withdrawnAt: undefined, note: null };
  const record = { ...base };
  for (const field of Object.keys(record)) if (input && input[field] !== undefined) record[field] = input[field];

  // 1. loja
  if (isNil(record.storeId)) {
    throw new ValidationError('A loja do saque é obrigatória.', 'STORE_REQUIRED', { field: 'storeId' });
  }
  if (!store) throw new ValidationError('Loja não encontrada.', 'STORE_NOT_FOUND', { field: 'storeId' });
  const storeChanged = !existing || record.storeId !== existing.storeId;
  if (storeChanged && !store.allowsWithdrawal) {
    throw new ValidationError('Esta loja não permite saque.', 'WITHDRAWAL_NOT_ALLOWED', { field: 'storeId' });
  }

  if (existing && storeChanged && input && input.amountStoreCents === undefined) {
    const currencyKnownAndEqual = previousStore && previousStore.currency === store.currency;
    if (!currencyKnownAndEqual) throw required('amountStoreCents');
  }

  // 2. valor sacado (moeda da loja)
  if (isNil(record.amountStoreCents)) throw required('amountStoreCents');
  assertAmount(record.amountStoreCents, 'amountStoreCents', 'O valor sacado');

  // 3. taxa paga: nula = não informada; 0 = paga zero
  if (isNil(record.feeCents)) record.feeCents = null;
  else {
    if (!Number.isSafeInteger(record.feeCents) || record.feeCents < 0) {
      throw new ValidationError('A taxa paga deve ser um inteiro de centavos maior ou igual a 0.', 'INVALID_AMOUNT', { field: 'feeCents' });
    }
    if (record.feeCents > record.amountStoreCents) {
      throw new ValidationError('A taxa paga não pode ser maior que o valor sacado.', 'WITHDRAWAL_FEE_ABOVE_AMOUNT', { field: 'feeCents' });
    }
  }

  // 4. valor recebido em BRL
  if (isNil(record.amountBrlCents)) throw required('amountBrlCents');
  assertAmount(record.amountBrlCents, 'amountBrlCents', 'O valor recebido');

  // 5. data: normalizada para UTC; um saque já gravado só é revalidado quando a data é alterada
  if (isNil(record.withdrawnAt)) throw required('withdrawnAt');
  if (!existing || (input && input.withdrawnAt !== undefined)) {
    const date = parseDate(record.withdrawnAt, 'Data do saque', { field: 'withdrawnAt' });
    assertNotFutureDay(date, now, {
      code: 'WITHDRAWN_AT_IN_FUTURE', message: 'A data do saque não pode ser futura.', field: 'withdrawnAt',
    });
    record.withdrawnAt = date.toISOString();
  }

  // 6. nota: trim; vazia vira nulo
  if (!isNil(record.note)) {
    if (typeof record.note !== 'string') {
      throw new ValidationError('O campo note tem um tipo inválido.', 'INVALID_FIELD', { field: 'note' });
    }
    const note = record.note.trim();
    if (note.length > MAX_NOTE_LENGTH) {
      throw new ValidationError(
        `A observação deve ter no máximo ${MAX_NOTE_LENGTH} caracteres.`, 'FIELD_TOO_LONG',
        { field: 'note', params: { maxLength: MAX_NOTE_LENGTH } }
      );
    }
    record.note = note === '' ? null : note;
  } else record.note = null;
  return record;
}

// Sugestão de taxa paga (D166 a, E8-Q12), só para pré-preencher o formulário; não entra em nenhum cálculo.
// min(arredondar para cima(valor × taxa da loja) + taxa fixa, valor). Sem taxa configurada: nulo + aviso.
function suggestWithdrawalFeeCents(amountStoreCents, store) {
  if (!Number.isSafeInteger(amountStoreCents) || amountStoreCents < 1 || amountStoreCents > MAX_AMOUNT_CENTS) {
    throw new ValidationError(
      'O valor sacado deve ser um inteiro de centavos maior que 0.', 'INVALID_AMOUNT', { field: 'amountStoreCents' }
    );
  }
  const rate = store ? store.withdrawalFeeRate : null;
  if (isNil(rate)) return { suggestedFeeCents: null, warningCode: WARNINGS.FEES_NOT_CONFIGURED.code };
  const fixed = store.withdrawalFixedFeeCents || 0;
  const suggested = Math.min(applyRateRounding(amountStoreCents, rate, 'CEIL') + fixed, amountStoreCents);
  return { suggestedFeeCents: suggested, warningCode: null };
}

function toWithdrawalView(row, storesById) {
  const store = isNil(row.storeId) ? null : storesById.get(row.storeId);
  return {
    id: row.id,
    storeId: row.storeId,
    storeName: store ? store.name : null,
    currency: store ? store.currency : null,
    amountStoreCents: row.amountStoreCents,
    feeCents: row.feeCents,
    amountBrlCents: row.amountBrlCents,
    withdrawnAt: row.withdrawnAt,
    note: row.note,
    legacyWithoutStore: isNil(row.storeId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const storesMap = () => new Map(Store.findAll().map((store) => [store.id, store]));
const loadStore = (storeId) => (isNil(storeId) ? null : Store.findById(storeId));

function findOrFail(id) {
  const withdrawal = Withdrawal.findById(id);
  if (!withdrawal) throw new NotFoundError('Saque não encontrado.', 'WITHDRAWAL_NOT_FOUND');
  return withdrawal;
}

function listWithdrawals() {
  const stores = storesMap();
  const rows = Withdrawal.findAll(); // withdrawnAt DESC, id DESC
  return {
    withdrawals: rows.map((row) => toWithdrawalView(row, stores)),
    totals: { count: rows.length, amountBrlCents: rows.reduce((sum, row) => sum + row.amountBrlCents, 0) },
  };
}

function createWithdrawal(input, { now = new Date() } = {}) {
  const record = buildWithdrawalRecord(input, { store: loadStore(input.storeId), now });
  return toWithdrawalView(Withdrawal.create(record, { now }), storesMap());
}

function updateWithdrawal(id, partial, { now = new Date() } = {}) {
  const existing = findOrFail(id);
  const storeId = partial.storeId !== undefined ? partial.storeId : existing.storeId;
  const record = buildWithdrawalRecord(partial, { existing, store: loadStore(storeId), previousStore: loadStore(existing.storeId), now });
  return toWithdrawalView(Withdrawal.update(id, record, { now }), storesMap());
}

function deleteWithdrawal(id) {
  findOrFail(id);
  Withdrawal.remove(id);
  return { id };
}

// Loja inexistente na consulta: 400 STORE_NOT_FOUND com field (referência na query, como no corpo).
function getFeeSuggestion({ storeId, amountStoreCents }) {
  const store = Store.findById(storeId);
  if (!store) throw new ValidationError('Loja não encontrada.', 'STORE_NOT_FOUND', { field: 'storeId' });
  return { storeId, amountStoreCents, ...suggestWithdrawalFeeCents(amountStoreCents, store) };
}

module.exports = {
  estimateBalanceBrl,
  buildWithdrawalRecord,
  suggestWithdrawalFeeCents,
  toWithdrawalView,
  listWithdrawals,
  createWithdrawal,
  updateWithdrawal,
  deleteWithdrawal,
  getFeeSuggestion,
};

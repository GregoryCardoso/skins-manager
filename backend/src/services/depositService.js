'use strict';

// Regras dos aportes (D201, D202). `buildDepositRecord` é puro; o resto orquestra os models.
// O aporte é sempre em BRL; a loja é só informativa e não define moeda (2.8).
const Deposit = require('../models/Deposit');
const Store = require('../models/Store');
const { ValidationError, NotFoundError } = require('../errors/AppError');
const { MAX_AMOUNT_CENTS, MAX_NOTE_LENGTH } = require('../config/constants');
const { parseDate } = require('./dateUtils');
const { assertNotFutureDay } = require('./inventoryAgingService');

const isNil = (value) => value === null || value === undefined;

const required = (field) => new ValidationError(`O campo ${field} é obrigatório.`, 'REQUIRED_FIELD', { field });

// Registro final do aporte (puro): gravado + parcial, validado nesta ordem: valor, data, nota, loja.
// `input`: campos informados (create: todos; update: só os alterados). `store`: a loja já carregada de `storeId`
// (null sem loja); a existência é conferida pelo orquestrador. Devolve só as colunas do model.
function buildDepositRecord(input, { existing = null, store = null, now = new Date() } = {}) {
  const base = existing
    ? { amountBrlCents: existing.amountBrlCents, depositedAt: existing.depositedAt, storeId: existing.storeId, note: existing.note }
    : { amountBrlCents: undefined, depositedAt: undefined, storeId: null, note: null };
  const record = { ...base };
  for (const field of Object.keys(record)) if (input && input[field] !== undefined) record[field] = input[field];

  // 1. valor
  if (isNil(record.amountBrlCents)) throw required('amountBrlCents');
  if (!Number.isSafeInteger(record.amountBrlCents) || record.amountBrlCents < 1 || record.amountBrlCents > MAX_AMOUNT_CENTS) {
    throw new ValidationError(
      'O valor deve ser um inteiro de centavos maior que 0 e dentro do limite permitido.', 'INVALID_AMOUNT',
      { field: 'amountBrlCents', params: { maxCents: MAX_AMOUNT_CENTS } }
    );
  }

  // 2. data: normalizada para UTC; um aporte já gravado só é revalidado quando a data é alterada
  if (isNil(record.depositedAt)) throw required('depositedAt');
  if (!existing || (input && input.depositedAt !== undefined)) {
    const date = parseDate(record.depositedAt, 'Data do aporte', { field: 'depositedAt' });
    assertNotFutureDay(date, now, {
      code: 'DEPOSITED_AT_IN_FUTURE', message: 'A data do aporte não pode ser futura.', field: 'depositedAt',
    });
    record.depositedAt = date.toISOString();
  }

  // 3. nota: trim; vazia vira nulo
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
  }

  // 4. loja (informativa): se há id, a loja precisa ter sido encontrada
  if (!isNil(record.storeId) && !store) {
    throw new ValidationError('Loja não encontrada.', 'STORE_NOT_FOUND', { field: 'storeId' });
  }
  if (isNil(record.storeId)) record.storeId = null;
  return record;
}

function toDepositView(row, storesById) {
  const store = row.storeId === null ? null : storesById.get(row.storeId);
  return {
    id: row.id,
    amountBrlCents: row.amountBrlCents,
    depositedAt: row.depositedAt,
    storeId: row.storeId,
    storeName: store ? store.name : null,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const storesMap = () => new Map(Store.findAll().map((store) => [store.id, store]));

function findOrFail(id) {
  const deposit = Deposit.findById(id);
  if (!deposit) throw new NotFoundError('Aporte não encontrado.', 'DEPOSIT_NOT_FOUND');
  return deposit;
}

// Loja do corpo: só consulta quando há id (nulo = sem loja).
const loadStore = (storeId) => (isNil(storeId) ? null : Store.findById(storeId));

function listDeposits() {
  const stores = storesMap();
  const rows = Deposit.findAll(); // depositedAt DESC, id DESC
  return {
    deposits: rows.map((row) => toDepositView(row, stores)),
    totals: { count: rows.length, amountBrlCents: rows.reduce((sum, row) => sum + row.amountBrlCents, 0) },
  };
}

function createDeposit(input, { now = new Date() } = {}) {
  const record = buildDepositRecord(input, { store: loadStore(input.storeId), now });
  const created = Deposit.create(record, { now });
  return toDepositView(created, storesMap());
}

function updateDeposit(id, partial, { now = new Date() } = {}) {
  const existing = findOrFail(id);
  const storeId = partial.storeId !== undefined ? partial.storeId : existing.storeId;
  const record = buildDepositRecord(partial, { existing, store: loadStore(storeId), now });
  const updated = Deposit.update(id, record, { now });
  return toDepositView(updated, storesMap());
}

function deleteDeposit(id) {
  findOrFail(id);
  Deposit.remove(id);
  return { id };
}

module.exports = { buildDepositRecord, toDepositView, listDeposits, createDeposit, updateDeposit, deleteDeposit };

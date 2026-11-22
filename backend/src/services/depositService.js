'use strict';

// Regras dos aportes (D201, D202, D227, D232). `buildDepositRecord` é puro; o resto orquestra os models.
// O aporte é registrado na moeda da loja (só lojas em USD, E8-Q16): `amountStoreCents` é o valor creditado e entra no
// lucro real; `amountBrlCents` (pago em R$) é opcional e só informativo. Aporte legado (v7) = `amountStoreCents` nulo.
const Deposit = require('../models/Deposit');
const Store = require('../models/Store');
const Setting = require('../models/Setting');
const { ValidationError, NotFoundError } = require('../errors/AppError');
const { MAX_AMOUNT_CENTS, MAX_NOTE_LENGTH } = require('../config/constants');
const { parseDate } = require('./dateUtils');
const { assertNotFutureDay } = require('./inventoryAgingService');
const { toUsdBase, approxBrlOf } = require('./currencyService');

const isNil = (value) => value === null || value === undefined;
const addNullable = (a, b) => (a === null || b === null ? null : a + b);

const required = (field) => new ValidationError(`O campo ${field} é obrigatório.`, 'REQUIRED_FIELD', { field });

function assertAmount(value, field, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_AMOUNT_CENTS) {
    throw new ValidationError(
      `${label} deve ser um inteiro de centavos maior que 0 e dentro do limite permitido.`, 'INVALID_AMOUNT',
      { field, params: { maxCents: MAX_AMOUNT_CENTS } }
    );
  }
}

// Registro final do aporte (puro): gravado + parcial, validado nesta ordem: loja, moeda da loja, valor creditado,
// valor pago em R$, data, nota. `store`: a loja já carregada de `storeId` (null se não encontrada).
// Qualquer edição de um aporte legado exige loja e `amountStoreCents` no registro mesclado (D224).
// Loja inativa é aceita (registro de aporte antigo); "permite saque" não importa.
function buildDepositRecord(input, { existing = null, store = null, now = new Date() } = {}) {
  const base = existing
    ? {
      storeId: existing.storeId,
      amountStoreCents: existing.amountStoreCents,
      amountBrlCents: existing.amountBrlCents,
      depositedAt: existing.depositedAt,
      note: existing.note,
    }
    : { storeId: null, amountStoreCents: null, amountBrlCents: null, depositedAt: undefined, note: null };
  const record = { ...base };
  for (const field of Object.keys(record)) if (input && input[field] !== undefined) record[field] = input[field];

  // 1. loja
  if (isNil(record.storeId)) {
    throw new ValidationError('A loja do aporte é obrigatória.', 'STORE_REQUIRED', { field: 'storeId' });
  }
  if (!store) throw new ValidationError('Loja não encontrada.', 'STORE_NOT_FOUND', { field: 'storeId' });

  // 2. moeda da loja (E8-Q16): só USD
  if (store.currency !== 'USD') {
    throw new ValidationError(
      'O aporte só pode ser registrado em loja em dólar (USD).', 'DEPOSIT_STORE_CURRENCY_NOT_ALLOWED', { field: 'storeId' }
    );
  }

  // 3. valor creditado na loja
  if (isNil(record.amountStoreCents)) throw required('amountStoreCents');
  assertAmount(record.amountStoreCents, 'amountStoreCents', 'O valor creditado');

  // 4. valor pago em R$ (opcional, só informativo)
  if (isNil(record.amountBrlCents)) record.amountBrlCents = null;
  else assertAmount(record.amountBrlCents, 'amountBrlCents', 'O valor pago');

  // 5. data: normalizada para UTC; um aporte já gravado só é revalidado quando a data é alterada
  if (isNil(record.depositedAt)) throw required('depositedAt');
  if (!existing || (input && input.depositedAt !== undefined)) {
    const date = parseDate(record.depositedAt, 'Data do aporte', { field: 'depositedAt' });
    assertNotFutureDay(date, now, {
      code: 'DEPOSITED_AT_IN_FUTURE', message: 'A data do aporte não pode ser futura.', field: 'depositedAt',
    });
    record.depositedAt = date.toISOString();
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

// Valor do aporte na moeda base (D225, D227): o creditado na loja (USD, exato) ou, no legado, o valor em R$ convertido (≈).
function depositBaseAmount(deposit, store, usdBrlRate) {
  if (isNil(deposit.amountStoreCents)) return toUsdBase(deposit.amountBrlCents, 'BRL', usdBrlRate);
  // Loja referenciada que não está no mapa: a moeda é desconhecida, então não se assume USD (o lucro fica nulo).
  if (!isNil(deposit.storeId) && !store) return { usdCents: null, approxBrlCents: null, estimated: false };
  return toUsdBase(deposit.amountStoreCents, store ? store.currency : 'USD', usdBrlRate);
}

function toDepositView(row, storesById, usdBrlRate = null) {
  const store = row.storeId === null ? null : storesById.get(row.storeId);
  const base = depositBaseAmount(row, store, usdBrlRate);
  return {
    id: row.id,
    storeId: row.storeId,
    storeName: store ? store.name : null,
    currency: store ? store.currency : null,
    amountStoreCents: row.amountStoreCents,
    amountBrlCents: row.amountBrlCents,
    depositedAt: row.depositedAt,
    note: row.note,
    legacy: isNil(row.amountStoreCents),
    amountUsdCents: base.usdCents,
    approxBrlCents: base.approxBrlCents,
    estimated: base.estimated,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const storesMap = () => new Map(Store.findAll().map((store) => [store.id, store]));
const currentRate = () => Setting.get().usdBrlRate;

function findOrFail(id) {
  const deposit = Deposit.findById(id);
  if (!deposit) throw new NotFoundError('Aporte não encontrado.', 'DEPOSIT_NOT_FOUND');
  return deposit;
}

// Loja do corpo: só consulta quando há id (nulo = sem loja).
const loadStore = (storeId) => (isNil(storeId) ? null : Store.findById(storeId));

function listDeposits() {
  const stores = storesMap();
  const rate = currentRate();
  const rows = Deposit.findAll(); // depositedAt DESC, id DESC
  const views = rows.map((row) => toDepositView(row, stores, rate));
  const amountUsdCents = views.reduce((acc, view) => addNullable(acc, view.amountUsdCents), 0);
  return {
    deposits: views,
    totals: {
      count: views.length,
      legacyCount: views.filter((view) => view.legacy).length,
      amountUsdCents,
      approxBrlCents: approxBrlOf(amountUsdCents, rate),
      estimated: views.some((view) => view.estimated),
    },
  };
}

function createDeposit(input, { now = new Date() } = {}) {
  const record = buildDepositRecord(input, { store: loadStore(input.storeId), now });
  const created = Deposit.create(record, { now });
  return toDepositView(created, storesMap(), currentRate());
}

function updateDeposit(id, partial, { now = new Date() } = {}) {
  const existing = findOrFail(id);
  const storeId = partial.storeId !== undefined ? partial.storeId : existing.storeId;
  const record = buildDepositRecord(partial, { existing, store: loadStore(storeId), now });
  const updated = Deposit.update(id, record, { now });
  return toDepositView(updated, storesMap(), currentRate());
}

function deleteDeposit(id) {
  findOrFail(id);
  Deposit.remove(id);
  return { id };
}

module.exports = { buildDepositRecord, depositBaseAmount, toDepositView, listDeposits, createDeposit, updateDeposit, deleteDeposit };

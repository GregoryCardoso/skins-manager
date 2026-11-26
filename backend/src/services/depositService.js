'use strict';

// Regras dos aportes (D201, D202, D227, D232). `buildDepositRecord` é puro; o resto orquestra os models.
// O aporte é registrado na moeda da loja (só lojas em USD, E8-Q16): `amountStoreCents` é o valor creditado e entra no
// lucro real; `amountBrlCents` (pago em R$) é opcional e só informativo. Aporte legado (v7) = `amountStoreCents` nulo.
// Taxa do aporte (D311, 9.6): `feeCents` opcional (nula = não informada, conta 0). O saldo da loja recebe só o creditado; o
// "total colocado" e o lucro real usam o creditado + a taxa (a taxa foi um custo real).
const Deposit = require('../models/Deposit');
const Store = require('../models/Store');
const Setting = require('../models/Setting');
const { ValidationError, NotFoundError } = require('../errors/AppError');
const { maxAmountCents, MAX_NOTE_LENGTH, CURRENCIES } = require('../config/constants');
const { parseDate } = require('./dateUtils');
const { assertNotFutureDay } = require('./inventoryAgingService');
const { toUsdBase, approxOf, fxFromSettings, displayCurrencyOf, assertAmountPrecision } = require('./currencyService');
const externalLinkService = require('./externalLinkService');
const { runInTransaction } = require('../models/modelHelpers');

const isNil = (value) => value === null || value === undefined;
const addNullable = (a, b) => (a === null || b === null ? null : a + b);

const required = (field) => new ValidationError(`O campo ${field} é obrigatório.`, 'REQUIRED_FIELD', { field });

// `currency`: a moeda do valor; cada moeda tem o seu teto (11.11, complemento). Moeda desconhecida usa o maior teto (a moeda é validada à parte).
function assertAmount(value, field, label, currency) {
  const maxCents = maxAmountCents(currency);
  if (!Number.isSafeInteger(value) || value < 1 || value > maxCents) {
    throw new ValidationError(
      `${label} deve ser um inteiro de centavos maior que 0 e dentro do limite permitido.`, 'INVALID_AMOUNT',
      { field, params: { maxCents, currency } }
    );
  }
}

// Registro final do aporte (puro): gravado + parcial, validado nesta ordem: loja, moeda da loja, valor creditado,
// valor pago em R$, data, nota. `store`: a loja já carregada de `storeId` (null se não encontrada).
// Qualquer edição de um aporte legado exige loja e `amountStoreCents` no registro mesclado (D224).
// Loja inativa é aceita (registro de aporte antigo); "permite saque" não importa.
function buildDepositRecord(input, { existing = null, store = null, now = new Date(), displayCurrency = 'BRL' } = {}) {
  const base = existing
    ? {
      storeId: existing.storeId,
      amountStoreCents: existing.amountStoreCents,
      feeCents: existing.feeCents ?? null,
      amountBrlCents: existing.amountBrlCents,
      amountBrlCurrency: existing.amountBrlCurrency ?? 'BRL',
      depositedAt: existing.depositedAt,
      note: existing.note,
    }
    : { storeId: null, amountStoreCents: null, feeCents: null, amountBrlCents: null, amountBrlCurrency: null, depositedAt: undefined, note: null };
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
  assertAmount(record.amountStoreCents, 'amountStoreCents', 'O valor creditado', store.currency);

  // 3b. taxa do aporte (D311): nula = não informada; 0 = paga zero
  if (isNil(record.feeCents)) record.feeCents = null;
  else if (!Number.isSafeInteger(record.feeCents) || record.feeCents < 0 || record.feeCents > maxAmountCents(store.currency)) {
    throw new ValidationError('A taxa do aporte deve ser um inteiro de centavos maior ou igual a 0.', 'INVALID_FEE', {
      field: 'feeCents', params: { maxCents: maxAmountCents(store.currency), currency: store.currency },
    });
  }

  // 4. valor pago em R$ (opcional, só informativo)
  // Moeda do valor pago (E-P3-Q15): a informada; senão a já gravada (edição) ou a moeda de conversão de agora (registro novo).
  if (isNil(record.amountBrlCents)) {
    record.amountBrlCents = null;
    record.amountBrlCurrency = existing && existing.amountBrlCurrency ? existing.amountBrlCurrency : 'BRL';
  } else {
    if (isNil(input && input.amountBrlCurrency)) {
      record.amountBrlCurrency = existing && !isNil(existing.amountBrlCents) && existing.amountBrlCurrency ? existing.amountBrlCurrency : displayCurrency;
    } else record.amountBrlCurrency = input.amountBrlCurrency;
    assertAmount(record.amountBrlCents, 'amountBrlCents', 'O valor pago', record.amountBrlCurrency);
    if (!CURRENCIES.includes(record.amountBrlCurrency)) {
      throw new ValidationError(`Moeda inválida. Use ${CURRENCIES.join(', ')}.`, 'INVALID_CURRENCY', { field: 'amountBrlCurrency' });
    }
    assertAmountPrecision(record.amountBrlCents, record.amountBrlCurrency, 'amountBrlCents');
  }

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

// Valor do aporte na moeda base (D225, D227, D311): o creditado na loja + a taxa (USD, exato; "total colocado") ou, no legado,
// o valor em R$ convertido (≈, sem taxa).
function depositBaseAmount(deposit, store, fx) {
  if (isNil(deposit.amountStoreCents)) return toUsdBase(deposit.amountBrlCents, deposit.amountBrlCurrency ?? 'BRL', fx);
  // Loja referenciada que não está no mapa: a moeda é desconhecida, então não se assume USD (o lucro fica nulo).
  if (!isNil(deposit.storeId) && !store) return { usdCents: null, approxCents: null, approxCurrency: displayCurrencyOf(fx), estimated: false };
  return toUsdBase(deposit.amountStoreCents + (deposit.feeCents ?? 0), store ? store.currency : 'USD', fx);
}

function toDepositView(row, storesById, fx = null) {
  const store = row.storeId === null ? null : storesById.get(row.storeId);
  const base = depositBaseAmount(row, store, fx);
  return {
    id: row.id,
    storeId: row.storeId,
    storeName: store ? store.name : null,
    currency: store ? store.currency : null,
    amountStoreCents: row.amountStoreCents,
    feeCents: row.feeCents ?? null,
    amountBrlCents: row.amountBrlCents,
    amountBrlCurrency: row.amountBrlCurrency ?? 'BRL',
    depositedAt: row.depositedAt,
    note: row.note,
    legacy: isNil(row.amountStoreCents),
    amountUsdCents: base.usdCents,
    approxCents: base.approxCents,
    approxCurrency: base.approxCurrency,
    estimated: base.estimated,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const storesMap = () => new Map(Store.findAll().map((store) => [store.id, store]));
const currentFx = () => fxFromSettings(Setting.get());

function findOrFail(id) {
  const deposit = Deposit.findById(id);
  if (!deposit) throw new NotFoundError('Aporte não encontrado.', 'DEPOSIT_NOT_FOUND');
  return deposit;
}

// Loja do corpo: só consulta quando há id (nulo = sem loja).
const loadStore = (storeId) => (isNil(storeId) ? null : Store.findById(storeId));

function listDeposits() {
  const stores = storesMap();
  const fx = currentFx();
  const rows = Deposit.findAll(); // depositedAt DESC, id DESC
  const views = rows.map((row) => toDepositView(row, stores, fx));
  const amountUsdCents = views.reduce((acc, view) => addNullable(acc, view.amountUsdCents), 0);
  return {
    deposits: views,
    totals: {
      count: views.length,
      legacyCount: views.filter((view) => view.legacy).length,
      // Soma das taxas de aporte informadas (na moeda da loja, USD) e quantos aportes não informaram a taxa (D311).
      feeCents: views.reduce((acc, view) => acc + (view.legacy ? 0 : view.feeCents ?? 0), 0),
      feeMissingCount: views.filter((view) => !view.legacy && view.feeCents === null).length,
      amountUsdCents,
      approxCents: approxOf(amountUsdCents, fx),
      approxCurrency: displayCurrencyOf(fx),
      estimated: views.some((view) => view.estimated),
    },
  };
}

function createDeposit(input, { now = new Date() } = {}) {
  const record = buildDepositRecord(input, { store: loadStore(input.storeId), now, displayCurrency: Setting.get().displayCurrency });
  const created = Deposit.create(record, { now });
  return toDepositView(created, storesMap(), currentFx());
}

function updateDeposit(id, partial, { now = new Date() } = {}) {
  const existing = findOrFail(id);
  const storeId = partial.storeId !== undefined ? partial.storeId : existing.storeId;
  const record = buildDepositRecord(partial, { existing, store: loadStore(storeId), now, displayCurrency: Setting.get().displayCurrency });
  const updated = Deposit.update(id, record, { now });
  return toDepositView(updated, storesMap(), currentFx());
}

// Excluir um aporte importado desliga o vínculo e marca o registro externo como REMOVED_IN_APP (não volta a ser importado).
function deleteDeposit(id, { now = new Date() } = {}) {
  findOrFail(id);
  return runInTransaction(() => {
    externalLinkService.detachOnRemove('DEPOSIT', id, { now });
    Deposit.remove(id);
    return { id };
  });
}

module.exports = { buildDepositRecord, depositBaseAmount, toDepositView, listDeposits, createDeposit, updateDeposit, deleteDeposit };

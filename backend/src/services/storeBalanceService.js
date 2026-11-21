'use strict';

// Saldos das lojas (D200, D204, D215, D216). O saldo registrado é o DISPONÍVEL, digitado pelo usuário (histórico
// append-only). O pendente e o liberado após o último registro são calculados na hora pelas vendas com retenção.
// `buildStoreBalanceRecord` e `buildCurrentBalances` são puros; o resto orquestra os models.
const StoreBalance = require('../models/StoreBalance');
const Store = require('../models/Store');
const Item = require('../models/Item');
const Withdrawal = require('../models/Withdrawal');
const Setting = require('../models/Setting');
const { ValidationError, NotFoundError } = require('../errors/AppError');
const { MAX_AMOUNT_CENTS } = require('../config/constants');
const { parseDate } = require('./dateUtils');
const { assertNotFutureDay } = require('./inventoryAgingService');
const { estimateBalanceBrl } = require('./withdrawalService');
const { isValidFxRate } = require('./currencyService');
const { computeHeldSalesForStore } = require('./saleHoldService');
const { WARNINGS } = require('./warnings');

const isNil = (value) => value === null || value === undefined;
const required = (field) => new ValidationError(`O campo ${field} é obrigatório.`, 'REQUIRED_FIELD', { field });
const addNullable = (a, b) => (a === null || b === null ? null : a + b);

// Registro final do saldo (puro): saldo (inteiro de 0 a MAX_AMOUNT_CENTS) e data (não futura, normalizada para UTC).
// `fxRate` (E8-Q7): loja em BRL grava automaticamente a cotação das configurações (nula se não houver); loja USD, nulo.
function buildStoreBalanceRecord(input, { store = null, settings = null, now = new Date() } = {}) {
  if (isNil(input.storeId)) throw required('storeId');
  if (!store) throw new ValidationError('Loja não encontrada.', 'STORE_NOT_FOUND', { field: 'storeId' });
  if (isNil(input.balanceCents)) throw required('balanceCents');
  if (!Number.isSafeInteger(input.balanceCents) || input.balanceCents < 0 || input.balanceCents > MAX_AMOUNT_CENTS) {
    throw new ValidationError(
      'O saldo deve ser um inteiro de centavos maior ou igual a 0 e dentro do limite permitido.', 'INVALID_AMOUNT',
      { field: 'balanceCents', params: { maxCents: MAX_AMOUNT_CENTS } }
    );
  }
  if (isNil(input.recordedAt)) throw required('recordedAt');
  const date = parseDate(input.recordedAt, 'Data do saldo', { field: 'recordedAt' });
  assertNotFutureDay(date, now, {
    code: 'RECORDED_AT_IN_FUTURE', message: 'A data do saldo não pode ser futura.', field: 'recordedAt',
  });
  const rate = settings ? settings.usdBrlRate : null;
  return {
    storeId: store.id,
    balanceCents: input.balanceCents,
    fxRate: store.currency === 'BRL' && typeof rate === 'number' && rate > 0 ? rate : null,
    recordedAt: date.toISOString(),
  };
}

function toStoreBalanceView(row, store) {
  return {
    id: row.id,
    storeId: row.storeId,
    storeName: store ? store.name : null,
    currency: store ? store.currency : null,
    balanceCents: row.balanceCents,
    recordedAt: row.recordedAt,
    createdAt: row.createdAt,
  };
}

// Motivos do aviso "saldo possivelmente desatualizado" (E8-Q4, D215). Sem saldo registrado, nenhum motivo.
function outdatedReasonsOf({ store, latestBalance, held, items, withdrawals }) {
  if (!latestBalance) return [];
  const recordedMs = Date.parse(latestBalance.recordedAt);
  const after = (iso) => !isNil(iso) && Date.parse(iso) > recordedMs;
  const reasons = [];
  if (held.releasedAfterBalance.count > 0) reasons.push('RELEASED_AFTER_BALANCE');
  const purchased = items.some((item) => item.acquisitionType === 'COMPRA' && item.purchaseStoreId === store.id && after(item.acquiredAt));
  const withdrawn = withdrawals.some((w) => w.storeId === store.id && after(w.withdrawnAt));
  const soldWithoutHold = items.some(
    (item) => item.status === 'VENDIDO' && item.saleStoreId === store.id && !(item.saleHoldDaysApplied > 0) && after(item.soldAt)
  );
  if (purchased || withdrawn || soldWithoutHold) reasons.push('ACTIVITY_AFTER_BALANCE');
  return reasons;
}

// Uma linha por loja (inclusive inativas) + totais (D216). Cada parcela (disponível, pendente e liberado de cada loja)
// é convertida UMA vez, com ROUND (T82). `items`: todos os itens (vendas e compras); `withdrawals`: todos os saques.
function buildCurrentBalances({
  stores, latestBalances = [], items = [], withdrawals = [], settings = null, now = new Date(),
} = {}) {
  const latestByStore = new Map(latestBalances.map((balance) => [balance.storeId, balance]));
  const rows = stores.map((store) => {
    const latestBalance = latestByStore.get(store.id) ?? null;
    const held = computeHeldSalesForStore({ storeId: store.id, sales: items, latestBalance, now });
    const convert = (cents) => estimateBalanceBrl({ balanceCents: cents, store, settings });
    const available = convert(latestBalance ? latestBalance.balanceCents : 0);
    const pending = convert(held.pending.cents);
    const released = convert(held.releasedAfterBalance.cents);
    const outdatedReasons = outdatedReasonsOf({ store, latestBalance, held, items, withdrawals });
    const outdated = outdatedReasons.length > 0;
    const missingFx = [available, pending, released].some((part) => part.warningCode === WARNINGS.FX_NOT_CONFIGURED.code);
    let warningCode = null;
    if (missingFx) warningCode = WARNINGS.FX_NOT_CONFIGURED.code;
    else if (outdated) warningCode = WARNINGS.BALANCE_MAYBE_OUTDATED.code;
    return {
      storeId: store.id,
      storeName: store.name,
      currency: store.currency,
      isActive: Boolean(store.isActive),
      allowsWithdrawal: Boolean(store.allowsWithdrawal),
      saleHoldDays: store.saleHoldDays,
      balance: latestBalance ? toStoreBalanceView(latestBalance, store) : null,
      availableCents: latestBalance ? latestBalance.balanceCents : 0,
      availableEstimatedBrlCents: available.estimatedBrlCents,
      pending: { ...held.pending, estimatedBrlCents: pending.estimatedBrlCents },
      releasedAfterBalance: { ...held.releasedAfterBalance, estimatedBrlCents: released.estimatedBrlCents },
      estimated: available.estimated || pending.estimated || released.estimated,
      outdated,
      outdatedReasons,
      warningCode,
    };
  });

  const sumOf = (pick, filter = () => true) => rows.filter(filter).reduce((acc, row) => addNullable(acc, pick(row)), 0);
  const nextReleases = rows.map((row) => row.pending.nextReleaseAt).filter((value) => value !== null).sort();
  const totals = {
    availableEstimatedBrlCents: sumOf((row) => row.availableEstimatedBrlCents),
    pendingEstimatedBrlCents: sumOf((row) => row.pending.estimatedBrlCents),
    releasedAfterBalanceEstimatedBrlCents: sumOf((row) => row.releasedAfterBalance.estimatedBrlCents),
    // Só informativo (D212): disponível + pendente + liberado das lojas sem saque; não é somado de novo no lucro real.
    nonWithdrawableEstimatedBrlCents: sumOf(
      (row) => addNullable(addNullable(row.availableEstimatedBrlCents, row.pending.estimatedBrlCents), row.releasedAfterBalance.estimatedBrlCents),
      (row) => !row.allowsWithdrawal
    ),
    nextReleaseAt: nextReleases.length ? nextReleases[0] : null,
    estimated: rows.some((row) => row.estimated),
  };
  return {
    stores: rows,
    totals,
    usdBrlRate: settings && isValidFxRate(settings.usdBrlRate) ? settings.usdBrlRate : null,
    computedAt: now.toISOString(),
  };
}

// --- Orquestração -------------------------------------------------------------------------------

const storesMap = () => new Map(Store.findAll().map((store) => [store.id, store]));

function listHistory({ storeId } = {}) {
  const stores = storesMap();
  if (!isNil(storeId) && !stores.has(storeId)) {
    throw new ValidationError('Loja não encontrada.', 'STORE_NOT_FOUND', { field: 'storeId' });
  }
  const rows = isNil(storeId) ? StoreBalance.findAll() : StoreBalance.findHistory(storeId);
  return { balances: rows.map((row) => toStoreBalanceView(row, stores.get(row.storeId))) };
}

function listCurrent({ now = new Date() } = {}) {
  return buildCurrentBalances({
    stores: Store.findAll(),
    latestBalances: StoreBalance.findLatestAll(),
    items: Item.findAll(),
    withdrawals: Withdrawal.findAll(),
    settings: Setting.get(),
    now,
  });
}

function createStoreBalance(input, { now = new Date() } = {}) {
  const store = isNil(input.storeId) ? null : Store.findById(input.storeId);
  const record = buildStoreBalanceRecord(input, { store, settings: Setting.get(), now });
  return toStoreBalanceView(StoreBalance.create(record, { now }), store);
}

function deleteStoreBalance(id) {
  if (!StoreBalance.findById(id)) throw new NotFoundError('Registro de saldo não encontrado.', 'STORE_BALANCE_NOT_FOUND');
  StoreBalance.remove(id);
  return { id };
}

module.exports = {
  buildStoreBalanceRecord, buildCurrentBalances, toStoreBalanceView, listHistory, listCurrent, createStoreBalance, deleteStoreBalance,
};

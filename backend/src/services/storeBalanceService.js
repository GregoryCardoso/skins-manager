'use strict';

// Saldo das lojas CALCULADO (2.8, D239 a D246, Revisão 23): aportes − compras − saques + vendas liberadas + ajustes, sempre
// a partir de 0 e com todas as movimentações da loja (sem saldo inicial e sem corte por data).
// Tudo é calculado na hora; só as conferências (com o ajuste confirmado) são gravadas em `store_balances`.
// As funções puras não acessam o banco e recebem `at`/`now`; o resto orquestra os models.
const StoreBalance = require('../models/StoreBalance');
const Store = require('../models/Store');
const Item = require('../models/Item');
const Deposit = require('../models/Deposit');
const Withdrawal = require('../models/Withdrawal');
const Setting = require('../models/Setting');
const { ValidationError, NotFoundError } = require('../errors/AppError');
const { MAX_AMOUNT_CENTS, MAX_NOTE_LENGTH } = require('../config/constants');
const { parseDate } = require('./dateUtils');
const { assertNotFutureDay } = require('./inventoryAgingService');
const { isValidFxRate, toUsdBase, approxBrlOf } = require('./currencyService');
const { splitStoreSales } = require('./saleHoldService');
const { WARNINGS } = require('./warnings');

const DAY_MS = 24 * 60 * 60 * 1000;
const isNil = (value) => value === null || value === undefined;
const required = (field) => new ValidationError(`O campo ${field} é obrigatório.`, 'REQUIRED_FIELD', { field });
const addNullable = (a, b) => (a === null || b === null ? null : a + b);
const msOf = (value) => (value instanceof Date ? value.getTime() : Date.parse(value));

// --- Cálculo (puro) -----------------------------------------------------------------------------

// Saldo disponível e pendente da loja S no instante `at` (D239, D252). `checks`: conferências (qualquer loja; as de outras
// lojas e as sem ajuste são ignoradas); `excludeId` tira uma conferência da conta (a própria, na gravação).
// Entra tudo o que tem data `d <= at`, de qualquer época.
function computeStoreBalance({
  store, checks = [], deposits = [], withdrawals = [], items = [], at, excludeId = null,
}) {
  const atMs = msOf(at);
  const inWindow = (iso) => Date.parse(iso) <= atMs;
  const ignored = { legacyDeposits: 0, currencyMismatch: 0 };

  let depositsCents = 0;
  for (const deposit of deposits) {
    if (deposit.storeId !== store.id) continue;
    if (isNil(deposit.amountStoreCents)) {
      ignored.legacyDeposits += 1;
      continue;
    }
    if (inWindow(deposit.depositedAt)) depositsCents += deposit.amountStoreCents;
  }

  let withdrawalsCents = 0;
  for (const withdrawal of withdrawals) {
    if (withdrawal.storeId !== store.id || isNil(withdrawal.amountStoreCents)) continue;
    if (inWindow(withdrawal.withdrawnAt)) withdrawalsCents += withdrawal.amountStoreCents;
  }

  let purchasesCents = 0;
  const sales = [];
  for (const item of items) {
    if (item.acquisitionType === 'COMPRA' && item.purchaseStoreId === store.id) {
      if (item.purchaseCurrency !== store.currency) ignored.currencyMismatch += 1;
      else if (inWindow(item.acquiredAt)) purchasesCents += item.purchasePriceCents;
    }
    if (item.status === 'VENDIDO' && item.saleStoreId === store.id) {
      if (item.saleCurrency !== store.currency) ignored.currencyMismatch += 1;
      else sales.push(item);
    }
  }
  const { released, pending } = splitStoreSales({ storeId: store.id, sales, at });

  let adjustmentsCents = 0;
  for (const check of checks) {
    if (check.storeId !== store.id || check.kind !== 'CHECK' || isNil(check.adjustmentCents)) continue;
    if (check.id === excludeId) continue;
    if (inWindow(check.recordedAt)) adjustmentsCents += check.adjustmentCents;
  }

  const breakdown = {
    depositsCents, purchasesCents, withdrawalsCents, salesReleasedCents: released.cents, adjustmentsCents,
  };
  const availableCents = depositsCents - purchasesCents - withdrawalsCents + released.cents + adjustmentsCents;
  return { breakdown, availableCents: availableCents + 0, pending, ignored };
}

// Dias inteiros desde `iso` até `now` (mínimo 0); nulo sem data (D243).
function daysSince(iso, now = new Date()) {
  if (isNil(iso)) return null;
  const days = Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS);
  return Math.max(0, days);
}

// Observação (opcional): texto aparado, vazio = nulo. `required`: obrigatória (ajuste). Tamanho máximo MAX_NOTE_LENGTH.
function normalizeNote(note, { requiredNote = false } = {}) {
  let text = null;
  if (!isNil(note)) {
    if (typeof note !== 'string') throw new ValidationError('O campo note tem um tipo inválido.', 'INVALID_FIELD', { field: 'note' });
    text = note.trim() === '' ? null : note.trim();
  }
  if (requiredNote && text === null) {
    throw new ValidationError('Informe uma observação para o ajuste.', 'ADJUSTMENT_NOTE_REQUIRED', { field: 'note' });
  }
  if (text !== null && text.length > MAX_NOTE_LENGTH) {
    throw new ValidationError(`A observação deve ter no máximo ${MAX_NOTE_LENGTH} caracteres.`, 'FIELD_TOO_LONG', {
      field: 'note', params: { maxLength: MAX_NOTE_LENGTH },
    });
  }
  return text;
}

// Campos comuns (loja, valor, data) da conferência; devolve o valor e a data normalizada.
function validateCommon(input, store, now) {
  if (isNil(input.storeId)) throw required('storeId');
  if (isNil(input.balanceCents)) throw required('balanceCents');
  if (isNil(input.recordedAt)) throw required('recordedAt');
  if (!store) throw new ValidationError('Loja não encontrada.', 'STORE_NOT_FOUND', { field: 'storeId' });
  if (!Number.isSafeInteger(input.balanceCents) || input.balanceCents < 0 || input.balanceCents > MAX_AMOUNT_CENTS) {
    throw new ValidationError(
      'O saldo deve ser um inteiro de centavos maior ou igual a 0 e dentro do limite permitido.', 'INVALID_AMOUNT',
      { field: 'balanceCents', params: { maxCents: MAX_AMOUNT_CENTS } }
    );
  }
  const date = parseDate(input.recordedAt, 'Data do saldo', { field: 'recordedAt' });
  assertNotFutureDay(date, now, {
    code: 'RECORDED_AT_IN_FUTURE', message: 'A data do saldo não pode ser futura.', field: 'recordedAt',
  });
  return date;
}

// `fxRate` (E8-Q7): loja em BRL grava a cotação das configurações (nula se não houver); loja USD, nulo.
const fxRateFor = (store, settings) => {
  const rate = settings ? settings.usdBrlRate : null;
  return store.currency === 'BRL' && typeof rate === 'number' && rate > 0 ? rate : null;
};

// Registro da conferência (D242). `computedCents` é o disponível calculado em `recordedAt` (sem a própria conferência).
// Ordem dos erros: REQUIRED_FIELD, STORE_NOT_FOUND, INVALID_AMOUNT, data, BALANCE_CHECK_BEFORE_LAST (só contra conferências
// com cálculo, D252), ADJUSTMENT_NOTE_REQUIRED, FIELD_TOO_LONG. `adjust` com diferença 0 não gera ajuste.
function buildCheckRecord(input, {
  store = null, lastCheck = null, computedCents = null, settings = null, now = new Date(),
} = {}) {
  const date = validateCommon(input, store, now);
  const recordedMs = date.getTime();
  if (lastCheck && recordedMs < Date.parse(lastCheck.recordedAt)) {
    throw new ValidationError(
      'A conferência não pode ser anterior à última conferência. Exclua a mais recente para corrigir.', 'BALANCE_CHECK_BEFORE_LAST',
      { field: 'recordedAt' }
    );
  }
  const difference = input.balanceCents - computedCents;
  const adjusts = input.adjust === true && difference !== 0;
  const note = normalizeNote(input.note, { requiredNote: adjusts });
  return {
    storeId: store.id,
    kind: 'CHECK',
    balanceCents: input.balanceCents,
    computedCents,
    adjustmentCents: adjusts ? difference : null,
    fxRate: fxRateFor(store, settings),
    note,
    recordedAt: date.toISOString(),
  };
}

// Visão de uma entrada (D246): diferença = real − calculado (nula se não houver calculado); `legacy` = conferência migrada.
function toEntryView(row, store) {
  return {
    id: row.id,
    storeId: row.storeId,
    storeName: store ? store.name : null,
    currency: store ? store.currency : null,
    kind: row.kind,
    balanceCents: row.balanceCents,
    computedCents: row.computedCents,
    differenceCents: isNil(row.computedCents) ? null : row.balanceCents - row.computedCents,
    adjustmentCents: row.adjustmentCents,
    note: row.note,
    legacy: row.kind === 'CHECK' && isNil(row.computedCents),
    recordedAt: row.recordedAt,
    createdAt: row.createdAt,
  };
}

// Entrada mais recente (maior `recordedAt`, desempate pelo maior id).
const latestOf = (rows) => rows.reduce((best, row) => {
  if (!best) return row;
  const diff = Date.parse(row.recordedAt) - Date.parse(best.recordedAt);
  return diff > 0 || (diff === 0 && row.id > best.id) ? row : best;
}, null);

// Uma linha por loja (inclusive inativas) + totais (D246). Disponível e pendente de cada loja são convertidos UMA vez
// para USD, com ROUND (D225); o "≈ R$" dos totais vem do total já somado. `entries`: todas as linhas de `store_balances`.
function buildCurrentBalances({
  stores = [], entries = [], deposits = [], withdrawals = [], items = [], settings = null, now = new Date(),
} = {}) {
  const rate = settings ? settings.usdBrlRate : null;
  const rows = stores.map((store) => {
    const own = entries.filter((entry) => entry.storeId === store.id);
    const computed = computeStoreBalance({ store, checks: own, deposits, withdrawals, items, at: now });
    const available = toUsdBase(computed.availableCents, store.currency, rate);
    const pending = toUsdBase(computed.pending.cents, store.currency, rate);
    const lastCheck = latestOf(own);
    const negative = computed.availableCents < 0;
    let warningCode = null;
    if (available.usdCents === null || pending.usdCents === null) warningCode = WARNINGS.FX_NOT_CONFIGURED.code;
    else if (negative) warningCode = WARNINGS.COMPUTED_BALANCE_NEGATIVE.code;
    return {
      storeId: store.id,
      storeName: store.name,
      currency: store.currency,
      isActive: Boolean(store.isActive),
      allowsWithdrawal: Boolean(store.allowsWithdrawal),
      saleHoldDays: store.saleHoldDays,
      lastCheck: lastCheck ? toEntryView(lastCheck, store) : null,
      daysSinceLastCheck: lastCheck ? daysSince(lastCheck.recordedAt, now) : null,
      breakdown: computed.breakdown,
      availableCents: computed.availableCents,
      availableUsdCents: available.usdCents,
      availableApproxBrlCents: available.approxBrlCents,
      availableEstimated: available.estimated,
      negative,
      pending: { ...computed.pending, usdCents: pending.usdCents, approxBrlCents: pending.approxBrlCents, estimated: pending.estimated },
      ignored: computed.ignored,
      estimated: available.estimated || pending.estimated,
      warningCode,
    };
  });

  const sumOf = (pick, filter = () => true) => rows.filter(filter).reduce((acc, row) => addNullable(acc, pick(row)), 0);
  const nextReleases = rows.map((row) => row.pending.nextReleaseAt).filter((value) => value !== null).sort();
  const availableUsd = sumOf((row) => row.availableUsdCents);
  const pendingUsd = sumOf((row) => row.pending.usdCents);
  // Só informativo (D212): disponível + pendente das lojas sem saque; não é somado de novo no lucro real.
  const nonWithdrawableUsd = sumOf((row) => addNullable(row.availableUsdCents, row.pending.usdCents), (row) => !row.allowsWithdrawal);
  const totals = {
    availableUsdCents: availableUsd,
    pendingUsdCents: pendingUsd,
    nonWithdrawableUsdCents: nonWithdrawableUsd,
    availableEstimated: rows.some((row) => row.availableEstimated),
    pendingEstimated: rows.some((row) => row.pending.estimated),
    nonWithdrawableEstimated: rows.some((row) => !row.allowsWithdrawal && row.estimated),
    approxBrl: {
      available: approxBrlOf(availableUsd, rate),
      pending: approxBrlOf(pendingUsd, rate),
      nonWithdrawable: approxBrlOf(nonWithdrawableUsd, rate),
    },
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
  const rows = isNil(storeId) ? StoreBalance.findAllEntries() : StoreBalance.findByStore(storeId);
  return { balances: rows.map((row) => toEntryView(row, stores.get(row.storeId))) };
}

function listCurrent({ now = new Date() } = {}) {
  return buildCurrentBalances({
    stores: Store.findAll(),
    entries: StoreBalance.findAllEntries(),
    deposits: Deposit.findAll(),
    withdrawals: Withdrawal.findAll(),
    items: Item.findAll(),
    settings: Setting.get(),
    now,
  });
}

// Calcula o disponível da loja em `recordedAt` e monta o registro da conferência (usado pela prévia e pela gravação).
function prepareCheck(input, { now }) {
  const store = isNil(input.storeId) ? null : Store.findById(input.storeId);
  const settings = Setting.get();
  const entries = store ? StoreBalance.findByStore(store.id) : [];
  // BALANCE_CHECK_BEFORE_LAST compara só com conferências com cálculo: os registros antigos não têm ajuste (D252).
  const lastCheck = latestOf(entries.filter((entry) => entry.computedCents !== null && entry.computedCents !== undefined));
  let computedCents = null;
  if (store && typeof input.recordedAt === 'string') {
    let at = null;
    try {
      at = parseDate(input.recordedAt, 'Data do saldo');
    } catch (err) {
      at = null; // a validação de buildCheckRecord devolve o erro certo
    }
    if (at) {
      computedCents = computeStoreBalance({
        store, checks: entries, deposits: Deposit.findAll(), withdrawals: Withdrawal.findAll(), items: Item.findAll(), at,
      }).availableCents;
    }
  }
  const record = buildCheckRecord(input, { store, lastCheck, computedCents, settings, now });
  return { record, store, settings };
}

// Prévia (D242, D246): sem gravar nada. Valida como o POST, exceto a observação.
function previewCheck(query, { now = new Date() } = {}) {
  const { record, store, settings } = prepareCheck({ ...query, adjust: false }, { now });
  const differenceCents = record.balanceCents - record.computedCents;
  const diff = toUsdBase(differenceCents, store.currency, settings.usdBrlRate);
  return {
    storeId: store.id,
    currency: store.currency,
    recordedAt: record.recordedAt,
    balanceCents: record.balanceCents,
    computedCents: record.computedCents,
    differenceCents,
    differenceUsdCents: diff.usdCents,
    differenceApproxBrlCents: diff.approxBrlCents,
    estimated: diff.estimated,
  };
}

function createCheck(input, { now = new Date() } = {}) {
  const { record, store } = prepareCheck(input, { now });
  return toEntryView(StoreBalance.create(record, { now }), store);
}

function deleteEntry(id) {
  if (!StoreBalance.findById(id)) throw new NotFoundError('Registro de saldo não encontrado.', 'STORE_BALANCE_NOT_FOUND');
  StoreBalance.remove(id);
  return { id };
}

module.exports = {
  computeStoreBalance, daysSince, buildCheckRecord, buildCurrentBalances, toEntryView,
  listHistory, listCurrent, previewCheck, createCheck, deleteEntry,
};

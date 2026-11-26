'use strict';

// Regras de lojas (D145/D156). `buildStoreRecord` é puro; o resto orquestra os models.
const Store = require('../models/Store');
const Setting = require('../models/Setting');
const { runInTransaction } = require('../models/modelHelpers');
const { ValidationError, NotFoundError, ConflictError } = require('../errors/AppError');
const {
  maxAmountCents, MAX_STORE_NAME_LENGTH, RATE_MAX_DECIMALS, MAX_SALE_HOLD_DAYS, CURRENCIES,
} = require('../config/constants');
const { assertAmountPrecision, fxFromSettings, rateOf, convertCents } = require('./currencyService');
const { saleFeeParamsFromStore } = require('./fees');
const { computeSale } = require('./pricingService');

const FEE_TYPES = ['DEDUCTED', 'ADDED'];
const ROUNDINGS = ['CEIL', 'ROUND', 'FLOOR'];

// Valores de uma loja nova (D156). Campos ausentes na entrada assumem estes padrões.
const STORE_DEFAULTS = Object.freeze({
  name: null,
  currency: null,
  isActive: true,
  isPrimary: false,
  saleFeeType: null,
  saleFeeRate: null,
  saleFeeRounding: 'CEIL',
  saleMinFeeCents: null,
  saleFixedFeeCents: 0,
  allowsWithdrawal: false,
  withdrawalFeeRate: null,
  withdrawalFixedFeeCents: 0,
  saleHoldDays: 0,
});
const STORE_FIELDS = Object.keys(STORE_DEFAULTS);

const isNil = (value) => value === null || value === undefined;

// `isSteamStore` (D363): é a loja Steam escolhida nas configurações (`settings.steam_store_id`).
function withFlags(store, inUse, steamStoreId = Setting.get().steamStoreId ?? null) {
  return { ...store, saleFeesConfigured: saleFeeParamsFromStore(store) !== null, inUse, isSteamStore: steamStoreId !== null && store.id === steamStoreId };
}

function listStores({ activeOnly = false } = {}) {
  const used = new Set(Store.findUsedIds());
  const steamStoreId = Setting.get().steamStoreId ?? null;
  return Store.findAll({ activeOnly }).map((store) => withFlags(store, used.has(store.id), steamStoreId));
}

// "Tem lançamentos" (D30, D369 A4): a loja já foi usada em compras, vendas, aportes, saques ou conferências/ajustes.
const storeHasEntries = (id) => Store.isInUse(id);

function getStore(id) {
  const store = Store.findById(id);
  if (!store) throw new NotFoundError('Loja não encontrada.', 'STORE_NOT_FOUND');
  return withFlags(store, Store.isInUse(id));
}

// Referência no corpo da requisição: inexistente = 400. Aceita loja ativa ou inativa (Q2).
function getStoreOrFail(id, { field } = {}) {
  const store = Store.findById(id);
  if (!store) throw new ValidationError('Loja não encontrada.', 'STORE_NOT_FOUND', field ? { field } : undefined);
  return store;
}

// Prévia do líquido de uma venda (D122): só calcula, nada é gravado. Aqui a loja é recurso da rota (404).
function quoteSale(id, salePriceCents) {
  const store = Store.findById(id);
  if (!store) throw new NotFoundError('Loja não encontrada.', 'STORE_NOT_FOUND');
  if (salePriceCents > maxAmountCents(store.currency)) {
    throw new ValidationError('salePriceCents deve ser um inteiro de centavos maior que 0.', 'INVALID_QUERY', {
      field: 'salePriceCents', params: { maxCents: maxAmountCents(store.currency), currency: store.currency },
    });
  }
  assertAmountPrecision(salePriceCents, store.currency, 'salePriceCents');
  const { netReceivedCents, feeCents } = computeSale({ salePriceCents, store });
  return { storeId: store.id, currency: store.currency, salePriceCents, feeCents, netReceivedCents };
}

function assertRate(value, field) {
  const scaled = value * 10 ** RATE_MAX_DECIMALS;
  const ok = typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1
    && Math.abs(scaled - Math.round(scaled)) < 1e-6;
  if (!ok) {
    throw new ValidationError(
      'A taxa deve ser maior ou igual a 0% e menor que 100%, com no máximo 4 casas decimais no percentual.',
      'INVALID_RATE', { field, params: { maxDecimals: RATE_MAX_DECIMALS } }
    );
  }
}

// `currency`: a moeda da loja (taxa fixa e mínima são nela); cada moeda tem o seu teto (11.11, complemento).
function assertCents(value, field, currency) {
  const maxCents = maxAmountCents(currency);
  if (!Number.isSafeInteger(value) || value < 0 || value > maxCents) {
    throw new ValidationError(
      'O valor deve ser um inteiro de centavos entre 0 e o limite permitido.', 'INVALID_AMOUNT',
      { field, params: { maxCents, currency } }
    );
  }
}

// Registro final da loja (puro): padrões + gravado + parcial, validado nesta ordem:
// nome, moeda, listas, taxas, centavos, retenção, par tipo/taxa, principal/ativa.
// `nameTaken` = outro registro já usa o nome (consulta feita pelo chamador); `inUse` trava a moeda.
function buildStoreRecord(input, { existing = null, inUse = false, nameTaken = false } = {}) {
  const base = existing ? Object.fromEntries(STORE_FIELDS.map((f) => [f, existing[f]])) : { ...STORE_DEFAULTS };
  const record = { ...base };
  for (const field of STORE_FIELDS) if (input && input[field] !== undefined) record[field] = input[field];

  // 1. nome
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (name.length === 0) throw new ValidationError('Informe o nome da loja.', 'REQUIRED_FIELD', { field: 'name' });
  if (name.length > MAX_STORE_NAME_LENGTH) {
    throw new ValidationError(
      `O nome da loja deve ter no máximo ${MAX_STORE_NAME_LENGTH} caracteres.`, 'FIELD_TOO_LONG',
      { field: 'name', params: { maxLength: MAX_STORE_NAME_LENGTH } }
    );
  }
  if (nameTaken) throw new ConflictError('Já existe uma loja com este nome.', 'STORE_NAME_TAKEN', { field: 'name' });
  record.name = name;

  // 2. moeda
  if (!CURRENCIES.includes(record.currency)) {
    throw new ValidationError(`Moeda inválida. Use ${CURRENCIES.join(', ')}.`, 'INVALID_CURRENCY', { field: 'currency' });
  }
  if (existing && inUse && record.currency !== existing.currency) {
    throw new ConflictError(
      'A moeda não pode mudar: a loja já foi usada em itens ou movimentações.', 'STORE_CURRENCY_LOCKED', { field: 'currency' }
    );
  }

  // 3. listas
  if (!isNil(record.saleFeeType) && !FEE_TYPES.includes(record.saleFeeType)) {
    throw new ValidationError('Tipo de taxa inválido. Use DEDUCTED ou ADDED.', 'INVALID_FEE_TYPE', { field: 'saleFeeType' });
  }
  if (!ROUNDINGS.includes(record.saleFeeRounding)) {
    throw new ValidationError('Arredondamento inválido. Use CEIL, ROUND ou FLOOR.', 'INVALID_ROUNDING', { field: 'saleFeeRounding' });
  }

  // 4. taxas percentuais
  if (!isNil(record.saleFeeRate)) assertRate(record.saleFeeRate, 'saleFeeRate');
  if (!isNil(record.withdrawalFeeRate)) assertRate(record.withdrawalFeeRate, 'withdrawalFeeRate');

  // 5. centavos
  if (!isNil(record.saleMinFeeCents)) assertCents(record.saleMinFeeCents, 'saleMinFeeCents', record.currency);
  assertCents(record.saleFixedFeeCents, 'saleFixedFeeCents', record.currency);
  assertCents(record.withdrawalFixedFeeCents, 'withdrawalFixedFeeCents', record.currency);
  // 5a. unidade mínima da moeda da loja (D369 A3): JPY, KRW e CLP só aceitam múltiplos de 100 centavos
  if (!isNil(record.saleMinFeeCents)) assertAmountPrecision(record.saleMinFeeCents, record.currency, 'saleMinFeeCents');
  assertAmountPrecision(record.saleFixedFeeCents, record.currency, 'saleFixedFeeCents');
  assertAmountPrecision(record.withdrawalFixedFeeCents, record.currency, 'withdrawalFixedFeeCents');

  // 5b. retenção do saldo após a venda (D213): inteiro de 0 a 30
  if (!Number.isSafeInteger(record.saleHoldDays) || record.saleHoldDays < 0 || record.saleHoldDays > MAX_SALE_HOLD_DAYS) {
    throw new ValidationError(
      `A retenção deve ser um número inteiro de dias entre 0 e ${MAX_SALE_HOLD_DAYS}.`, 'INVALID_SALE_HOLD_DAYS',
      { field: 'saleHoldDays', params: { min: 0, max: MAX_SALE_HOLD_DAYS } }
    );
  }

  // 6. par tipo/taxa de venda: os dois ou nenhum
  if (isNil(record.saleFeeType) !== isNil(record.saleFeeRate)) {
    throw new ValidationError(
      'Informe o tipo e a taxa de venda juntos, ou deixe os dois vazios.', 'SALE_FEE_INCOMPLETE',
      { field: isNil(record.saleFeeType) ? 'saleFeeType' : 'saleFeeRate' }
    );
  }

  // 7. principal/ativa
  if (record.isPrimary && !record.isActive) {
    throw new ConflictError(
      'A loja principal não pode ficar inativa. Escolha outra loja principal antes.', 'PRIMARY_STORE_INACTIVE',
      { field: input && input.isPrimary !== undefined ? 'isPrimary' : 'isActive' }
    );
  }
  if (existing && existing.isPrimary && input && input.isPrimary === false) {
    throw new ConflictError(
      'Sempre deve haver uma loja principal. Escolha outra loja como principal.', 'PRIMARY_STORE_REQUIRED', { field: 'isPrimary' }
    );
  }
  return record;
}

function nameTakenBy(name, selfId) {
  if (typeof name !== 'string') return false;
  const other = Store.findByName(name.trim());
  return other !== null && other.id !== selfId;
}

function createStore(input, { now = new Date() } = {}) {
  const record = buildStoreRecord(input, { nameTaken: nameTakenBy(input.name, null) });
  const id = runInTransaction(() => {
    // Banco legado sem loja principal: a loja ativa criada passa a ser a principal.
    if (record.isActive && !Store.findPrimary()) record.isPrimary = true;
    if (record.isPrimary) Store.clearPrimary({ now });
    return Store.create(record, { now }).id;
  });
  return getStore(id);
}

function updateStore(id, partial, { now = new Date() } = {}) {
  const existing = Store.findById(id);
  if (!existing) throw new NotFoundError('Loja não encontrada.', 'STORE_NOT_FOUND');
  const record = buildStoreRecord(partial, {
    existing,
    inUse: Store.isInUse(id),
    nameTaken: partial.name !== undefined && nameTakenBy(partial.name, id),
  });
  runInTransaction(() => {
    // Banco legado sem loja principal: a loja ativada passa a ser a principal.
    if (record.isActive && !existing.isActive && !Store.findPrimary()) record.isPrimary = true;
    if (record.isPrimary && !existing.isPrimary) Store.clearPrimary({ now });
    Store.update(id, record, { now });
  });
  return getStore(id);
}

// Nome livre para a loja Steam antiga ("Steam (BRL)"; se já existir, "Steam (BRL) 2" e assim por diante), dentro do limite de tamanho.
function freeStoreName(base, selfId) {
  const fit = (text) => text.slice(0, MAX_STORE_NAME_LENGTH);
  let candidate = fit(base);
  for (let n = 2; nameTakenBy(candidate, selfId) && n < 1000; n += 1) {
    const suffix = ` ${n}`;
    candidate = `${base.slice(0, MAX_STORE_NAME_LENGTH - suffix.length)}${suffix}`;
  }
  return candidate;
}

// Valor de configuração (taxa mínima/fixa) da loja antiga levado para a loja nova: convertido pela cotação das configurações e arredondado
// na unidade da moeda nova. Sem cotação, o campo não é levado (a pessoa preenche em Lojas). Só configuração: nenhum valor gravado
// de lançamentos muda de moeda (D369 A4).
function carryFeeAmount(cents, fromCurrency, toCurrency, fx) {
  if (isNil(cents) || cents === 0) return cents ?? null;
  const fromRate = fromCurrency === 'USD' ? 1 : rateOf(fx, fromCurrency);
  const toRate = toCurrency === 'USD' ? 1 : rateOf(fx, toCurrency);
  if (fromRate === null || toRate === null) return null;
  return convertCents(cents, fromCurrency, toCurrency, { fromFxRate: fromRate, toFxRate: toRate }, 'CEIL');
}

// Troca a moeda de uma loja SEM lançamentos (a loja Steam acompanhando a moeda do usuário, D369 A4). As taxas mínima e fixa, que estão
// na moeda antiga, são convertidas pela cotação das configurações (ou ficam vazias sem cotação). Com lançamentos: STORE_CURRENCY_LOCKED.
function changeStoreCurrency(id, currency, { now = new Date() } = {}) {
  const existing = Store.findById(id);
  if (!existing) throw new NotFoundError('Loja não encontrada.', 'STORE_NOT_FOUND');
  const fx = fxFromSettings(Setting.get());
  const partial = {
    currency,
    saleMinFeeCents: carryFeeAmount(existing.saleMinFeeCents, existing.currency, currency, fx),
    saleFixedFeeCents: carryFeeAmount(existing.saleFixedFeeCents, existing.currency, currency, fx) ?? 0,
    withdrawalFixedFeeCents: carryFeeAmount(existing.withdrawalFixedFeeCents, existing.currency, currency, fx) ?? 0,
  };
  const record = buildStoreRecord(partial, { existing, inUse: Store.isInUse(id) });
  Store.update(id, record, { now });
  return getStore(id);
}

// Cria a nova loja Steam na moeda nova (D369 A4, "NEW_STORE"): a antiga é desativada e renomeada "<nome> (<moeda antiga>)", sem mudar
// nenhum valor gravado; a nova leva as mesmas taxas (percentuais e regras; valores fixos convertidos), a mesma retenção e as mesmas
// permissões, e o nome original. Se a antiga era a principal, a nova assume a marca. Não troca `steam_store_id` (é do
// settingsService, na mesma transação). Devolve `{ store, previousStoreId }`.
function cloneSteamStoreInCurrency(storeId, currency, { now = new Date() } = {}) {
  const old = Store.findById(storeId);
  if (!old) throw new NotFoundError('Loja não encontrada.', 'STORE_NOT_FOUND');
  if (!CURRENCIES.includes(currency)) {
    throw new ValidationError(`Moeda inválida. Use ${CURRENCIES.join(', ')}.`, 'INVALID_CURRENCY', { field: 'currency' });
  }
  if (old.currency === currency) {
    throw new ValidationError('A loja Steam já usa esta moeda.', 'INVALID_FIELD', { field: 'steamStore' });
  }
  const fx = fxFromSettings(Setting.get());
  const originalName = old.name;
  return runInTransaction(() => {
    const wasPrimary = old.isPrimary;
    if (wasPrimary) Store.clearPrimary({ now });
    // O nome antigo precisa ser liberado antes de a loja nova nascer com ele (o nome é único).
    Store.update(storeId, { name: freeStoreName(`${originalName} (${old.currency})`, storeId), isActive: false, isPrimary: false }, { now });
    const record = buildStoreRecord({
      name: originalName,
      currency,
      isActive: true,
      isPrimary: wasPrimary,
      saleFeeType: old.saleFeeType,
      saleFeeRate: old.saleFeeRate,
      saleFeeRounding: old.saleFeeRounding,
      saleMinFeeCents: carryFeeAmount(old.saleMinFeeCents, old.currency, currency, fx),
      saleFixedFeeCents: carryFeeAmount(old.saleFixedFeeCents, old.currency, currency, fx) ?? 0,
      allowsWithdrawal: old.allowsWithdrawal,
      withdrawalFeeRate: old.withdrawalFeeRate,
      withdrawalFixedFeeCents: carryFeeAmount(old.withdrawalFixedFeeCents, old.currency, currency, fx) ?? 0,
      saleHoldDays: old.saleHoldDays,
    });
    const created = Store.create(record, { now });
    return { store: created, previousStoreId: storeId };
  });
}

function deleteStore(id) {
  const store = Store.findById(id);
  if (!store) throw new NotFoundError('Loja não encontrada.', 'STORE_NOT_FOUND');
  if (store.isPrimary) {
    throw new ConflictError('A loja principal não pode ser excluída. Escolha outra principal antes.', 'PRIMARY_STORE_REQUIRED');
  }
  if (Store.isInUse(id)) {
    throw new ConflictError('A loja já foi usada e só pode ser desativada.', 'STORE_IN_USE');
  }
  Store.remove(id);
  return { id };
}

module.exports = {
  listStores, getStore, getStoreOrFail, storeHasEntries, quoteSale, createStore, updateStore, deleteStore, buildStoreRecord,
  cloneSteamStoreInCurrency, changeStoreCurrency,
};

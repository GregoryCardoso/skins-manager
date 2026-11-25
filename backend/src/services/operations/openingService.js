'use strict';

// Abrir caixa, cápsula, pacote e terminal (D357, D363 item 4; 2.2.3, Revisões 29 e 31). Consome o recipiente (e, na caixa, a chave de
// mesmo nome do estoque) e gera no máximo 1 unidade `GERADO` com o custo transferido; o terminal pode ser comprado (a unidade nasce
// `COMPRA` na loja Steam do app, com o preço pago) ou recusado (perda realizada). Não é venda: o lucro real e o saldo das lojas não
// mudam, salvo o preço pago no terminal e a perda do terminal recusado. O custo efetivo é calculado (nada é gravado em `purchase_price`).
const Item = require('../../models/Item');
const ItemComponent = require('../../models/ItemComponent');
const ItemOperation = require('../../models/ItemOperation');
const Setting = require('../../models/Setting');
const { runInTransaction } = require('../../models/modelHelpers');
const { AppError, NotFoundError, ConflictError } = require('../../errors/AppError');
const catalogService = require('../catalogService');
const settingsService = require('../settingsService');
const itemService = require('../itemService');
const { isValidFxRate, fxFromSettings, rateOf } = require('../currencyService');
const { parseDate } = require('../dateUtils');
const { isInTradeLock, isOffSale } = require('../inventoryAgingService');
const { assertDate, invalidDate } = require('./operationDates');
const operationContext = require('./operationContext');
const openingRules = require('./openingRules');

const isNil = (v) => v === null || v === undefined;
const hasKey = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const DECISIONS = Object.freeze(['BUY', 'DECLINE']);
const MAX_NOTE_LENGTH = 500;
// Campos de aquisição que o item obtido nunca aceita: ele herda tudo da operação (D363 item 4).
const { GENERATED_FORBIDDEN_FIELDS } = require('../../config/constants');

const unprocessable = (code, message, extra) => new AppError(422, code, message, extra);
const invalidInput = (reason, message, field, params = {}) => unprocessable('INVALID_OPERATION_INPUT', message, { field, params: { reason, ...params } });

function findOrFail(id, role) {
  const item = Item.findById(id);
  if (!item) throw new NotFoundError('Item não encontrado.', 'ITEM_NOT_FOUND', { params: { itemId: id, role } });
  return item;
}

function notInStock(item, role) {
  return new ConflictError('O item não está em estoque.', 'ITEM_NOT_IN_STOCK', { params: { itemId: item.id, role, status: item.status } });
}

// Recipiente existente, em estoque e abrível: { container, entry, kind }.
function loadOpenable(containerId) {
  const container = findOrFail(containerId, 'CONTAINER');
  if (container.status === 'CONSUMIDO') {
    throw new ConflictError('Esta unidade foi consumida: desfaça a operação antes.', 'ITEM_CONSUMED', { params: { itemId: container.id, role: 'CONTAINER' } });
  }
  if (container.status !== 'EM_ESTOQUE') throw notInStock(container, 'CONTAINER');
  const entry = isNil(container.catalogId) ? null : catalogService.getCatalogItem(container.catalogId);
  const kind = openingRules.openingKindOf(container, entry);
  if (!kind) throw unprocessable('ITEM_NOT_OPENABLE', 'Este item não pode ser aberto.', { params: { itemId: container.id } });
  return { container, entry, kind };
}

function containerLabel(container, kind) {
  if (kind === 'CASE') return 'CASE';
  if (kind === 'TERMINAL') return 'TERMINAL';
  return container.category === 'CAPSULA' ? 'CAPSULE' : 'PACKAGE';
}

function stockKeysFor(container) {
  return Item.findInStockByCategories(['OUTRO']).filter((unit) => unit.id !== container.id && openingRules.isKey(unit));
}

function steamStoreView() {
  const store = settingsService.getSteamStore();
  return store ? { id: store.id, name: store.name, currency: store.currency } : null;
}

function steamDefaultFxRate(settings) {
  const store = settingsService.getSteamStore();
  if (!store || store.currency === 'USD') return null;
  const rate = rateOf(fxFromSettings(settings), store.currency);
  return isValidFxRate(rate) ? rate : null;
}

// Prévia da abertura: chaves compatíveis, loja Steam e cotação padrão (D363 item 9). Só leitura.
function getOpenOptions(containerId, { now = new Date() } = {}) {
  const { container, kind } = loadOpenable(containerId);
  const settings = Setting.get();
  const base = {
    kind,
    containerName: container.name,
    requiredKeyName: kind === 'CASE' ? openingRules.caseKeyName(container.name) : null,
    keys: [],
    otherKeysInStock: 0,
    steamStore: steamStoreView(),
    // Cotação padrão da moeda da loja Steam (D369): a das configurações; nula se a Steam é em USD ou se falta a cotação.
    defaultFxRate: steamDefaultFxRate(settings),
  };
  if (kind !== 'CASE') return base;
  const stockKeys = stockKeysFor(container);
  const compatible = stockKeys
    .filter((key) => openingRules.keyMatchesCase(key.name, container.name))
    .sort((a, b) => Date.parse(a.acquiredAt) - Date.parse(b.acquiredAt) || a.id - b.id);
  const { costIndex } = operationContext.loadOperationContext(compatible);
  const keys = compatible.map((key) => {
    const cost = costIndex.effectiveOf(key);
    return {
      itemId: key.id,
      name: key.name,
      acquiredAt: key.acquiredAt,
      effectiveCostUsdCents: cost.effectiveUsdCents,
      costEstimated: cost.estimated,
      tradeLocked: isInTradeLock(key, now),
      offSale: isOffSale(key),
    };
  });
  return { ...base, keys, otherKeysInStock: stockKeys.length - compatible.length };
}

// Chave do estoque que abre a caixa; erros por situação (D363 item 4).
function loadKey(container, keyItemId) {
  const key = findOrFail(keyItemId, 'KEY');
  if (key.id === container.id || !openingRules.isKey(key)) {
    throw invalidInput('NOT_A_KEY', 'A unidade escolhida não é uma chave.', 'keyItemId');
  }
  if (key.status !== 'EM_ESTOQUE') throw notInStock(key, 'KEY');
  if (!openingRules.keyMatchesCase(key.name, container.name)) {
    throw unprocessable('CASE_KEY_INCOMPATIBLE', 'Esta chave não abre esta caixa.', { field: 'keyItemId', params: { keyName: key.name, caseName: container.name } });
  }
  return key;
}

function assertGeneratedShape(generated) {
  for (const field of GENERATED_FORBIDDEN_FIELDS) {
    if (hasKey(generated, field)) {
      throw invalidInput('GENERATED_FIELD_NOT_ALLOWED', 'O item obtido herda a aquisição da abertura; não informe este campo.', `generated.${field}`, { field });
    }
  }
}

// `input`: { containerId, keyItemId?, openedAt?, decision?, generated?, paidPriceCents?, fxRateAtPurchase?, note? }.
// Devolve { operation, generatedItem | null, consumedIds }.
function openContainer(input, ctx = {}) {
  const { now = new Date() } = ctx;
  return runInTransaction(() => {
    const { container, kind } = loadOpenable(input.containerId);

    // Chave e decisão conforme o tipo.
    let key = null;
    if (kind === 'CASE') {
      if (isNil(input.keyItemId)) {
        throw unprocessable('CASE_KEY_REQUIRED', 'Esta caixa precisa de uma chave do estoque.', {
          field: 'keyItemId', params: { keyName: openingRules.caseKeyName(container.name) },
        });
      }
      key = loadKey(container, input.keyItemId);
    } else if (!isNil(input.keyItemId)) {
      throw invalidInput('KEY_NOT_ALLOWED', 'Este item não usa chave.', 'keyItemId');
    }
    const decision = isNil(input.decision) ? null : input.decision;
    if (kind === 'TERMINAL') {
      if (decision === null) throw invalidInput('DECISION_REQUIRED', 'Escolha comprar ou não comprar o item do terminal.', 'decision');
      if (!DECISIONS.includes(decision)) throw invalidInput('DECISION_INVALID', 'Decisão inválida. Use BUY ou DECLINE.', 'decision');
    } else if (decision !== null) {
      throw invalidInput('DECISION_NOT_ALLOWED', 'Só o terminal tem decisão.', 'decision');
    }

    // Preço pago e item obtido.
    const buying = kind === 'TERMINAL' && decision === 'BUY';
    const generates = kind !== 'TERMINAL' || buying;
    const hasPrice = !isNil(input.paidPriceCents) || !isNil(input.fxRateAtPurchase);
    if (hasPrice && !buying) throw invalidInput('PRICE_NOT_ALLOWED', 'Preço e cotação só valem ao comprar o item do terminal.', isNil(input.paidPriceCents) ? 'fxRateAtPurchase' : 'paidPriceCents');
    let steamStore = null;
    if (buying) {
      steamStore = settingsService.getSteamStore();
      if (!steamStore) throw new ConflictError('Escolha a sua loja Steam em Lojas para comprar o item do terminal.', 'STEAM_STORE_REQUIRED');
    }
    if (generates && isNil(input.generated)) throw unprocessable('GENERATED_ITEM_REQUIRED', 'Informe o item obtido na abertura.', { field: 'generated' });
    if (!generates && !isNil(input.generated)) throw invalidInput('GENERATED_NOT_ALLOWED', 'Não comprar o item do terminal não gera nenhum item.', 'generated');
    if (generates) assertGeneratedShape(input.generated);

    // Data.
    const openedAt = isNil(input.openedAt) ? now : parseDate(input.openedAt, 'Data da abertura', { field: 'openedAt' });
    const lowerBounds = [{ reason: 'BEFORE_CONTAINER_ACQUIRED', at: container.acquiredAt }];
    if (key) lowerBounds.push({ reason: 'BEFORE_KEY_ACQUIRED', at: key.acquiredAt });
    assertDate(openedAt, { now, lowerBounds, field: 'openedAt', errorField: 'openedAt' });
    const stamp = openedAt.toISOString();

    // Item obtido: a mesma montagem do cadastro, sem gravar ainda.
    let prepared = null;
    if (generates) {
      const acquisition = buying
        ? { type: 'COMPRA', store: steamStore, priceCents: input.paidPriceCents, fxRate: isNil(input.fxRateAtPurchase) ? null : input.fxRateAtPurchase }
        : { type: 'GERADO' };
      prepared = itemService.prepareItemRecord(input.generated, { acquisition, acquiredAt: openedAt, now });
      if (!isNil(prepared.record.tradeUnlockAt) && Date.parse(prepared.record.tradeUnlockAt) < openedAt.getTime()) {
        throw invalidDate('A liberação da troca não pode ser anterior à abertura.', 'TRADE_UNLOCK_BEFORE_OPENED', { tradeUnlockAt: prepared.record.tradeUnlockAt }, 'tradeUnlockAt');
      }
    }

    let note = null;
    if (!isNil(input.note)) {
      note = String(input.note).trim();
      if (note.length > MAX_NOTE_LENGTH) {
        throw unprocessable('FIELD_TOO_LONG', `A observação deve ter no máximo ${MAX_NOTE_LENGTH} caracteres.`, { field: 'note', params: { maxLength: MAX_NOTE_LENGTH } });
      }
      if (note === '') note = null;
    }

    // Efeito.
    const detail = { container: containerLabel(container, kind) };
    if (kind === 'TERMINAL') detail.decision = decision;
    const operation = ItemOperation.createOperation(
      {
        kind: kind === 'TERMINAL' ? 'OPEN_TERMINAL' : 'OPEN_CASE',
        outcome: generates ? 'TRANSFERRED' : 'LOST',
        occurredAt: stamp,
        note,
        detailJson: JSON.stringify(detail),
      },
      { now }
    );
    ItemOperation.createLink({ operationId: operation.id, itemId: container.id, role: 'CONSUMED', costShareBp: null });
    if (key) ItemOperation.createLink({ operationId: operation.id, itemId: key.id, role: 'CONSUMED', costShareBp: null });
    let generatedItem = null;
    if (prepared) {
      generatedItem = Item.create(prepared.record, { now });
      if (prepared.components && prepared.components.length > 0) ItemComponent.insertMany(generatedItem.id, prepared.components, { now });
      ItemOperation.createLink({ operationId: operation.id, itemId: generatedItem.id, role: 'CREATED', costShareBp: null });
    }
    // Holding e trade lock das consumidas ficam como estão: o desfazer as devolve como estavam.
    const consumedIds = [container.id, ...(key ? [key.id] : [])];
    for (const id of consumedIds) Item.update(id, { status: 'CONSUMIDO', consumedAt: stamp }, { now });
    return { operation, generatedItem, consumedIds };
  });
}

module.exports = { DECISIONS, MAX_NOTE_LENGTH, GENERATED_FORBIDDEN_FIELDS, getOpenOptions, openContainer };

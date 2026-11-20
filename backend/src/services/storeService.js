'use strict';

const Store = require('../models/Store');
const { ValidationError, NotFoundError } = require('../errors/AppError');
const { saleFeeParamsFromStore } = require('./fees');
const { computeSale } = require('./pricingService');

function withFlags(store) {
  return { ...store, saleFeesConfigured: saleFeeParamsFromStore(store) !== null };
}

function listStores({ activeOnly = false } = {}) {
  return Store.findAll({ activeOnly }).map(withFlags);
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
  const { netReceivedCents, feeCents } = computeSale({ salePriceCents, store });
  return { storeId: store.id, currency: store.currency, salePriceCents, feeCents, netReceivedCents };
}

module.exports = { listStores, getStoreOrFail, quoteSale };

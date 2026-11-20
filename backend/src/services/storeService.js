'use strict';

const Store = require('../models/Store');
const { ValidationError } = require('../errors/AppError');
const { saleFeeParamsFromStore } = require('./fees');

function withFlags(store) {
  return { ...store, saleFeesConfigured: saleFeeParamsFromStore(store) !== null };
}

function listStores({ activeOnly = false } = {}) {
  return Store.findAll({ activeOnly }).map(withFlags);
}

// Referência no corpo da requisição: inexistente = 400. Aceita loja ativa ou inativa (Q2).
function getStoreOrFail(id) {
  const store = Store.findById(id);
  if (!store) throw new ValidationError('Loja não encontrada.', 'STORE_NOT_FOUND');
  return store;
}

module.exports = { listStores, getStoreOrFail };

'use strict';

// Loja da integração (revisão da Etapa 9): precisa existir e ser em dólar, porque os valores do CSFloat são em centavos de US$.
// Usada pela importação, pela resolução de pendências e pela conferência de saldo (antes eram três cópias, e a das pendências
// não conferia a moeda: com a loja trocada para R$, "Foi drop" gravava dólares como reais).
const Store = require('../../models/Store');
const { ConflictError, ValidationError } = require('../../errors/AppError');

function requireImportStore(row) {
  const store = row && row.storeId !== null && row.storeId !== undefined ? Store.findById(row.storeId) : null;
  if (!store) throw new ConflictError('Crie, em Lojas, uma loja em US$ chamada "CSFloat".', 'IMPORT_STORE_REQUIRED');
  if (store.currency !== 'USD') {
    throw new ValidationError('A loja da integração precisa ser em dólar (US$).', 'IMPORT_STORE_CURRENCY_NOT_ALLOWED', { field: 'storeId' });
  }
  return store;
}

module.exports = { requireImportStore };

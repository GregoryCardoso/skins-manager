const { getDb } = require('../config/database');
const { mapRow, insertRow } = require('./modelHelpers');

const FIELDS = [
  'storeId', 'kind', 'balanceCents', 'computedCents', 'adjustmentCents', 'fxRate', 'note', 'recordedAt',
];

function findById(id) {
  return mapRow(getDb().prepare('SELECT * FROM store_balances WHERE id = ?').get(id));
}

// Só existe um tipo de registro (D253): a conferência (inclusive os registros antigos, sem cálculo).
function create(data, { now = new Date() } = {}) {
  const id = insertRow(getDb(), 'store_balances', { ...data, kind: 'CHECK' }, FIELDS, { created_at: now.toISOString() });
  return findById(Number(id));
}

// Todas as entradas (esquema v9: só conferências e registros antigos, sem saldo inicial), do mais recente para o mais antigo.
function findAllEntries() {
  return getDb()
    .prepare('SELECT * FROM store_balances ORDER BY recorded_at DESC, id DESC')
    .all()
    .map((r) => mapRow(r));
}

function findByStore(storeId) {
  return getDb()
    .prepare('SELECT * FROM store_balances WHERE store_id = ? ORDER BY recorded_at DESC, id DESC')
    .all(storeId)
    .map((r) => mapRow(r));
}

function remove(id) {
  return getDb().prepare('DELETE FROM store_balances WHERE id = ?').run(id).changes > 0;
}

module.exports = { create, findById, findAllEntries, findByStore, remove };

const { getDb } = require('../config/database');
const { mapRow, insertRow, updateRow } = require('./modelHelpers');

const FIELDS = ['storeId', 'amountStoreCents', 'amountBrlCents', 'depositedAt', 'note'];

function findById(id) {
  return mapRow(getDb().prepare('SELECT * FROM deposits WHERE id = ?').get(id));
}

function create(data, { now = new Date() } = {}) {
  const stamp = now.toISOString();
  const id = insertRow(getDb(), 'deposits', data, FIELDS, { created_at: stamp, updated_at: stamp });
  return findById(Number(id));
}

function findAll() {
  return getDb()
    .prepare('SELECT * FROM deposits ORDER BY deposited_at DESC, id DESC')
    .all()
    .map((r) => mapRow(r));
}

function update(id, partial = {}, { now = new Date() } = {}) {
  const changes = updateRow(getDb(), 'deposits', id, partial, FIELDS, { updated_at: now.toISOString() });
  return changes === 0 ? null : findById(id);
}

function remove(id) {
  return getDb().prepare('DELETE FROM deposits WHERE id = ?').run(id).changes > 0;
}

// Data do aporte mais recente de uma loja (sugestão da data de corte da importação).
function maxDepositedAt(storeId) {
  const row = getDb().prepare('SELECT MAX(deposited_at) AS latest FROM deposits WHERE store_id = ?').get(storeId);
  return row ? row.latest : null;
}

module.exports = { maxDepositedAt, create, findById, findAll, update, remove };

const { getDb } = require('../config/database');
const { mapRow, insertRow } = require('./modelHelpers');

const FIELDS = ['storeId', 'balanceCents', 'fxRate', 'recordedAt'];

function findById(id) {
  return mapRow(getDb().prepare('SELECT * FROM store_balances WHERE id = ?').get(id));
}

function create(data, { now = new Date() } = {}) {
  const id = insertRow(getDb(), 'store_balances', data, FIELDS, { created_at: now.toISOString() });
  return findById(Number(id));
}

function findLatestAll() {
  return getDb()
    .prepare(
      `SELECT sb.* FROM store_balances sb
       WHERE sb.id = (
         SELECT id FROM store_balances
         WHERE store_id = sb.store_id
         ORDER BY recorded_at DESC, id DESC LIMIT 1
       )
       ORDER BY sb.store_id ASC`
    )
    .all()
    .map((r) => mapRow(r));
}

function findHistory(storeId) {
  return getDb()
    .prepare('SELECT * FROM store_balances WHERE store_id = ? ORDER BY recorded_at DESC, id DESC')
    .all(storeId)
    .map((r) => mapRow(r));
}

// Todo o histórico (todas as lojas), do mais recente para o mais antigo.
function findAll() {
  return getDb()
    .prepare('SELECT * FROM store_balances ORDER BY recorded_at DESC, id DESC')
    .all()
    .map((r) => mapRow(r));
}

function remove(id) {
  return getDb().prepare('DELETE FROM store_balances WHERE id = ?').run(id).changes > 0;
}

module.exports = { create, findById, findLatestAll, findHistory, findAll, remove };

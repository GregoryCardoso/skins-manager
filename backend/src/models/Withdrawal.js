const { getDb } = require('../config/database');
const { mapRow, insertRow, updateRow } = require('./modelHelpers');

const FIELDS = ['storeId', 'amountStoreCents', 'feeCents', 'amountBrlCents', 'amountBrlCurrency', 'withdrawnAt', 'note'];

function findById(id) {
  return mapRow(getDb().prepare('SELECT * FROM withdrawals WHERE id = ?').get(id));
}

function create(data, { now = new Date() } = {}) {
  const stamp = now.toISOString();
  const id = insertRow(getDb(), 'withdrawals', data, FIELDS, { created_at: stamp, updated_at: stamp });
  return findById(Number(id));
}

function findAll() {
  return getDb()
    .prepare('SELECT * FROM withdrawals ORDER BY withdrawn_at DESC, id DESC')
    .all()
    .map((r) => mapRow(r));
}

// Há saque sem loja? EXISTS para não carregar a tabela inteira (S2, 12.10).
function existsWithoutStore() {
  return getDb().prepare('SELECT EXISTS(SELECT 1 FROM withdrawals WHERE store_id IS NULL) AS found').get().found === 1;
}

function update(id, partial = {}, { now = new Date() } = {}) {
  const changes = updateRow(getDb(), 'withdrawals', id, partial, FIELDS, { updated_at: now.toISOString() });
  return changes === 0 ? null : findById(id);
}

function remove(id) {
  return getDb().prepare('DELETE FROM withdrawals WHERE id = ?').run(id).changes > 0;
}

module.exports = { existsWithoutStore, create, findById, findAll, update, remove };

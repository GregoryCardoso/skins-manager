const { getDb } = require('../config/database');
const { mapRow, insertRow, updateRow } = require('./modelHelpers');

const FIELDS = ['storeId', 'amountStoreCents', 'amountBrlCents', 'withdrawnAt', 'note'];

function findById(id) {
  return mapRow(getDb().prepare('SELECT * FROM withdrawals WHERE id = ?').get(id));
}

function create(data) {
  const now = new Date().toISOString();
  const id = insertRow(getDb(), 'withdrawals', data, FIELDS, { created_at: now, updated_at: now });
  return findById(Number(id));
}

function findAll({ from, to } = {}) {
  const conditions = [];
  const params = [];
  if (from !== undefined) {
    conditions.push('withdrawn_at >= ?');
    params.push(from);
  }
  if (to !== undefined) {
    conditions.push('withdrawn_at <= ?');
    params.push(to);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return getDb()
    .prepare(`SELECT * FROM withdrawals ${where} ORDER BY withdrawn_at DESC, id DESC`)
    .all(...params)
    .map((r) => mapRow(r));
}

function findLatestByStore(storeId, limit) {
  return getDb()
    .prepare('SELECT * FROM withdrawals WHERE store_id = ? ORDER BY withdrawn_at DESC, id DESC LIMIT ?')
    .all(storeId, limit)
    .map((r) => mapRow(r));
}

function update(id, partial = {}) {
  const changes = updateRow(getDb(), 'withdrawals', id, partial, FIELDS, { updated_at: new Date().toISOString() });
  return changes === 0 ? null : findById(id);
}

function remove(id) {
  return getDb().prepare('DELETE FROM withdrawals WHERE id = ?').run(id).changes > 0;
}

function sumAmountBrlCents() {
  return getDb().prepare('SELECT COALESCE(SUM(amount_brl_cents), 0) AS total FROM withdrawals').get().total;
}

module.exports = { create, findById, findAll, findLatestByStore, update, remove, sumAmountBrlCents };

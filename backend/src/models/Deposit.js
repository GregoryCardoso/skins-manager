const { getDb } = require('../config/database');
const { mapRow, insertRow, updateRow } = require('./modelHelpers');

const FIELDS = ['amountBrlCents', 'depositedAt', 'storeId', 'note'];

function findById(id) {
  return mapRow(getDb().prepare('SELECT * FROM deposits WHERE id = ?').get(id));
}

function create(data, { now = new Date() } = {}) {
  const stamp = now.toISOString();
  const id = insertRow(getDb(), 'deposits', data, FIELDS, { created_at: stamp, updated_at: stamp });
  return findById(Number(id));
}

function findAll({ from, to } = {}) {
  const conditions = [];
  const params = [];
  if (from !== undefined) {
    conditions.push('deposited_at >= ?');
    params.push(from);
  }
  if (to !== undefined) {
    conditions.push('deposited_at <= ?');
    params.push(to);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return getDb()
    .prepare(`SELECT * FROM deposits ${where} ORDER BY deposited_at DESC, id DESC`)
    .all(...params)
    .map((r) => mapRow(r));
}

function update(id, partial = {}, { now = new Date() } = {}) {
  const changes = updateRow(getDb(), 'deposits', id, partial, FIELDS, { updated_at: now.toISOString() });
  return changes === 0 ? null : findById(id);
}

function remove(id) {
  return getDb().prepare('DELETE FROM deposits WHERE id = ?').run(id).changes > 0;
}

function sumAmountBrlCents() {
  return getDb().prepare('SELECT COALESCE(SUM(amount_brl_cents), 0) AS total FROM deposits').get().total;
}

module.exports = { create, findById, findAll, update, remove, sumAmountBrlCents };

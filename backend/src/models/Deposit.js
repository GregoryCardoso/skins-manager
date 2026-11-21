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

module.exports = { create, findById, findAll, update, remove };

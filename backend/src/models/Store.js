const { getDb } = require('../config/database');
const { mapRow, insertRow, updateRow } = require('./modelHelpers');

const FIELDS = [
  'name', 'currency', 'isActive', 'isPrimary', 'saleFeeType', 'saleFeeRate', 'saleFeeRounding',
  'saleMinFeeCents', 'saleFixedFeeCents', 'allowsWithdrawal', 'withdrawalFeeRate', 'withdrawalFixedFeeCents',
];
const BOOLEANS = ['isActive', 'isPrimary', 'allowsWithdrawal'];

const map = (row) => mapRow(row, BOOLEANS);

function findById(id) {
  return map(getDb().prepare('SELECT * FROM stores WHERE id = ?').get(id));
}

function create(data) {
  const now = new Date().toISOString();
  const id = insertRow(getDb(), 'stores', data, FIELDS, { created_at: now, updated_at: now });
  return findById(Number(id));
}

function findAll({ activeOnly = false } = {}) {
  const where = activeOnly ? 'WHERE is_active = 1' : '';
  return getDb().prepare(`SELECT * FROM stores ${where} ORDER BY name COLLATE NOCASE ASC, id ASC`).all().map(map);
}

function findPrimary() {
  return map(getDb().prepare('SELECT * FROM stores WHERE is_primary = 1').get());
}

function update(id, partial = {}) {
  const changes = updateRow(getDb(), 'stores', id, partial, FIELDS, { updated_at: new Date().toISOString() });
  return changes === 0 ? null : findById(id);
}

function remove(id) {
  return getDb().prepare('DELETE FROM stores WHERE id = ?').run(id).changes > 0;
}

module.exports = { create, findById, findAll, findPrimary, update, remove };

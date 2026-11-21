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

function create(data, { now = new Date() } = {}) {
  const stamp = now.toISOString();
  const id = insertRow(getDb(), 'stores', data, FIELDS, { created_at: stamp, updated_at: stamp });
  return findById(Number(id));
}

function findAll({ activeOnly = false } = {}) {
  const where = activeOnly ? 'WHERE is_active = 1' : '';
  return getDb().prepare(`SELECT * FROM stores ${where} ORDER BY name COLLATE NOCASE ASC, id ASC`).all().map(map);
}

function findPrimary() {
  return map(getDb().prepare('SELECT * FROM stores WHERE is_primary = 1').get());
}

function update(id, partial = {}, { now = new Date() } = {}) {
  const changes = updateRow(getDb(), 'stores', id, partial, FIELDS, { updated_at: now.toISOString() });
  return changes === 0 ? null : findById(id);
}

function remove(id) {
  return getDb().prepare('DELETE FROM stores WHERE id = ?').run(id).changes > 0;
}

// O nome é COLLATE NOCASE na tabela: a comparação ignora maiúsculas.
function findByName(name) {
  return map(getDb().prepare('SELECT * FROM stores WHERE name = ?').get(name));
}

// Ids de lojas referenciadas por itens (compra ou venda), aportes, saques ou saldos (D145), numa só consulta.
function findUsedIds() {
  const rows = getDb()
    .prepare(
      `SELECT purchase_store_id AS id FROM items WHERE purchase_store_id IS NOT NULL
       UNION SELECT sale_store_id FROM items WHERE sale_store_id IS NOT NULL
       UNION SELECT store_id FROM deposits WHERE store_id IS NOT NULL
       UNION SELECT store_id FROM withdrawals WHERE store_id IS NOT NULL
       UNION SELECT store_id FROM store_balances`
    )
    .all();
  return rows.map((row) => row.id);
}

function isInUse(id) {
  return getDb()
    .prepare(
      `SELECT 1 AS used WHERE EXISTS (SELECT 1 FROM items WHERE purchase_store_id = @id OR sale_store_id = @id)
         OR EXISTS (SELECT 1 FROM deposits WHERE store_id = @id)
         OR EXISTS (SELECT 1 FROM withdrawals WHERE store_id = @id)
         OR EXISTS (SELECT 1 FROM store_balances WHERE store_id = @id)`
    )
    .get({ id }) !== undefined;
}

// Remove a marca de principal de todas as lojas (o índice único parcial exige fazer antes de marcar outra).
function clearPrimary({ now = new Date() } = {}) {
  return getDb()
    .prepare('UPDATE stores SET is_primary = 0, updated_at = ? WHERE is_primary = 1')
    .run(now.toISOString()).changes;
}

module.exports = { create, findById, findAll, findPrimary, findByName, findUsedIds, isInUse, clearPrimary, update, remove };

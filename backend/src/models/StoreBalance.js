const { getDb } = require('../config/database');
const { mapRow, insertRow } = require('./modelHelpers');

const FIELDS = ['storeId', 'balanceCents', 'fxRate', 'recordedAt'];

function findById(id) {
  return mapRow(getDb().prepare('SELECT * FROM store_balances WHERE id = ?').get(id));
}

function create(data) {
  const id = insertRow(getDb(), 'store_balances', data, FIELDS, { created_at: new Date().toISOString() });
  return findById(Number(id));
}

function findLatestByStore(storeId) {
  return mapRow(
    getDb()
      .prepare('SELECT * FROM store_balances WHERE store_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 1')
      .get(storeId)
  );
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

module.exports = { create, findById, findLatestByStore, findLatestAll, findHistory };

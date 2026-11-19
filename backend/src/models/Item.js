const { getDb } = require('../config/database');
const { mapRow, insertRow, updateRow } = require('./modelHelpers');

const FIELDS = [
  'name', 'category', 'variant', 'floatValue', 'exterior', 'paintSeed', 'phase', 'inspectLink', 'assetId',
  'acquisitionType', 'originDetail', 'purchaseStoreId', 'purchasePriceCents', 'purchaseCurrency',
  'fxRateAtPurchase', 'acquiredAt', 'tradeUnlockAt', 'status', 'saleStoreId', 'salePriceCents',
  'saleCurrency', 'fxRateAtSale', 'saleFeeTypeApplied', 'saleFeeRateApplied', 'saleFeeRoundingApplied',
  'saleMinFeeCentsApplied', 'saleFixedFeeCentsApplied', 'netReceivedCents', 'soldAt',
];

function findById(id) {
  return mapRow(getDb().prepare('SELECT * FROM items WHERE id = ?').get(id));
}

function create(data) {
  const now = new Date().toISOString();
  const id = insertRow(getDb(), 'items', data, FIELDS, { created_at: now, updated_at: now });
  return findById(Number(id));
}

function findAll({ status, category } = {}) {
  const conditions = [];
  const params = [];
  if (status !== undefined) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (category !== undefined) {
    conditions.push('category = ?');
    params.push(category);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return getDb().prepare(`SELECT * FROM items ${where} ORDER BY id ASC`).all(...params).map((r) => mapRow(r));
}

function update(id, partial = {}) {
  const changes = updateRow(getDb(), 'items', id, partial, FIELDS, { updated_at: new Date().toISOString() });
  return changes === 0 ? null : findById(id);
}

function remove(id) {
  return getDb().prepare('DELETE FROM items WHERE id = ?').run(id).changes > 0;
}

module.exports = { create, findById, findAll, update, remove };

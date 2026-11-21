const { getDb } = require('../config/database');
const { mapRow, insertRow, updateRow } = require('./modelHelpers');

const FIELDS = [
  'catalogId', 'name', 'category', 'variant', 'floatValue', 'exterior', 'paintSeed', 'phase', 'inspectLink', 'assetId',
  'acquisitionType', 'originDetail', 'purchaseStoreId', 'purchasePriceCents', 'purchaseCurrency',
  'fxRateAtPurchase', 'acquiredAt', 'tradeUnlockAt', 'status', 'saleStoreId', 'salePriceCents',
  'saleCurrency', 'fxRateAtSale', 'saleFeeTypeApplied', 'saleFeeRateApplied', 'saleFeeRoundingApplied',
  'saleMinFeeCentsApplied', 'saleFixedFeeCentsApplied', 'netReceivedCents', 'netReceivedManual', 'soldAt', 'saleHoldDaysApplied',
];
const BOOLEAN_FIELDS = ['netReceivedManual'];
const toItem = (row) => mapRow(row, BOOLEAN_FIELDS);

function findById(id) {
  return toItem(getDb().prepare('SELECT * FROM items WHERE id = ?').get(id));
}

function create(data, { now = new Date() } = {}) {
  const stamp = now.toISOString();
  const id = insertRow(getDb(), 'items', data, FIELDS, { created_at: stamp, updated_at: stamp });
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
  return getDb().prepare(`SELECT * FROM items ${where} ORDER BY id ASC`).all(...params).map(toItem);
}

// Itens sem vínculo com o catálogo nas categorias que o exigem (D82).
function findLegacy(catalogCategories) {
  if (!catalogCategories.length) return [];
  const marks = catalogCategories.map(() => '?').join(',');
  return getDb()
    .prepare(`SELECT * FROM items WHERE catalog_id IS NULL AND category IN (${marks}) ORDER BY id ASC`)
    .all(...catalogCategories)
    .map(toItem);
}

// Itens candidatos ao grupo de histórico (T27) de uma categoria e nome (estruturados, sem interpretar texto de chave).
// Filtra no SQL por categoria e pelos termos ASCII do nome (LIKE ignora maiúsculas só em ASCII; termos com
// outros caracteres ficam para o refino em JS). Quem chama refina comparando a chave completa (itemStatsService).
function findStatsCandidates({ category, name }) {
  name = String(name ?? '');
  const escapeLike = (text) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const tokens = name
    .split(' ')
    .filter((token) => token !== '' && /^[\x20-\x7e]+$/.test(token));
  const conditions = ['category = ?'];
  const params = [category];
  for (const token of tokens) {
    conditions.push("lower(name) LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(token.toLowerCase())}%`);
  }
  return getDb()
    .prepare(`SELECT * FROM items WHERE ${conditions.join(' AND ')} ORDER BY id ASC`)
    .all(...params)
    .map(toItem);
}

function update(id, partial = {}, { now = new Date() } = {}) {
  const changes = updateRow(getDb(), 'items', id, partial, FIELDS, { updated_at: now.toISOString() });
  return changes === 0 ? null : findById(id);
}

function remove(id) {
  return getDb().prepare('DELETE FROM items WHERE id = ?').run(id).changes > 0;
}

function countAll() {
  return getDb().prepare('SELECT COUNT(*) AS n FROM items').get().n;
}

module.exports = { countAll, create, findById, findAll, findStatsCandidates, findLegacy, update, remove };

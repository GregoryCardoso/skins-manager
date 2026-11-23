const { getDb } = require('../config/database');
const { mapRow, insertRow, updateRow } = require('./modelHelpers');

const FIELDS = [
  'catalogId', 'name', 'category', 'variant', 'floatValue', 'exterior', 'paintSeed', 'phase', 'inspectLink', 'assetId',
  'acquisitionType', 'originDetail', 'purchaseStoreId', 'purchasePriceCents', 'purchaseCurrency',
  'fxRateAtPurchase', 'acquiredAt', 'tradeUnlockAt', 'status', 'saleStoreId', 'salePriceCents',
  'saleCurrency', 'fxRateAtSale', 'saleFeeTypeApplied', 'saleFeeRateApplied', 'saleFeeRoundingApplied',
  'saleMinFeeCentsApplied', 'saleFixedFeeCentsApplied', 'netReceivedCents', 'netReceivedManual', 'soldAt', 'saleHoldDaysApplied',
  'offSaleAt', 'forSaleSince', 'saleReleaseAt',
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

// Compras (`COMPRA`) da loja, sem vínculo de importação, a partir de `acquiredFrom` (ISO), em qualquer status.
// Candidatas ao casamento com os trades importados.
function findUnlinkedPurchases(storeId, { acquiredFrom }) {
  return getDb()
    .prepare(
      `SELECT * FROM items i WHERE i.acquisition_type = 'COMPRA' AND i.purchase_store_id = ? AND i.acquired_at >= ?
         AND NOT EXISTS (SELECT 1 FROM external_links l WHERE l.entity_type = 'ITEM_PURCHASE' AND l.entity_id = i.id)
       ORDER BY i.acquired_at ASC, i.id ASC`
    )
    .all(storeId, acquiredFrom)
    .map(toItem);
}

// Vendas da loja sem vínculo de venda, vendidas a partir de `soldFrom` (ISO): candidatas ao casamento com as vendas importadas.
function findUnlinkedSales(storeId, { soldFrom }) {
  return getDb()
    .prepare(
      `SELECT * FROM items i WHERE i.status = 'VENDIDO' AND i.sale_store_id = ? AND i.sold_at >= ?
         AND NOT EXISTS (SELECT 1 FROM external_links l WHERE l.entity_type = 'ITEM_SALE' AND l.entity_id = i.id)
       ORDER BY i.sold_at ASC, i.id ASC`
    )
    .all(storeId, soldFrom)
    .map(toItem);
}

// Unidades em estoque de um item do catálogo (mais as de mesma categoria sem catálogo, para o refino por nome em quem chama).
// `catalogId` nulo: só pela categoria. Candidatas à unidade vendida por uma venda importada (de qualquer loja de compra).
function findInStockByCatalogOrCategory({ catalogId, category }) {
  if (catalogId === null || catalogId === undefined) {
    return getDb().prepare("SELECT * FROM items WHERE status = 'EM_ESTOQUE' AND catalog_id IS NULL AND category = ? ORDER BY id ASC").all(category).map(toItem);
  }
  return getDb()
    .prepare("SELECT * FROM items WHERE status = 'EM_ESTOQUE' AND (catalog_id = ? OR (catalog_id IS NULL AND category = ?)) ORDER BY id ASC")
    .all(catalogId, category)
    .map(toItem);
}

// Data mais recente de compra (sem vínculo) e de venda (sem vínculo) na loja: sugestão da data de corte.
function latestUnlinkedDates(storeId) {
  const db = getDb();
  const purchase = db
    .prepare(
      `SELECT MAX(i.acquired_at) AS latest FROM items i WHERE i.acquisition_type = 'COMPRA' AND i.purchase_store_id = ?
         AND NOT EXISTS (SELECT 1 FROM external_links l WHERE l.entity_type = 'ITEM_PURCHASE' AND l.entity_id = i.id)`
    )
    .get(storeId);
  const sale = db
    .prepare(
      `SELECT MAX(i.sold_at) AS latest FROM items i WHERE i.status = 'VENDIDO' AND i.sale_store_id = ?
         AND NOT EXISTS (SELECT 1 FROM external_links l WHERE l.entity_type = 'ITEM_SALE' AND l.entity_id = i.id)`
    )
    .get(storeId);
  return { purchaseAt: purchase ? purchase.latest : null, saleAt: sale ? sale.latest : null };
}

module.exports = { findUnlinkedPurchases, findUnlinkedSales, findInStockByCatalogOrCategory, latestUnlinkedDates, countAll, create, findById, findAll, findStatsCandidates, findLegacy, update, remove };

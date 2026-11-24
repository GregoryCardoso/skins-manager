'use strict';

// Acesso à tabela `item_components` (D343, D353): componentes aplicados por unidade. Só SQL, sem regra de negócio.
const { getDb } = require('../config/database');
const { mapRow, insertRow } = require('./modelHelpers');

const FIELDS = [
  'itemId', 'kind', 'catalogId', 'name', 'slot', 'wear', 'pattern', 'purchaseReferenceCents', 'source', 'origin', 'sourceItemId', 'operationId',
];
const CHUNK = 500;
const toComponent = (row) => mapRow(row);
const marks = (list) => list.map(() => '?').join(',');

// Todos os componentes, agrupados por item: Map itemId -> linhas (ordem do id).
function groupByItem(rows) {
  const out = new Map();
  for (const row of rows) {
    if (!out.has(row.itemId)) out.set(row.itemId, []);
    out.get(row.itemId).push(row);
  }
  return out;
}

function listAll() {
  return groupByItem(getDb().prepare('SELECT * FROM item_components ORDER BY item_id ASC, id ASC').all().map(toComponent));
}

// Uma consulta por lote de ids (sem N+1).
function listByItemIds(ids) {
  const unique = [...new Set(ids)];
  const rows = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    rows.push(...getDb().prepare(`SELECT * FROM item_components WHERE item_id IN (${marks(chunk)}) ORDER BY item_id ASC, id ASC`).all(...chunk));
  }
  return groupByItem(rows.map(toComponent));
}

function insertMany(itemId, rows, { now = new Date() } = {}) {
  const stamp = now.toISOString();
  for (const row of rows) insertRow(getDb(), 'item_components', { ...row, itemId }, FIELDS, { created_at: stamp, updated_at: stamp });
}

// Substitui a lista inteira do item (o chamador abre a transação).
function replaceForItem(itemId, rows, { now = new Date() } = {}) {
  getDb().prepare('DELETE FROM item_components WHERE item_id = ?').run(itemId);
  insertMany(itemId, rows, { now });
}

function findById(id) {
  return mapRow(getDb().prepare('SELECT * FROM item_components WHERE id = ?').get(id));
}

// Insere um componente e devolve a linha gravada.
function insertOne(itemId, row, { now = new Date() } = {}) {
  const stamp = now.toISOString();
  const id = insertRow(getDb(), 'item_components', { ...row, itemId }, FIELDS, { created_at: stamp, updated_at: stamp });
  return findById(Number(id));
}

// Troca slot, desgaste e pattern de um componente (aplicado do estoque: o desgaste raspado aos poucos).
function updateNumbers(id, { slot, wear, pattern }, { now = new Date() } = {}) {
  return getDb()
    .prepare('UPDATE item_components SET slot = ?, wear = ?, pattern = ?, updated_at = ? WHERE id = ?')
    .run(slot, wear, pattern, now.toISOString(), id).changes > 0;
}

function remove(id) {
  return getDb().prepare('DELETE FROM item_components WHERE id = ?').run(id).changes > 0;
}

// Componentes criados por uma operação (o desfazer da aplicação os apaga).
function removeByOperation(operationId) {
  return getDb().prepare('DELETE FROM item_components WHERE operation_id = ?').run(operationId).changes;
}

// Substitui só os componentes que vieram junto (os aplicados do estoque ficam; D362). O chamador abre a transação.
function replaceCameWithForItem(itemId, rows, { now = new Date() } = {}) {
  getDb().prepare("DELETE FROM item_components WHERE item_id = ? AND origin = 'CAME_WITH'").run(itemId);
  insertMany(itemId, rows, { now });
}

function countByItemIds(ids) {
  const out = new Map();
  for (const [itemId, rows] of listByItemIds(ids)) out.set(itemId, rows.length);
  return out;
}

module.exports = { replaceCameWithForItem, findById, insertOne, updateNumbers, remove, removeByOperation, listAll, listByItemIds, insertMany, replaceForItem, countByItemIds };

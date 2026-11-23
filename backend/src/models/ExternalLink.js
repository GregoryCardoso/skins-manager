'use strict';

// Acesso à tabela `external_links` (D318): liga um registro externo ao lançamento do app. Só SQL.
const { getDb } = require('../config/database');
const { mapRow, insertRow, updateRow } = require('./modelHelpers');

const FIELDS = ['recordId', 'entityType', 'entityId', 'linkKind', 'batchId', 'entityUpdatedAt'];
const CHUNK = 500;
const toLink = (row) => mapRow(row);
const marks = (list) => list.map(() => '?').join(',');

function create(data, { now = new Date() } = {}) {
  const id = insertRow(getDb(), 'external_links', data, FIELDS, { created_at: now.toISOString() });
  return toLink(getDb().prepare('SELECT * FROM external_links WHERE id = ?').get(Number(id)));
}

function update(id, partial = {}) {
  return updateRow(getDb(), 'external_links', id, partial, FIELDS) > 0;
}

function findByRecordId(recordId) {
  return toLink(getDb().prepare('SELECT * FROM external_links WHERE record_id = ?').get(recordId));
}

// Vínculos de uma lista de registros: Map recordId -> vínculo.
function findByRecordIds(recordIds) {
  const out = new Map();
  const unique = [...new Set(recordIds)];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    for (const row of getDb().prepare(`SELECT * FROM external_links WHERE record_id IN (${marks(chunk)})`).all(...chunk)) {
      out.set(row.record_id, toLink(row));
    }
  }
  return out;
}

function findByEntity(entityType, entityId) {
  return toLink(getDb().prepare('SELECT * FROM external_links WHERE entity_type = ? AND entity_id = ?').get(entityType, entityId));
}

function removeByEntity(entityType, entityId) {
  return getDb().prepare('DELETE FROM external_links WHERE entity_type = ? AND entity_id = ?').run(entityType, entityId).changes;
}

function listByBatch(batchId) {
  return getDb().prepare('SELECT * FROM external_links WHERE batch_id = ? ORDER BY id ASC').all(batchId).map(toLink);
}

function removeByBatch(batchId) {
  return getDb().prepare('DELETE FROM external_links WHERE batch_id = ?').run(batchId).changes;
}

// Itens com vínculo de compra/venda: Map itemId -> fonte (selo "CSFloat"). `itemIds` nulo = todos.
function sourcesByItemIds(itemIds = null) {
  const out = new Map();
  const base = `SELECT l.entity_id AS itemId, r.source AS source FROM external_links l JOIN external_records r ON r.id = l.record_id
    WHERE l.entity_type IN ('ITEM_PURCHASE','ITEM_SALE')`;
  if (itemIds === null) {
    for (const row of getDb().prepare(base).all()) out.set(row.itemId, row.source);
    return out;
  }
  const unique = [...new Set(itemIds)];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    for (const row of getDb().prepare(`${base} AND l.entity_id IN (${marks(chunk)})`).all(...chunk)) out.set(row.itemId, row.source);
  }
  return out;
}

module.exports = { create, update, findByRecordId, findByRecordIds, findByEntity, removeByEntity, listByBatch, removeByBatch, sourcesByItemIds };

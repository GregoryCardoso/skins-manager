'use strict';

// Acesso às tabelas `item_operations` e `item_operation_links` (D355, D362): transformações de unidades (aplicar, raspar...). Só SQL.
const { getDb } = require('../config/database');
const { mapRow, insertRow } = require('./modelHelpers');

const OPERATION_FIELDS = ['kind', 'outcome', 'occurredAt', 'note', 'undoneAt', 'detailJson', 'endedByOperationId'];
const LINK_FIELDS = ['operationId', 'itemId', 'role', 'costShareBp'];
const CHUNK = 500;
const marks = (list) => list.map(() => '?').join(',');

function chunks(ids) {
  const unique = [...new Set(ids)];
  const out = [];
  for (let i = 0; i < unique.length; i += CHUNK) out.push(unique.slice(i, i + CHUNK));
  return out;
}

function findById(id) {
  return mapRow(getDb().prepare('SELECT * FROM item_operations WHERE id = ?').get(id));
}

function createOperation(data, { now = new Date() } = {}) {
  const id = insertRow(getDb(), 'item_operations', data, OPERATION_FIELDS, { created_at: now.toISOString() });
  return findById(Number(id));
}

function createLink(data) {
  return Number(insertRow(getDb(), 'item_operation_links', data, LINK_FIELDS));
}

function markUndone(id, stamp) {
  return getDb().prepare('UPDATE item_operations SET undone_at = ? WHERE id = ? AND undone_at IS NULL').run(stamp, id).changes > 0;
}

// Operações ativas (nem desfeitas nem encerradas por uma separação, D366). As tabelas são pequenas: uma consulta só.
function listActive() {
  return getDb().prepare('SELECT * FROM item_operations WHERE undone_at IS NULL AND ended_by_operation_id IS NULL ORDER BY id ASC').all().map((row) => mapRow(row));
}

function listLinksByOperationIds(operationIds) {
  const rows = [];
  for (const chunk of chunks(operationIds)) {
    rows.push(...getDb().prepare(`SELECT * FROM item_operation_links WHERE operation_id IN (${marks(chunk)}) ORDER BY id ASC`).all(...chunk));
  }
  return rows.map((row) => mapRow(row));
}

// Operações (de qualquer estado) em que o item participa, da mais nova para a mais antiga.
function listByItem(itemId) {
  return getDb()
    .prepare(
      `SELECT o.* FROM item_operations o WHERE o.id IN (SELECT operation_id FROM item_operation_links WHERE item_id = ?) ORDER BY o.id DESC`
    )
    .all(itemId)
    .map((row) => mapRow(row));
}

// Há vínculo do item com alguma operação ativa?
function hasActiveLink(itemId) {
  return Boolean(
    getDb()
      .prepare(
        `SELECT 1 FROM item_operation_links l JOIN item_operations o ON o.id = l.operation_id WHERE l.item_id = ? AND o.undone_at IS NULL AND o.ended_by_operation_id IS NULL LIMIT 1`
      )
      .get(itemId)
  );
}

// Itens (entre os informados) com vínculo em operação ativa.
function itemIdsWithActiveLink(itemIds) {
  const out = new Set();
  for (const chunk of chunks(itemIds)) {
    const rows = getDb()
      .prepare(
        `SELECT DISTINCT l.item_id AS itemId FROM item_operation_links l JOIN item_operations o ON o.id = l.operation_id
          WHERE o.undone_at IS NULL AND o.ended_by_operation_id IS NULL AND l.item_id IN (${marks(chunk)})`
      )
      .all(...chunk);
    for (const row of rows) out.add(row.itemId);
  }
  return out;
}

// Apaga as operações já desfeitas em que o item participa (os vínculos saem em cascata): sem isso o `ON DELETE RESTRICT` impediria a
// exclusão do item. Só depois de conferir que não há vínculo ativo.
function deleteUndoneForItem(itemId) {
  return getDb()
    .prepare(
      `DELETE FROM item_operations WHERE undone_at IS NOT NULL AND id IN (SELECT operation_id FROM item_operation_links WHERE item_id = ?)`
    )
    .run(itemId).changes;
}

// Operação ativa que criou a unidade (vínculo CREATED), ou null.
function findActiveCreatingOperation(itemId) {
  return mapRow(
    getDb()
      .prepare(
        `SELECT o.* FROM item_operations o JOIN item_operation_links l ON l.operation_id = o.id
          WHERE l.item_id = ? AND l.role = 'CREATED' AND o.undone_at IS NULL AND o.ended_by_operation_id IS NULL ORDER BY o.id DESC LIMIT 1`
      )
      .get(itemId)
  );
}

// Apaga o vínculo CREATED (o desfazer da abertura precisa disso antes de excluir a unidade gerada: o vínculo é RESTRICT).
function deleteCreatedLink(operationId, itemId) {
  return getDb().prepare("DELETE FROM item_operation_links WHERE operation_id = ? AND item_id = ? AND role = 'CREATED'").run(operationId, itemId).changes;
}

// Troca o detalhe da operação (JSON em texto).
function updateDetail(id, detailJson) {
  return getDb().prepare('UPDATE item_operations SET detail_json = ? WHERE id = ?').run(detailJson, id).changes > 0;
}

// Encerra uma aplicação (a separação devolveu a unidade) e reabre no desfazer da separação (D366).
function markEnded(id, byOperationId) {
  return getDb().prepare('UPDATE item_operations SET ended_by_operation_id = ? WHERE id = ? AND ended_by_operation_id IS NULL').run(byOperationId, id).changes > 0;
}

function clearEnded(id) {
  return getDb().prepare('UPDATE item_operations SET ended_by_operation_id = NULL WHERE id = ?').run(id).changes > 0;
}

module.exports = {
  markEnded, clearEnded, findActiveCreatingOperation, deleteCreatedLink, updateDetail,
  findById, createOperation, createLink, markUndone, listActive, listLinksByOperationIds, listByItem, hasActiveLink, itemIdsWithActiveLink,
  deleteUndoneForItem,
};

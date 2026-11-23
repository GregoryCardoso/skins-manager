'use strict';

// Acesso à tabela `import_batch_entries` (D318). Só SQL.
const { getDb } = require('../config/database');
const { mapRow, insertRow } = require('./modelHelpers');

const FIELDS = ['batchId', 'recordId', 'outcome', 'reasonCode', 'entityType', 'entityId', 'candidateIds', 'displayJson'];
const OPEN_OUTCOMES = ['POSSIBLE_DUPLICATE', 'REVERTED', 'FAILED', 'UNKNOWN_STATE'];
const OPEN_OUTCOMES_SQL = OPEN_OUTCOMES.map((o) => `'${o}'`).join(',');
// Aberta = sem resolução e de um resultado que pede ação. Para cada registro vale só a entrada aberta mais nova
// (falhas repetidas a cada importação não se acumulam na lista de pendências).
const OPEN_WHERE = `e.resolution IS NULL AND e.outcome IN (${OPEN_OUTCOMES_SQL}) AND NOT EXISTS (
  SELECT 1 FROM import_batch_entries n WHERE n.record_id = e.record_id AND n.id > e.id AND n.resolution IS NULL
    AND n.outcome IN (${OPEN_OUTCOMES_SQL}))`;

const toEntry = (row) => mapRow(row);

function create(data, { now = new Date() } = {}) {
  const id = insertRow(getDb(), 'import_batch_entries', data, FIELDS, { created_at: now.toISOString() });
  return toEntry(getDb().prepare('SELECT * FROM import_batch_entries WHERE id = ?').get(Number(id)));
}

function listByBatch(batchId) {
  return getDb().prepare('SELECT * FROM import_batch_entries WHERE batch_id = ? ORDER BY id ASC').all(batchId).map(toEntry);
}

function listOpen() {
  return getDb().prepare(`SELECT e.* FROM import_batch_entries e WHERE ${OPEN_WHERE} ORDER BY e.id DESC`).all().map(toEntry);
}

function countOpen() {
  return getDb().prepare(`SELECT COUNT(*) AS n FROM import_batch_entries e WHERE ${OPEN_WHERE}`).get().n;
}

function countOpenByBatch(batchIds) {
  const out = new Map(batchIds.map((id) => [id, 0]));
  if (batchIds.length === 0) return out;
  const marks = batchIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT e.batch_id AS batchId, COUNT(*) AS n FROM import_batch_entries e WHERE ${OPEN_WHERE} AND e.batch_id IN (${marks}) GROUP BY e.batch_id`)
    .all(...batchIds);
  for (const row of rows) out.set(row.batchId, row.n);
  return out;
}

// Resolve (todas) as entradas abertas de um registro, de qualquer lote.
function resolveOpenForRecord(recordId, resolution, { now = new Date() } = {}) {
  return getDb()
    .prepare(
      `UPDATE import_batch_entries SET resolution = ?, resolved_at = ? WHERE record_id = ? AND resolution IS NULL AND outcome IN (${OPEN_OUTCOMES_SQL})`
    )
    .run(resolution, now.toISOString(), recordId).changes;
}

// Resolve as entradas abertas de um lote.
function resolveOpenForBatch(batchId, resolution, { now = new Date() } = {}) {
  return getDb()
    .prepare(
      `UPDATE import_batch_entries SET resolution = ?, resolved_at = ? WHERE batch_id = ? AND resolution IS NULL AND outcome IN (${OPEN_OUTCOMES_SQL})`
    )
    .run(resolution, now.toISOString(), batchId).changes;
}

// Resolve todas as entradas abertas (recomeço completo).
function resolveAllOpen(resolution, { now = new Date() } = {}) {
  return getDb()
    .prepare(`UPDATE import_batch_entries SET resolution = ?, resolved_at = ? WHERE resolution IS NULL AND outcome IN (${OPEN_OUTCOMES_SQL})`)
    .run(resolution, now.toISOString()).changes;
}

// Resolve as entradas abertas dos registros cujo primeiro lote é `batchId` (antes de apagá-los no desfazer).
function resolveOpenForRecordsOfBatch(batchId, resolution, { now = new Date() } = {}) {
  return getDb()
    .prepare(
      `UPDATE import_batch_entries SET resolution = ?, resolved_at = ? WHERE resolution IS NULL AND outcome IN (${OPEN_OUTCOMES_SQL})
         AND record_id IN (SELECT id FROM external_records WHERE first_batch_id = ?)`
    )
    .run(resolution, now.toISOString(), batchId).changes;
}

module.exports = {
  OPEN_OUTCOMES, create, listByBatch, listOpen, countOpen, countOpenByBatch, resolveOpenForRecord, resolveOpenForBatch,
  resolveOpenForRecordsOfBatch, resolveAllOpen,
};

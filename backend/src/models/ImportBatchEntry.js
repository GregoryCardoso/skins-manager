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

// Ids (entre os informados) de registros com alguma entrada resolvida como `resolution` (ex.: KEPT = "Manter").
function recordIdsWithResolution(resolution, recordIds) {
  const out = new Set();
  const unique = [...new Set(recordIds)];
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const marks = chunk.map(() => '?').join(',');
    const rows = getDb()
      .prepare(`SELECT DISTINCT record_id FROM import_batch_entries WHERE resolution = ? AND record_id IN (${marks})`)
      .all(resolution, ...chunk);
    for (const row of rows) out.add(row.record_id);
  }
  return out;
}

// `display_json` da entrada CREATED/MATCHED mais recente do registro (a que importou o trade), ou null.
function findLatestDisplayJson(recordId) {
  const row = getDb()
    .prepare("SELECT display_json FROM import_batch_entries WHERE record_id = ? AND outcome IN ('CREATED','MATCHED') ORDER BY id DESC LIMIT 1")
    .get(recordId);
  return row ? row.display_json : null;
}

// O registro já tem uma pendência aberta (de outro lote)? Uma falha repetida não é "novidade" para a importação automática.
function hasOpenForRecord(recordId) {
  return Boolean(
    getDb()
      .prepare(`SELECT 1 FROM import_batch_entries WHERE record_id = ? AND resolution IS NULL AND outcome IN (${OPEN_OUTCOMES_SQL}) LIMIT 1`)
      .get(recordId)
  );
}

function findById(id) {
  return toEntry(getDb().prepare('SELECT * FROM import_batch_entries WHERE id = ?').get(id));
}

// Marca uma entrada como resolvida (ação do usuário na pendência).
function resolve(id, resolution, { now = new Date() } = {}) {
  return getDb()
    .prepare('UPDATE import_batch_entries SET resolution = ?, resolved_at = ? WHERE id = ? AND resolution IS NULL')
    .run(resolution, now.toISOString(), id).changes;
}

// Pendências do lote já resolvidas (fora as do desfazer): aviso ENTRY_RESOLVED no desfazer.
function listResolvedOpenTypeByBatch(batchId) {
  return getDb()
    .prepare(`SELECT * FROM import_batch_entries WHERE batch_id = ? AND outcome IN (${OPEN_OUTCOMES_SQL})
      AND resolution IS NOT NULL AND resolution <> 'UNDONE' ORDER BY id`)
    .all(batchId)
    .map(toEntry);
}

module.exports = {
  hasOpenForRecord, recordIdsWithResolution, findLatestDisplayJson, findById, resolve, listResolvedOpenTypeByBatch,
  OPEN_OUTCOMES, create, listByBatch, listOpen, countOpen, countOpenByBatch, resolveOpenForRecord, resolveOpenForBatch,
  resolveOpenForRecordsOfBatch, resolveAllOpen,
};

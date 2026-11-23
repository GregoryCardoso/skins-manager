'use strict';

// Acesso à tabela `import_batches` (D318). Só SQL. As colunas JSON ficam como texto; quem interpreta é o service.
const { getDb } = require('../config/database');
const { mapRow, insertRow, updateRow } = require('./modelHelpers');

const FIELDS = [
  'source', 'trigger', 'status', 'startedAt', 'finishedAt', 'fullScan', 'cutoffAt', 'tradePagesRead', 'transactionPagesRead',
  'purchasesCreated', 'salesCreated', 'depositsCreated', 'withdrawalsCreated', 'matchedCount', 'knownCount', 'beforeCutoffCount',
  'notTransferredCount', 'reviewCount', 'revertedCount', 'failedCount', 'unknownStateCount', 'deferredCount', 'withoutPurchaseCount',
  'unknownTypesJson', 'diagnosticsJson', 'warningsJson', 'previousTransactionCursor', 'errorCode', 'undoneAt',
];
const BOOLEANS = ['fullScan'];
const CHANGE_COLUMNS = 'purchases_created + matched_count + sales_created + deposits_created + withdrawals_created';

const toBatch = (row) => mapRow(row, BOOLEANS);

function findById(id) {
  return toBatch(getDb().prepare('SELECT * FROM import_batches WHERE id = ?').get(id));
}

function create(data, { now = new Date() } = {}) {
  const id = insertRow(getDb(), 'import_batches', data, FIELDS, { created_at: now.toISOString() });
  return findById(Number(id));
}

function update(id, partial = {}) {
  const changes = updateRow(getDb(), 'import_batches', id, partial, FIELDS);
  return changes === 0 ? null : findById(id);
}

// Lotes da fonte, do mais novo para o mais antigo. `before`: só ids menores que ele.
function list(source, { limit, before = null } = {}) {
  const params = [source];
  let where = 'source = ?';
  if (before !== null) {
    where += ' AND id < ?';
    params.push(before);
  }
  return getDb()
    .prepare(`SELECT * FROM import_batches WHERE ${where} ORDER BY id DESC LIMIT ?`)
    .all(...params, limit)
    .map(toBatch);
}

// O lote mais recente `DONE` que mudou algo (criou ou ligou lançamentos); é o único que pode ser desfeito.
function findLatestUndoable(source) {
  return toBatch(
    getDb()
      .prepare(`SELECT * FROM import_batches WHERE source = ? AND status = 'DONE' AND (${CHANGE_COLUMNS}) > 0 ORDER BY id DESC LIMIT 1`)
      .get(source)
  );
}

function countDone(source, { excludeId = null } = {}) {
  return getDb()
    .prepare("SELECT COUNT(*) AS n FROM import_batches WHERE source = ? AND status = 'DONE' AND id <> ?")
    .get(source, excludeId === null ? -1 : excludeId).n;
}

// Lotes `DONE` que mudaram algo (criaram ou ligaram lançamentos), exceto `excludeId`.
function countDoneWithChanges(source, { excludeId = null } = {}) {
  return getDb()
    .prepare(`SELECT COUNT(*) AS n FROM import_batches WHERE source = ? AND status = 'DONE' AND (${CHANGE_COLUMNS}) > 0 AND id <> ?`)
    .get(source, excludeId === null ? -1 : excludeId).n;
}

// Último lote concluído (para restaurar "última importação" depois de desfazer).
function findLatestDone(source) {
  return toBatch(getDb().prepare("SELECT * FROM import_batches WHERE source = ? AND status = 'DONE' ORDER BY id DESC LIMIT 1").get(source));
}

// `undone_at` do lote desfeito mais recente (ou null).
function findLatestUndoneAt(source) {
  const row = getDb().prepare("SELECT MAX(undone_at) AS at FROM import_batches WHERE source = ? AND status = 'UNDONE'").get(source);
  return row ? row.at : null;
}

// Apaga um lote (importação automática sem nada para mostrar, D300). As entradas vão junto (CASCADE); os registros perdem a
// referência (SET NULL). Nunca chamado com vínculos no lote.
function remove(id) {
  return getDb().prepare('DELETE FROM import_batches WHERE id = ?').run(id).changes > 0;
}

module.exports = { findLatestUndoneAt, remove, create, update, findById, list, findLatestUndoable, findLatestDone, countDone, countDoneWithChanges };

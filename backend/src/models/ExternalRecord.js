'use strict';

// Acesso à tabela `external_records` (D318): trades e transações lidos da loja externa. Só SQL.
// Guarda só os campos da allowlist (D309): nunca dados da outra parte, trade_url, trade_token nem ids de pagamento.
const { getDb } = require('../config/database');
const { mapRow, insertRow, updateRow } = require('./modelHelpers');

const FIELDS = [
  'source', 'kind', 'externalId', 'accountFingerprint', 'contractId', 'relatedTradeId', 'direction', 'txType', 'rawState',
  'offerState', 'tracking', 'externalCreatedAt', 'soldAt', 'acceptedAt', 'protectionEndsAt', 'verifySaleAt', 'amountCents',
  'balanceOffsetCents', 'pendingOffsetCents', 'feeCents', 'displayName', 'firstBatchId', 'lastBatchId', 'lastSeenAt',
];
const IDS_CHUNK = 500;
const OPEN_TRACKINGS = ['WAITING_TRANSFER', 'OPEN', 'RETRY', 'UNKNOWN_STATE', 'NEEDS_REVIEW'];
const REVERIFY_TRACKINGS = ['WAITING_TRANSFER', 'OPEN', 'RETRY', 'UNKNOWN_STATE'];

const toRecord = (row) => mapRow(row);
const marks = (list) => list.map(() => '?').join(',');

function findById(id) {
  return toRecord(getDb().prepare('SELECT * FROM external_records WHERE id = ?').get(id));
}

function find(source, kind, externalId) {
  return toRecord(
    getDb().prepare('SELECT * FROM external_records WHERE source = ? AND kind = ? AND external_id = ?').get(source, kind, externalId)
  );
}

// Registros de uma lista de ids externos: Map externalId -> registro.
function findManyByExternalIds(source, kind, externalIds) {
  const unique = [...new Set(externalIds)];
  const out = new Map();
  for (let i = 0; i < unique.length; i += IDS_CHUNK) {
    const chunk = unique.slice(i, i + IDS_CHUNK);
    const sql = `SELECT * FROM external_records WHERE source = ? AND kind = ? AND external_id IN (${marks(chunk)})`;
    for (const row of getDb().prepare(sql).all(source, kind, ...chunk)) out.set(row.external_id, toRecord(row));
  }
  return out;
}

function create(data, { now = new Date() } = {}) {
  const stamp = now.toISOString();
  const id = insertRow(getDb(), 'external_records', data, FIELDS, { created_at: stamp, updated_at: stamp });
  return findById(Number(id));
}

function update(id, partial = {}, { now = new Date() } = {}) {
  const changes = updateRow(getDb(), 'external_records', id, partial, FIELDS, { updated_at: now.toISOString() });
  return changes === 0 ? null : findById(id);
}

// O mais antigo `external_created_at` entre os trades que ainda precisam ser reverificados (horizonte da varredura).
function oldestOpenTradeCreatedAt(source) {
  const row = getDb()
    .prepare(`SELECT MIN(external_created_at) AS oldest FROM external_records WHERE source = ? AND kind = 'TRADE' AND tracking IN (${marks(REVERIFY_TRACKINGS)})`)
    .get(source, ...REVERIFY_TRACKINGS);
  return row ? row.oldest : null;
}

// `contract_id` (de trades) já conhecidos entre os informados.
function findKnownTradeContractIds(source, contractIds) {
  const unique = [...new Set(contractIds)];
  const out = new Set();
  for (let i = 0; i < unique.length; i += IDS_CHUNK) {
    const chunk = unique.slice(i, i + IDS_CHUNK);
    const sql = `SELECT contract_id FROM external_records WHERE source = ? AND kind = 'TRADE' AND contract_id IN (${marks(chunk)})`;
    for (const row of getDb().prepare(sql).all(source, ...chunk)) out.add(row.contract_id);
  }
  return out;
}

// Transações já gravadas de um contrato, opcionalmente só de certos tipos.
function findTransactionsByContract(source, contractId, txTypes = null) {
  const params = [source, contractId];
  let extra = '';
  if (txTypes && txTypes.length) {
    extra = ` AND tx_type IN (${marks(txTypes)})`;
    params.push(...txTypes);
  }
  return getDb()
    .prepare(`SELECT * FROM external_records WHERE source = ? AND kind = 'TRANSACTION' AND contract_id = ?${extra}`)
    .all(...params)
    .map(toRecord);
}

// Dos `contract_id` informados, os que têm uma transação de algum dos tipos (ex.: estorno).
function findContractIdsWithTransactionTypes(source, contractIds, txTypes) {
  const unique = [...new Set(contractIds)];
  const out = new Set();
  for (let i = 0; i < unique.length; i += IDS_CHUNK) {
    const chunk = unique.slice(i, i + IDS_CHUNK);
    const sql = `SELECT DISTINCT contract_id FROM external_records WHERE source = ? AND kind = 'TRANSACTION'
      AND tx_type IN (${marks(txTypes)}) AND contract_id IN (${marks(chunk)})`;
    for (const row of getDb().prepare(sql).all(source, ...txTypes, ...chunk)) out.add(row.contract_id);
  }
  return out;
}

// Trades da fonte com um dos `contract_id` informados: Map contractId -> registro.
function findTradesByContractIds(source, contractIds) {
  const unique = [...new Set(contractIds.filter(Boolean))];
  const out = new Map();
  for (let i = 0; i < unique.length; i += IDS_CHUNK) {
    const chunk = unique.slice(i, i + IDS_CHUNK);
    const sql = `SELECT * FROM external_records WHERE source = ? AND kind = 'TRADE' AND contract_id IN (${marks(chunk)}) ORDER BY id ASC`;
    for (const row of getDb().prepare(sql).all(source, ...chunk)) if (!out.has(row.contract_id)) out.set(row.contract_id, toRecord(row));
  }
  return out;
}

// Quantos trades da fonte estão num `tracking` (ex.: DEFERRED, vendas vistas na 9.2 e ainda não processadas).
function countTradesByTracking(source, tracking) {
  return getDb().prepare("SELECT COUNT(*) AS n FROM external_records WHERE source = ? AND kind = 'TRADE' AND tracking = ?").get(source, tracking).n;
}

// Todos os trades da fonte (a pré-visualização da mudança de corte filtra em memória; poucas centenas de linhas).
function listTrades(source) {
  return getDb().prepare("SELECT * FROM external_records WHERE source = ? AND kind = 'TRADE' ORDER BY id ASC").all(source).map(toRecord);
}

// Data da operação do registro (contract.sold_at, ou a criação do trade), a mesma usada contra o corte.
const OPERATION_AT = 'COALESCE(r.sold_at, r.external_created_at)';
const UNLINKED = "NOT EXISTS (SELECT 1 FROM external_links l WHERE l.record_id = r.id)";

// Adiar o corte (D325): trades SEM vínculo e ainda abertos antes do corte novo viram BEFORE_CUTOFF. Devolve os ids.
function closeOpenUnlinkedBefore(source, cutoffAt, { now = new Date() } = {}) {
  const open = ['RETRY', 'WAITING_TRANSFER', 'UNKNOWN_STATE', 'NEEDS_REVIEW', 'DEFERRED'];
  const ids = getDb()
    .prepare(`SELECT r.id FROM external_records r WHERE r.source = ? AND r.kind = 'TRADE' AND r.tracking IN (${marks(open)})
      AND ${UNLINKED} AND ${OPERATION_AT} < ?`)
    .all(source, ...open, cutoffAt)
    .map((row) => row.id);
  for (const id of ids) update(id, { tracking: 'BEFORE_CUTOFF' }, { now });
  return ids;
}

// Ids dos trades BEFORE_CUTOFF sem vínculo com a data a partir de `fromAt` (antecipar o corte: voltam a ser avaliados).
function findBeforeCutoffUnlinkedFrom(source, fromAt) {
  return new Set(getDb()
    .prepare(`SELECT r.id FROM external_records r WHERE r.source = ? AND r.kind = 'TRADE' AND r.tracking = 'BEFORE_CUTOFF'
      AND ${UNLINKED} AND ${OPERATION_AT} >= ?`)
    .all(source, fromAt)
    .map((row) => row.id));
}

// Desfazer a mudança de corte (D326): com o corte restaurado, os trades SEM vínculo antes dele voltam a BEFORE_CUTOFF (fora os
// decididos), e os BEFORE_CUTOFF a partir dele voltam a ser reavaliados (RETRY). Devolve os ids que viraram BEFORE_CUTOFF.
function restoreCutoffTrackings(source, cutoffAt, { now = new Date() } = {}) {
  const keep = ['IGNORED', 'REMOVED_IN_APP', 'REVERTED', 'BEFORE_CUTOFF', 'CLOSED_NOT_TRANSFERRED'];
  const before = getDb()
    .prepare(`SELECT r.id FROM external_records r WHERE r.source = ? AND r.kind = 'TRADE' AND r.tracking NOT IN (${marks(keep)})
      AND ${UNLINKED} AND ${OPERATION_AT} < ?`)
    .all(source, ...keep, cutoffAt)
    .map((row) => row.id);
  for (const id of before) update(id, { tracking: 'BEFORE_CUTOFF' }, { now });
  const after = getDb()
    .prepare(`SELECT r.id FROM external_records r WHERE r.source = ? AND r.kind = 'TRADE' AND r.tracking = 'BEFORE_CUTOFF'
      AND ${UNLINKED} AND ${OPERATION_AT} >= ?`)
    .all(source, cutoffAt)
    .map((row) => row.id);
  for (const id of after) update(id, { tracking: 'RETRY' }, { now });
  return before;
}

// Todas as transações do extrato já gravadas da fonte (conferência de saldo, 9.7).
function listTransactions(source) {
  return getDb().prepare("SELECT * FROM external_records WHERE source = ? AND kind = 'TRANSACTION' ORDER BY id ASC").all(source).map(toRecord);
}

// --- Aportes e saques do extrato (9.6) -----------------------------------------------------------------------------------
const TRANSFER_TX = "r.kind = 'TRANSACTION' AND r.tx_type IN ('deposit','withdrawal')";

// Registros de aporte/saque sem vínculo, nos trackings informados, do mais antigo para o mais novo.
function listUnlinkedTransfers(source, trackings) {
  return getDb()
    .prepare(`SELECT r.* FROM external_records r WHERE r.source = ? AND ${TRANSFER_TX} AND r.tracking IN (${marks(trackings)}) AND ${UNLINKED}
      ORDER BY r.external_created_at ASC, r.id ASC`)
    .all(source, ...trackings)
    .map(toRecord);
}

function countUnlinkedTransfers(source, trackings) {
  return getDb()
    .prepare(`SELECT COUNT(*) AS n FROM external_records r WHERE r.source = ? AND ${TRANSFER_TX} AND r.tracking IN (${marks(trackings)}) AND ${UNLINKED}`)
    .get(source, ...trackings).n;
}

// Antes do corte dos aportes e saques: os sem vínculo e ainda abertos viram BEFORE_CUTOFF. Devolve os ids.
function closeTransfersBefore(source, cutoffAt, { now = new Date() } = {}) {
  const open = ['SEEN', 'RETRY', 'NEEDS_REVIEW'];
  const ids = getDb()
    .prepare(`SELECT r.id FROM external_records r WHERE r.source = ? AND ${TRANSFER_TX} AND r.tracking IN (${marks(open)}) AND ${UNLINKED}
      AND r.external_created_at < ?`)
    .all(source, ...open, cutoffAt)
    .map((row) => row.id);
  for (const id of ids) update(id, { tracking: 'BEFORE_CUTOFF' }, { now });
  return ids;
}

// Corte dos aportes e saques mais antigo (ou definido pela primeira vez): os BEFORE_CUTOFF sem vínculo a partir dele voltam a
// ser processados (SEEN). Com `cutoffAt` nulo (o desfazer da primeira definição), todos voltam a "vistos".
function reopenTransfersFrom(source, cutoffAt, { now = new Date() } = {}) {
  const ids = getDb()
    .prepare(`SELECT r.id FROM external_records r WHERE r.source = ? AND ${TRANSFER_TX} AND r.tracking = 'BEFORE_CUTOFF' AND ${UNLINKED}
      AND (? IS NULL OR r.external_created_at >= ?)`)
    .all(source, cutoffAt, cutoffAt)
    .map((row) => row.id);
  for (const id of ids) update(id, { tracking: 'SEEN' }, { now });
  return ids;
}

// Troca de conta (D293): os trades abertos da conta anterior viram IGNORED, e também os aportes e saques dela ainda sem
// lançamento (vistos, a tentar, em revisão ou antes do corte; revisão da Etapa 9), para não entrarem na loja da conta nova.
// Devolve os ids afetados.
const TRANSFER_OPEN = ['SEEN', 'RETRY', 'NEEDS_REVIEW', 'BEFORE_CUTOFF'];
function ignoreOpenForAccountSwitch(source, { now = new Date() } = {}) {
  const ids = getDb()
    .prepare(`SELECT r.id FROM external_records r WHERE r.source = ? AND (
        (r.kind = 'TRADE' AND r.tracking IN (${marks(OPEN_TRACKINGS)}))
        OR (${TRANSFER_TX} AND r.tracking IN (${marks(TRANSFER_OPEN)}) AND ${UNLINKED}))`)
    .all(source, ...OPEN_TRACKINGS, ...TRANSFER_OPEN)
    .map((r) => r.id);
  const stamp = now.toISOString();
  const stmt = getDb().prepare("UPDATE external_records SET tracking = 'IGNORED', updated_at = ? WHERE id = ?");
  for (const id of ids) stmt.run(stamp, id);
  return ids;
}

// Decisões do usuário que o desfazer não apaga (revisão da Etapa 9): "excluído no app" e "ignorado" continuam valendo, para a
// próxima importação não trazer de volta o que ele já tirou.
const USER_DECISIONS = ['REMOVED_IN_APP', 'IGNORED'];

function deleteByFirstBatch(batchId) {
  return getDb()
    .prepare(`DELETE FROM external_records WHERE first_batch_id = ? AND tracking NOT IN (${marks(USER_DECISIONS)})`)
    .run(batchId, ...USER_DECISIONS).changes;
}

// Recomeço completo (desfazer o último lote com mudanças): apaga os registros da fonte, menos as decisões do usuário.
function deleteAllForSource(source) {
  return getDb()
    .prepare(`DELETE FROM external_records WHERE source = ? AND tracking NOT IN (${marks(USER_DECISIONS)})`)
    .run(source, ...USER_DECISIONS).changes;
}

// Data de criação do registro de uma transação (cursor do extrato).
function findTransactionCreatedAt(source, externalId) {
  const row = getDb()
    .prepare("SELECT external_created_at FROM external_records WHERE source = ? AND kind = 'TRANSACTION' AND external_id = ?")
    .get(source, externalId);
  return row ? row.external_created_at : null;
}

module.exports = {
  OPEN_TRACKINGS,
  find,
  findById,
  findManyByExternalIds,
  create,
  update,
  oldestOpenTradeCreatedAt,
  findKnownTradeContractIds,
  findTransactionsByContract,
  findContractIdsWithTransactionTypes,
  findTradesByContractIds,
  countTradesByTracking,
  listTrades,
  listTransactions,
  listUnlinkedTransfers,
  countUnlinkedTransfers,
  closeTransfersBefore,
  reopenTransfersFrom,
  closeOpenUnlinkedBefore,
  findBeforeCutoffUnlinkedFrom,
  restoreCutoffTrackings,
  ignoreOpenForAccountSwitch,
  deleteByFirstBatch,
  deleteAllForSource,
  findTransactionCreatedAt,
};

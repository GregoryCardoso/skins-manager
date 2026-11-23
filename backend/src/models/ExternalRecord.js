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

// Troca de conta (D293): os trades abertos da conta anterior viram IGNORED. Devolve os ids afetados.
function ignoreOpenForAccountSwitch(source, { now = new Date() } = {}) {
  const ids = getDb()
    .prepare(`SELECT id FROM external_records WHERE source = ? AND kind = 'TRADE' AND tracking IN (${marks(OPEN_TRACKINGS)})`)
    .all(source, ...OPEN_TRACKINGS)
    .map((r) => r.id);
  if (ids.length) {
    getDb()
      .prepare(`UPDATE external_records SET tracking = 'IGNORED', updated_at = ? WHERE source = ? AND kind = 'TRADE' AND tracking IN (${marks(OPEN_TRACKINGS)})`)
      .run(now.toISOString(), source, ...OPEN_TRACKINGS);
  }
  return ids;
}

function deleteByFirstBatch(batchId) {
  return getDb().prepare('DELETE FROM external_records WHERE first_batch_id = ?').run(batchId).changes;
}

// Recomeço completo (desfazer o último lote com mudanças): apaga todos os registros da fonte.
function deleteAllForSource(source) {
  return getDb().prepare('DELETE FROM external_records WHERE source = ?').run(source).changes;
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
  ignoreOpenForAccountSwitch,
  deleteByFirstBatch,
  deleteAllForSource,
  findTransactionCreatedAt,
};

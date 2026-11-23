'use strict';

// Acesso à tabela `integrations` (D289, D291). Só SQL. `get()` seleciona colunas explícitas e NUNCA devolve a chave:
// ela só sai por `getApiKey()`, de uso interno do integrationService (e `readSecrets`, do backup).
const { getDb } = require('../config/database');
const { mapRow, toSnake } = require('./modelHelpers');
const { SECRET_COLUMNS } = require('../config/constants');

const PUBLIC_COLUMNS = `source, store_id, api_key_saved_at, account_fingerprint, account_salt, auto_import_on_open, auto_import_paused,
  trades_cutoff_at, transactions_cutoff_at, last_transaction_id, last_import_at, last_import_status, last_import_error_code,
  created_at, updated_at, (api_key IS NOT NULL) AS has_api_key`;
const BOOLEANS = ['hasApiKey', 'autoImportOnOpen', 'autoImportPaused'];
const UPDATABLE = [
  'storeId', 'apiKey', 'apiKeySavedAt', 'accountFingerprint', 'accountSalt', 'autoImportOnOpen', 'autoImportPaused',
  'tradesCutoffAt', 'transactionsCutoffAt', 'lastTransactionId', 'lastImportAt', 'lastImportStatus', 'lastImportErrorCode',
];

function get(source = 'CSFLOAT') {
  return mapRow(getDb().prepare(`SELECT ${PUBLIC_COLUMNS} FROM integrations WHERE source = ?`).get(source), BOOLEANS);
}

// Só para uso interno (chamada ao CSFloat e máscara).
function getApiKey(source = 'CSFLOAT') {
  const row = getDb().prepare('SELECT api_key FROM integrations WHERE source = ?').get(source);
  return row ? row.api_key : null;
}

// Atualiza só as chaves informadas (lista branca). Devolve a linha sem a chave, ou null se a linha não existe.
function update(source, partial = {}, { now = new Date() } = {}) {
  const sets = [];
  const values = [];
  for (const field of UPDATABLE) {
    if (partial[field] === undefined) continue;
    sets.push(`${toSnake(field)} = ?`);
    const value = partial[field];
    values.push(value === true ? 1 : value === false ? 0 : value);
  }
  sets.push('updated_at = ?');
  values.push(now.toISOString());
  const changes = getDb().prepare(`UPDATE integrations SET ${sets.join(', ')} WHERE source = ?`).run(...values, source).changes;
  return changes === 0 ? null : get(source);
}

// Troca de conta (D293): grava a nova impressão digital e recomeça como numa primeira importação, numa transação.
// Mantém a chave, a loja e `auto_import_on_open`.
function resetForAccountSwitch(source, { fingerprint, salt }, { now = new Date() } = {}) {
  const stamp = now.toISOString();
  getDb().transaction(() => {
    getDb()
      .prepare(
        `UPDATE integrations SET account_fingerprint = ?, account_salt = ?, last_transaction_id = NULL, trades_cutoff_at = NULL,
           transactions_cutoff_at = NULL, last_import_at = NULL, last_import_status = NULL, last_import_error_code = NULL,
           auto_import_paused = 1, updated_at = ? WHERE source = ?`
      )
      .run(fingerprint, salt, stamp, source);
  })();
  return get(source);
}

// Segredos de cada fonte (D290) para o backup: { CSFLOAT: 'chave' | null }. Só para uso interno.
function readSecrets() {
  const rows = getDb().prepare('SELECT source, api_key FROM integrations').all();
  return Object.fromEntries(rows.map((row) => [row.source, row.api_key]));
}

function writeSecret(source, apiKey, { now = new Date() } = {}) {
  const stamp = now.toISOString();
  const { table, column } = SECRET_COLUMNS[0];
  return (
    getDb()
      .prepare(`UPDATE ${table} SET ${column} = ?, api_key_saved_at = ?, updated_at = ? WHERE source = ?`)
      .run(apiKey, apiKey === null ? null : stamp, stamp, source).changes > 0
  );
}

module.exports = { get, getApiKey, update, resetForAccountSwitch, readSecrets, writeSecret };

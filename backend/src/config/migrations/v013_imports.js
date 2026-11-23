'use strict';

// Migração 13 (D318): tabelas da importação de lojas (lotes, registros externos, vínculos e entradas do resumo). Só CREATE,
// sem reconstruir tabelas. Já traz as colunas de que as partes 9.3, 9.4 e 9.6 precisam. Migração publicada nunca é editada (D69).
// Nada secreto aqui: só ids da loja, estados, valores e datas (D309).
const SQL = `
CREATE TABLE import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('CSFLOAT')),
  trigger TEXT NOT NULL CHECK (trigger IN ('MANUAL','AUTO')),
  status TEXT NOT NULL CHECK (status IN ('DONE','FAILED','UNDONE')),
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  full_scan INTEGER NOT NULL DEFAULT 0 CHECK (full_scan IN (0,1)),
  cutoff_at TEXT NULL,
  trade_pages_read INTEGER NOT NULL DEFAULT 0,
  transaction_pages_read INTEGER NOT NULL DEFAULT 0,
  purchases_created INTEGER NOT NULL DEFAULT 0,
  sales_created INTEGER NOT NULL DEFAULT 0,
  deposits_created INTEGER NOT NULL DEFAULT 0,
  withdrawals_created INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  known_count INTEGER NOT NULL DEFAULT 0,
  before_cutoff_count INTEGER NOT NULL DEFAULT 0,
  not_transferred_count INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  reverted_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  unknown_state_count INTEGER NOT NULL DEFAULT 0,
  deferred_count INTEGER NOT NULL DEFAULT 0,
  without_purchase_count INTEGER NOT NULL DEFAULT 0,
  unknown_types_json TEXT NULL,
  diagnostics_json TEXT NULL,
  warnings_json TEXT NULL,
  previous_transaction_cursor TEXT NULL,
  error_code TEXT NULL,
  undone_at TEXT NULL,
  created_at TEXT NOT NULL,
  CHECK (status <> 'FAILED' OR error_code IS NOT NULL),
  CHECK ((status = 'UNDONE') = (undone_at IS NOT NULL))
) STRICT;
CREATE INDEX idx_import_batches_source_created ON import_batches(source, id DESC);

CREATE TABLE external_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('CSFLOAT')),
  kind TEXT NOT NULL CHECK (kind IN ('TRADE','TRANSACTION')),
  external_id TEXT NOT NULL CHECK (length(external_id) BETWEEN 1 AND 40),
  account_fingerprint TEXT NULL CHECK (account_fingerprint IS NULL OR length(account_fingerprint) = 64),
  contract_id TEXT NULL CHECK (contract_id IS NULL OR length(contract_id) BETWEEN 1 AND 40),
  related_trade_id TEXT NULL,
  direction TEXT NULL CHECK (direction IN ('BUY','SELL')),
  tx_type TEXT NULL CHECK (tx_type IS NULL OR length(tx_type) BETWEEN 1 AND 60),
  raw_state TEXT NULL CHECK (raw_state IS NULL OR length(raw_state) <= 60),
  offer_state INTEGER NULL,
  tracking TEXT NOT NULL CHECK (tracking IN (
    'WAITING_TRANSFER','OPEN','SETTLED','CLOSED_NOT_TRANSFERRED','BEFORE_CUTOFF','NEEDS_REVIEW','RETRY',
    'UNKNOWN_STATE','REVERTED','REMOVED_IN_APP','IGNORED','DEFERRED','SEEN')),
  external_created_at TEXT NOT NULL,
  sold_at TEXT NULL,
  accepted_at TEXT NULL,
  protection_ends_at TEXT NULL,
  verify_sale_at TEXT NULL,
  amount_cents INTEGER NULL,
  balance_offset_cents INTEGER NULL,
  pending_offset_cents INTEGER NULL,
  fee_cents INTEGER NULL CHECK (fee_cents IS NULL OR fee_cents >= 0),
  display_name TEXT NULL CHECK (display_name IS NULL OR length(display_name) <= 200),
  first_batch_id INTEGER NULL REFERENCES import_batches(id) ON DELETE SET NULL,
  last_batch_id INTEGER NULL REFERENCES import_batches(id) ON DELETE SET NULL,
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source, kind, external_id),
  CHECK (kind = 'TRANSACTION' OR direction IS NOT NULL OR tracking = 'RETRY'),
  CHECK (kind = 'TRADE' OR tx_type IS NOT NULL)
) STRICT;
CREATE INDEX idx_external_records_tracking ON external_records(source, kind, tracking);
CREATE INDEX idx_external_records_contract ON external_records(source, contract_id);
CREATE INDEX idx_external_records_first_batch ON external_records(first_batch_id);

CREATE TABLE external_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES external_records(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('ITEM_PURCHASE','ITEM_SALE','DEPOSIT','WITHDRAWAL')),
  entity_id INTEGER NOT NULL CHECK (entity_id > 0),
  link_kind TEXT NOT NULL CHECK (link_kind IN ('CREATED','MATCHED')),
  batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE RESTRICT,
  entity_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (record_id),
  UNIQUE (entity_type, entity_id)
) STRICT;
CREATE INDEX idx_external_links_batch ON external_links(batch_id);

CREATE TABLE import_batch_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  record_id INTEGER NULL REFERENCES external_records(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('CREATED','MATCHED','POSSIBLE_DUPLICATE','REVERTED','FAILED','UNKNOWN_STATE')),
  reason_code TEXT NULL CHECK (reason_code IS NULL OR length(reason_code) <= 60),
  entity_type TEXT NULL CHECK (entity_type IN ('ITEM_PURCHASE','ITEM_SALE','DEPOSIT','WITHDRAWAL')),
  entity_id INTEGER NULL,
  candidate_ids TEXT NULL,
  display_json TEXT NOT NULL,
  resolution TEXT NULL CHECK (resolution IN ('REMOVED','KEPT','CREATED','LINKED','IGNORED','UNDONE')),
  resolved_at TEXT NULL,
  created_at TEXT NOT NULL,
  CHECK ((resolution IS NULL) = (resolved_at IS NULL))
) STRICT;
CREATE INDEX idx_import_entries_open ON import_batch_entries(resolution, outcome);
CREATE INDEX idx_import_entries_batch ON import_batch_entries(batch_id);
CREATE INDEX idx_import_entries_record ON import_batch_entries(record_id);
`;

module.exports = {
  version: 13,
  name: 'imports',
  up(db) {
    db.exec(SQL);
  },
};

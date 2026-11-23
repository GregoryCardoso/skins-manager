'use strict';

// Migração 12 (D291, D316): tabela `integrations` (uma linha por loja integrada; hoje só a CSFLOAT). Só CREATE, sem reconstruir
// tabelas. A linha nasce no seed (como as lojas). Os campos de importação (cortes, cursor, importar ao abrir) nascem aqui para
// as partes 9.2 a 9.5 não precisarem de outra migração. Migração publicada nunca é editada (D69).
const SQL = `
CREATE TABLE integrations (
  source TEXT PRIMARY KEY CHECK (source IN ('CSFLOAT')),
  store_id INTEGER NULL REFERENCES stores(id) ON DELETE SET NULL,
  api_key TEXT NULL CHECK (api_key IS NULL OR length(api_key) BETWEEN 8 AND 512),
  api_key_saved_at TEXT NULL,
  account_fingerprint TEXT NULL CHECK (account_fingerprint IS NULL OR length(account_fingerprint) = 64),
  account_salt TEXT NULL CHECK (account_salt IS NULL OR length(account_salt) = 64),
  auto_import_on_open INTEGER NOT NULL DEFAULT 0 CHECK (auto_import_on_open IN (0,1)),
  auto_import_paused INTEGER NOT NULL DEFAULT 0 CHECK (auto_import_paused IN (0,1)),
  trades_cutoff_at TEXT NULL,
  transactions_cutoff_at TEXT NULL,
  last_transaction_id TEXT NULL,
  last_import_at TEXT NULL,
  last_import_status TEXT NULL CHECK (last_import_status IN ('OK','FAILED')),
  last_import_error_code TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((account_fingerprint IS NULL) = (account_salt IS NULL))
) STRICT;
`;

module.exports = {
  version: 12,
  name: 'integrations',
  up(db) {
    db.exec(SQL);
  },
};

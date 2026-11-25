'use strict';

// Migração 23 (D369, subetapa 11.1): o idioma deixa de ser uma lista fixa no banco. Reconstrói `settings` (o SQLite não altera CHECK
// de tabela), trocando `CHECK (language IN ('pt-BR','en'))` por um CHECK de formato (`length(language) BETWEEN 2 AND 10`), e o padrão
// da coluna passa a ser 'en' (inglês é o idioma base). A lista de idiomas aceitos fica em `LANGUAGES` (constants.js) e é validada
// no `settingsService`: acrescentar um idioma não exige mais migração. A tabela tem uma linha: todos os valores são copiados como
// estão (inclusive `language`, então quem já usa o app não muda nada), e a contagem de linhas é conferida dentro da transação.
// Migração publicada nunca é editada (D69).
const COLUMNS = [
  'id', 'usd_brl_rate', 'usd_brl_rate_updated_at', 'updated_at', 'catalog_updated_at', 'theme', 'language', 'usd_brl_rate_source',
  'rate_quoted_at', 'slow_item_days', 'fast_turnover_days', 'stores_seeded', 'fx_refresh_source', 'inventory_view', 'steam_store_id',
  'price_refresh_started_at', 'price_refresh_last_at', 'price_refresh_last_status', 'price_refresh_last_error_code',
].join(', ');

const SQL = `
CREATE TABLE settings_new (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  usd_brl_rate REAL NULL CHECK (usd_brl_rate > 0),
  usd_brl_rate_updated_at TEXT NULL,
  updated_at TEXT NOT NULL,
  catalog_updated_at TEXT NULL,
  theme TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (theme IN ('SYSTEM','LIGHT','DARK')),
  language TEXT NOT NULL DEFAULT 'en' CHECK (length(language) BETWEEN 2 AND 10),
  usd_brl_rate_source TEXT NULL CHECK (usd_brl_rate_source IN ('MANUAL','PTAX','AWESOMEAPI')),
  rate_quoted_at TEXT NULL,
  slow_item_days INTEGER NULL CHECK (slow_item_days BETWEEN 2 AND 365),
  fast_turnover_days INTEGER NULL CHECK (fast_turnover_days BETWEEN 1 AND 364),
  stores_seeded INTEGER NOT NULL DEFAULT 0 CHECK (stores_seeded IN (0,1)),
  fx_refresh_source TEXT NOT NULL DEFAULT 'AWESOMEAPI' CHECK (fx_refresh_source IN ('AWESOMEAPI','PTAX')),
  inventory_view TEXT NOT NULL DEFAULT 'GROUPED' CHECK (inventory_view IN ('INDIVIDUAL','GROUPED')),
  steam_store_id INTEGER NULL REFERENCES stores(id) ON DELETE SET NULL,
  price_refresh_started_at TEXT NULL,
  price_refresh_last_at TEXT NULL,
  price_refresh_last_status TEXT NULL CHECK (price_refresh_last_status IS NULL OR price_refresh_last_status IN ('OK','PARTIAL','FAILED')),
  price_refresh_last_error_code TEXT NULL
) STRICT;
INSERT INTO settings_new (${COLUMNS}) SELECT ${COLUMNS} FROM settings;
`;

module.exports = {
  version: 23,
  name: 'language_format',
  disableForeignKeys: true,
  up(db) {
    const before = db.prepare('SELECT COUNT(*) AS n FROM settings').get().n;
    db.exec(SQL);
    const copied = db.prepare('SELECT COUNT(*) AS n FROM settings_new').get().n;
    if (copied !== before) throw new Error('Migração 23: a cópia de settings perdeu linhas.');
    const changed = db.prepare('SELECT COUNT(*) AS n FROM settings s JOIN settings_new n ON n.id = s.id WHERE n.language IS NOT s.language').get().n;
    if (changed !== 0) throw new Error('Migração 23: o idioma gravado mudou na cópia.');
    db.exec('DROP TABLE settings; ALTER TABLE settings_new RENAME TO settings;');
  },
};

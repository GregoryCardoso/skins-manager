'use strict';

// Migração 5: fontes da cotação USD→BRL (D162). O SQLite não altera CHECK, então reconstrói `settings`
// (a tabela tem uma linha e nenhuma FK a referencia), como a v3 fez com `items`:
// - usd_brl_rate_source passa a aceitar 'MANUAL', 'PTAX' e 'AWESOMEAPI';
// - ptax_quoted_at vira rate_quoted_at (dados copiados);
// - nova fx_refresh_source (fonte do botão "atualizar cotação"), padrão 'AWESOMEAPI' também nos bancos existentes.
// Migração publicada nunca é editada (D69).
const COLUMNS = [
  'id', 'usd_brl_rate', 'usd_brl_rate_updated_at', 'updated_at', 'catalog_updated_at', 'theme', 'language',
  'usd_brl_rate_source', 'slow_item_days', 'fast_turnover_days', 'stores_seeded',
].join(', ');

const SQL = `
CREATE TABLE settings_new (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  usd_brl_rate REAL NULL CHECK (usd_brl_rate > 0),
  usd_brl_rate_updated_at TEXT NULL,
  updated_at TEXT NOT NULL,
  catalog_updated_at TEXT NULL,
  theme TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (theme IN ('SYSTEM','LIGHT','DARK')),
  language TEXT NOT NULL DEFAULT 'pt-BR' CHECK (language IN ('pt-BR','en')),
  usd_brl_rate_source TEXT NULL CHECK (usd_brl_rate_source IN ('MANUAL','PTAX','AWESOMEAPI')),
  rate_quoted_at TEXT NULL,
  slow_item_days INTEGER NULL CHECK (slow_item_days BETWEEN 2 AND 365),
  fast_turnover_days INTEGER NULL CHECK (fast_turnover_days BETWEEN 1 AND 364),
  stores_seeded INTEGER NOT NULL DEFAULT 0 CHECK (stores_seeded IN (0,1)),
  fx_refresh_source TEXT NOT NULL DEFAULT 'AWESOMEAPI' CHECK (fx_refresh_source IN ('AWESOMEAPI','PTAX'))
) STRICT;
INSERT INTO settings_new (${COLUMNS}, rate_quoted_at, fx_refresh_source)
  SELECT ${COLUMNS}, ptax_quoted_at, 'AWESOMEAPI' FROM settings;
DROP TABLE settings;
ALTER TABLE settings_new RENAME TO settings;
`;

module.exports = {
  version: 5,
  name: 'fx_sources',
  disableForeignKeys: true,
  up(db) {
    db.exec(SQL);
  },
};

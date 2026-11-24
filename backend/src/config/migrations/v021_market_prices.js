'use strict';

// Migração 21 (D364, subetapa 10.5): cache de preços de mercado (`market_prices`) e o estado da última rodada de atualização de preços (`settings`: início, que vale como intervalo mínimo, fim, resultado e código de erro; fora da API de configurações). Só CREATE TABLE e ADD COLUMN: itens, componentes, saldos e lucro real não mudam. Migração publicada nunca é editada (D69).
const SQL = `
CREATE TABLE market_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 40),
  price_key TEXT NOT NULL CHECK (length(price_key) BETWEEN 1 AND 260),
  market_hash_name TEXT NOT NULL CHECK (length(market_hash_name) BETWEEN 1 AND 200),
  paint_index INTEGER NULL CHECK (paint_index IS NULL OR paint_index >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  status TEXT NOT NULL CHECK (status IN ('OK','NOT_FOUND')),
  base_price_cents INTEGER NULL CHECK (base_price_cents IS NULL OR base_price_cents >= 0),
  reference_quantity INTEGER NULL CHECK (reference_quantity IS NULL OR reference_quantity >= 0),
  source_updated_at TEXT NULL,
  priced_at TEXT NULL,
  fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((base_price_cents IS NULL) = (priced_at IS NULL)),
  UNIQUE (source, price_key)
) STRICT;

ALTER TABLE settings ADD COLUMN price_refresh_started_at TEXT NULL;
ALTER TABLE settings ADD COLUMN price_refresh_last_at TEXT NULL;
ALTER TABLE settings ADD COLUMN price_refresh_last_status TEXT NULL CHECK (price_refresh_last_status IS NULL OR price_refresh_last_status IN ('OK','PARTIAL','FAILED'));
ALTER TABLE settings ADD COLUMN price_refresh_last_error_code TEXT NULL;
`;

module.exports = {
  version: 21,
  name: 'market_prices',
  up(db) {
    db.exec(SQL);
  },
};

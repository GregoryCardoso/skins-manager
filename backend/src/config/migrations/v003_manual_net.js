'use strict';

// Migração 3: líquido informado manualmente na venda (D122).
// Reconstrói `items` (o SQLite não altera CHECK de tabela): acrescenta `net_received_manual` e troca o CHECK de
// VENDIDO para aceitar snapshot de taxas "todo preenchido" ou "todo nulo" (este só com líquido manual).
// Preserva todas as linhas (id, created_at, updated_at) e recria os índices. Migração publicada nunca é editada (D69).
const COLUMNS = [
  'id', 'name', 'category', 'variant', 'float_value', 'exterior', 'paint_seed', 'phase', 'inspect_link', 'asset_id',
  'acquisition_type', 'origin_detail', 'purchase_store_id', 'purchase_price_cents', 'purchase_currency',
  'fx_rate_at_purchase', 'acquired_at', 'trade_unlock_at', 'status', 'sale_store_id', 'sale_price_cents',
  'sale_currency', 'fx_rate_at_sale', 'sale_fee_type_applied', 'sale_fee_rate_applied', 'sale_fee_rounding_applied',
  'sale_min_fee_cents_applied', 'sale_fixed_fee_cents_applied', 'net_received_cents', 'sold_at', 'created_at',
  'updated_at', 'catalog_id',
].join(', ');

const SQL = `
CREATE TABLE items_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  category TEXT NOT NULL CHECK (category IN ('SKIN','FACA','LUVA','CAIXA','CAPSULA','STICKER','PINGENTE','PERSONAGEM','PASSE_BATALHA','OUTRO')),
  variant TEXT NULL CHECK (variant IN ('NORMAL','STATTRAK','SOUVENIR')),
  float_value REAL NULL CHECK (float_value >= 0 AND float_value <= 1),
  exterior TEXT NULL CHECK (exterior IN ('FN','MW','FT','WW','BS')),
  paint_seed INTEGER NULL CHECK (paint_seed BETWEEN 0 AND 1000),
  phase TEXT NULL,
  inspect_link TEXT NULL,
  asset_id TEXT NULL,
  acquisition_type TEXT NOT NULL CHECK (acquisition_type IN ('GANHEI','COMPRA')),
  origin_detail TEXT NULL,
  purchase_store_id INTEGER NULL REFERENCES stores(id) ON DELETE RESTRICT,
  purchase_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (purchase_price_cents >= 0),
  purchase_currency TEXT NOT NULL DEFAULT 'USD' CHECK (purchase_currency IN ('USD','BRL')),
  fx_rate_at_purchase REAL NULL CHECK (fx_rate_at_purchase > 0),
  acquired_at TEXT NOT NULL,
  trade_unlock_at TEXT NULL,
  status TEXT NOT NULL DEFAULT 'EM_ESTOQUE' CHECK (status IN ('EM_ESTOQUE','VENDIDO')),
  sale_store_id INTEGER NULL REFERENCES stores(id) ON DELETE RESTRICT,
  sale_price_cents INTEGER NULL CHECK (sale_price_cents > 0),
  sale_currency TEXT NULL CHECK (sale_currency IN ('USD','BRL')),
  fx_rate_at_sale REAL NULL CHECK (fx_rate_at_sale > 0),
  sale_fee_type_applied TEXT NULL CHECK (sale_fee_type_applied IN ('DEDUCTED','ADDED')),
  sale_fee_rate_applied REAL NULL CHECK (sale_fee_rate_applied >= 0 AND sale_fee_rate_applied < 1),
  sale_fee_rounding_applied TEXT NULL CHECK (sale_fee_rounding_applied IN ('CEIL','ROUND','FLOOR')),
  sale_min_fee_cents_applied INTEGER NULL CHECK (sale_min_fee_cents_applied >= 0),
  sale_fixed_fee_cents_applied INTEGER NULL CHECK (sale_fixed_fee_cents_applied >= 0),
  net_received_cents INTEGER NULL CHECK (net_received_cents >= 0),
  sold_at TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  catalog_id TEXT NULL,
  net_received_manual INTEGER NOT NULL DEFAULT 0 CHECK (net_received_manual IN (0,1)),
  CHECK (acquisition_type <> 'COMPRA' OR purchase_store_id IS NOT NULL),
  CHECK ((purchase_currency = 'USD' AND fx_rate_at_purchase IS NULL)
      OR (purchase_currency = 'BRL' AND fx_rate_at_purchase IS NOT NULL)),
  CHECK (category IN ('SKIN','FACA','LUVA')
      OR (variant IS NULL AND float_value IS NULL AND exterior IS NULL AND paint_seed IS NULL AND phase IS NULL)),
  CHECK (category NOT IN ('SKIN','FACA','LUVA') OR variant IS NOT NULL),
  CHECK (category <> 'LUVA' OR variant = 'NORMAL'),
  CHECK (category <> 'FACA' OR variant <> 'SOUVENIR'),
  CHECK (
    (status = 'VENDIDO' AND sale_store_id IS NOT NULL AND sale_price_cents IS NOT NULL
      AND sale_currency IS NOT NULL AND net_received_cents IS NOT NULL AND sold_at IS NOT NULL
      AND (
        (sale_fee_type_applied IS NOT NULL AND sale_fee_rate_applied IS NOT NULL
          AND sale_fee_rounding_applied IS NOT NULL AND sale_fixed_fee_cents_applied IS NOT NULL)
        OR
        (sale_fee_type_applied IS NULL AND sale_fee_rate_applied IS NULL AND sale_fee_rounding_applied IS NULL
          AND sale_min_fee_cents_applied IS NULL AND sale_fixed_fee_cents_applied IS NULL
          AND net_received_manual = 1)
      ))
    OR
    (status = 'EM_ESTOQUE' AND sale_store_id IS NULL AND sale_price_cents IS NULL
      AND sale_currency IS NULL AND fx_rate_at_sale IS NULL AND sale_fee_type_applied IS NULL
      AND sale_fee_rate_applied IS NULL AND sale_fee_rounding_applied IS NULL
      AND sale_min_fee_cents_applied IS NULL AND sale_fixed_fee_cents_applied IS NULL
      AND net_received_cents IS NULL AND sold_at IS NULL)
  ),
  CHECK (status <> 'VENDIDO'
      OR (sale_currency = 'USD' AND fx_rate_at_sale IS NULL)
      OR (sale_currency = 'BRL' AND fx_rate_at_sale IS NOT NULL)),
  CHECK (net_received_manual = 0 OR status = 'VENDIDO')
) STRICT;
INSERT INTO items_new (${COLUMNS}) SELECT ${COLUMNS} FROM items;
DROP TABLE items;
ALTER TABLE items_new RENAME TO items;
CREATE INDEX idx_items_status ON items(status);
CREATE INDEX idx_items_category ON items(category);
CREATE INDEX idx_items_acquired_at ON items(acquired_at);
CREATE INDEX idx_items_sold_at ON items(sold_at);
CREATE INDEX idx_items_purchase_store ON items(purchase_store_id);
CREATE INDEX idx_items_sale_store ON items(sale_store_id);
CREATE INDEX idx_items_catalog_id ON items(catalog_id);
`;

module.exports = {
  version: 3,
  name: 'manual_net',
  disableForeignKeys: true,
  up(db) {
    // Preserva o contador AUTOINCREMENT: a reconstrução o reiniciaria em MAX(id), reutilizando ids de itens apagados.
    const previous = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = ?").get('items');
    db.exec(SQL);
    if (previous) {
      const current = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = ?").get('items');
      if (current) {
        db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = ?").run(Math.max(current.seq, previous.seq), 'items');
      } else {
        db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)").run('items', previous.seq);
      }
    }
  },
};

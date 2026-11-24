'use strict';

// Migração 17 (D343, D353, D355a; subetapa 10.1): componentes aplicados (stickers, chaveiro, Sticker Slab e patches) por unidade.
// Primeiro as tabelas de operações (vazias, usadas só a partir da 10.3; `item_components` aponta para elas), depois
// `item_components` e a coluna `items.components_imported_at`. Só CREATE e ADD COLUMN, sem reconstruir nenhuma tabela e
// sem tocar nos dados existentes: custo, saldo, giro e lucro real ficam idênticos. Migração publicada nunca é editada (D69).
const SQL = `
CREATE TABLE item_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('APPLY_COMPONENT','DETACH_COMPONENT','SCRAPE_OFF','OPEN_CASE','OPEN_TERMINAL','TRADE_UP')),
  outcome TEXT NOT NULL CHECK (outcome IN ('TRANSFERRED','LOST')),
  occurred_at TEXT NOT NULL,
  note TEXT NULL,
  undone_at TEXT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE item_operation_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id INTEGER NOT NULL REFERENCES item_operations(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('CONSUMED','TARGET','CREATED')),
  cost_share_bp INTEGER NULL CHECK (cost_share_bp IS NULL OR cost_share_bp BETWEEN 0 AND 10000),
  UNIQUE (operation_id, item_id)
) STRICT;
CREATE INDEX idx_item_operation_links_item ON item_operation_links(item_id, role);

CREATE TABLE item_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('STICKER','CHARM','STICKER_SLAB','PATCH')),
  catalog_id TEXT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  slot INTEGER NULL CHECK (slot IS NULL OR slot BETWEEN 0 AND 5),
  wear REAL NULL CHECK (wear IS NULL OR (wear >= 0 AND wear < 1)),
  pattern INTEGER NULL CHECK (pattern IS NULL OR pattern BETWEEN 0 AND 999999),
  purchase_reference_cents INTEGER NULL CHECK (purchase_reference_cents IS NULL OR purchase_reference_cents >= 0),
  source TEXT NOT NULL CHECK (source IN ('MANUAL','CSFLOAT')),
  origin TEXT NOT NULL DEFAULT 'CAME_WITH' CHECK (origin IN ('CAME_WITH','APPLIED_FROM_STOCK')),
  source_item_id INTEGER NULL REFERENCES items(id) ON DELETE RESTRICT,
  operation_id INTEGER NULL REFERENCES item_operations(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((origin = 'CAME_WITH' AND source_item_id IS NULL AND operation_id IS NULL)
      OR (origin = 'APPLIED_FROM_STOCK' AND source_item_id IS NOT NULL AND operation_id IS NOT NULL))
) STRICT;
CREATE INDEX idx_item_components_item ON item_components(item_id);
CREATE UNIQUE INDEX idx_item_components_source_item ON item_components(source_item_id) WHERE source_item_id IS NOT NULL;
CREATE UNIQUE INDEX idx_item_components_slot ON item_components(item_id, kind, slot) WHERE slot IS NOT NULL;

ALTER TABLE items ADD COLUMN components_imported_at TEXT NULL;
`;

module.exports = {
  version: 17,
  name: 'item_components',
  up(db) {
    db.exec(SQL);
  },
};

'use strict';

// Migração 19 (D362, subetapa 10.3): "Aplicar do estoque". Reconstrói `items` (o SQLite não altera CHECK de tabela) para aceitar o
// status `CONSUMIDO`, o tipo de aquisição `GERADO`, a categoria `PATCH` e a coluna `consumed_at`; reconstrói `catalog_items` para
// aceitar a fonte `PATCHES` e a categoria `PATCH`; acrescenta `item_operations.detail_json` e o índice de `item_components.operation_id`.
// Preserva todas as linhas (id, created_at, updated_at), o contador AUTOINCREMENT e os índices; confere contagens e somas dentro da
// transação (qualquer diferença lança erro e o banco continua na v018). Migração publicada nunca é editada (D69).
const ITEM_COLUMNS = [
  'id', 'name', 'category', 'variant', 'float_value', 'exterior', 'paint_seed', 'phase', 'inspect_link', 'asset_id',
  'acquisition_type', 'origin_detail', 'purchase_store_id', 'purchase_price_cents', 'purchase_currency',
  'fx_rate_at_purchase', 'acquired_at', 'trade_unlock_at', 'status', 'sale_store_id', 'sale_price_cents',
  'sale_currency', 'fx_rate_at_sale', 'sale_fee_type_applied', 'sale_fee_rate_applied', 'sale_fee_rounding_applied',
  'sale_min_fee_cents_applied', 'sale_fixed_fee_cents_applied', 'net_received_cents', 'sold_at', 'created_at',
  'updated_at', 'catalog_id', 'net_received_manual', 'sale_hold_days_applied', 'off_sale_at', 'for_sale_since',
  'sale_release_at', 'components_imported_at',
].join(', ');

const CATALOG_COLUMNS = [
  'id', 'source', 'category', 'name', 'name_pt_br', 'name_key', 'search_text', 'image_url', 'min_float', 'max_float',
  'has_stattrak', 'has_souvenir', 'phase', 'rarity', 'updated_at',
].join(', ');

const ITEMS_SQL = `
CREATE TABLE items_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  category TEXT NOT NULL CHECK (category IN ('SKIN','FACA','LUVA','CAIXA','CAPSULA','STICKER','PINGENTE','PERSONAGEM','PASSE_BATALHA','OUTRO','PATCH')),
  variant TEXT NULL CHECK (variant IN ('NORMAL','STATTRAK','SOUVENIR')),
  float_value REAL NULL CHECK (float_value >= 0 AND float_value <= 1),
  exterior TEXT NULL CHECK (exterior IN ('FN','MW','FT','WW','BS')),
  paint_seed INTEGER NULL CHECK (paint_seed BETWEEN 0 AND 1000),
  phase TEXT NULL,
  inspect_link TEXT NULL,
  asset_id TEXT NULL,
  acquisition_type TEXT NOT NULL CHECK (acquisition_type IN ('GANHEI','COMPRA','GERADO')),
  origin_detail TEXT NULL,
  purchase_store_id INTEGER NULL REFERENCES stores(id) ON DELETE RESTRICT,
  purchase_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (purchase_price_cents >= 0),
  purchase_currency TEXT NOT NULL DEFAULT 'USD' CHECK (purchase_currency IN ('USD','BRL')),
  fx_rate_at_purchase REAL NULL CHECK (fx_rate_at_purchase > 0),
  acquired_at TEXT NOT NULL,
  trade_unlock_at TEXT NULL,
  status TEXT NOT NULL DEFAULT 'EM_ESTOQUE' CHECK (status IN ('EM_ESTOQUE','VENDIDO','CONSUMIDO')),
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
  sale_hold_days_applied INTEGER NULL
  CHECK (sale_hold_days_applied IS NULL OR (status = 'VENDIDO' AND sale_hold_days_applied BETWEEN 0 AND 30)),
  off_sale_at TEXT NULL,
  for_sale_since TEXT NULL,
  sale_release_at TEXT NULL,
  components_imported_at TEXT NULL,
  consumed_at TEXT NULL,
  CHECK (acquisition_type <> 'COMPRA' OR purchase_store_id IS NOT NULL),
  CHECK (acquisition_type <> 'GERADO'
      OR (purchase_store_id IS NULL AND purchase_price_cents = 0 AND purchase_currency = 'USD' AND fx_rate_at_purchase IS NULL)),
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
    (status IN ('EM_ESTOQUE','CONSUMIDO') AND sale_store_id IS NULL AND sale_price_cents IS NULL
      AND sale_currency IS NULL AND fx_rate_at_sale IS NULL AND sale_fee_type_applied IS NULL
      AND sale_fee_rate_applied IS NULL AND sale_fee_rounding_applied IS NULL
      AND sale_min_fee_cents_applied IS NULL AND sale_fixed_fee_cents_applied IS NULL
      AND net_received_cents IS NULL AND sold_at IS NULL)
  ),
  CHECK (status <> 'VENDIDO'
      OR (sale_currency = 'USD' AND fx_rate_at_sale IS NULL)
      OR (sale_currency = 'BRL' AND fx_rate_at_sale IS NOT NULL)),
  CHECK (net_received_manual = 0 OR status = 'VENDIDO'),
  CHECK ((status = 'CONSUMIDO') = (consumed_at IS NOT NULL))
) STRICT;
INSERT INTO items_new (${ITEM_COLUMNS}) SELECT ${ITEM_COLUMNS} FROM items;
DROP TABLE items;
ALTER TABLE items_new RENAME TO items;
CREATE INDEX idx_items_status ON items(status);
CREATE INDEX idx_items_category ON items(category);
CREATE INDEX idx_items_acquired_at ON items(acquired_at);
CREATE INDEX idx_items_sold_at ON items(sold_at);
CREATE INDEX idx_items_purchase_store ON items(purchase_store_id);
CREATE INDEX idx_items_sale_store ON items(sale_store_id);
CREATE INDEX idx_items_catalog_id ON items(catalog_id);
CREATE INDEX idx_items_off_sale_at ON items(off_sale_at);
`;

const CATALOG_SQL = `
CREATE TABLE catalog_items_new (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
  source TEXT NOT NULL CHECK (source IN ('SKINS','STICKERS','CRATES','KEYCHAINS','AGENTS','PATCHES')),
  category TEXT NOT NULL CHECK (category IN ('SKIN','FACA','LUVA','CAIXA','CAPSULA','STICKER','PINGENTE','PERSONAGEM','PASSE_BATALHA','OUTRO','PATCH')),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  name_pt_br TEXT NULL,
  name_key TEXT NOT NULL,
  search_text TEXT NOT NULL,
  image_url TEXT NULL,
  min_float REAL NULL CHECK (min_float >= 0 AND min_float <= 1),
  max_float REAL NULL CHECK (max_float >= 0 AND max_float <= 1),
  has_stattrak INTEGER NOT NULL DEFAULT 0 CHECK (has_stattrak IN (0,1)),
  has_souvenir INTEGER NOT NULL DEFAULT 0 CHECK (has_souvenir IN (0,1)),
  phase TEXT NULL,
  rarity TEXT NULL,
  updated_at TEXT NOT NULL,
  CHECK (min_float IS NULL OR max_float IS NULL OR min_float <= max_float)
) STRICT;
INSERT INTO catalog_items_new (${CATALOG_COLUMNS}) SELECT ${CATALOG_COLUMNS} FROM catalog_items;
DROP TABLE catalog_items;
ALTER TABLE catalog_items_new RENAME TO catalog_items;
CREATE INDEX idx_catalog_items_category_key ON catalog_items(category, name_key);
`;

const EXTRA_SQL = `
ALTER TABLE item_operations ADD COLUMN detail_json TEXT NULL;
CREATE INDEX idx_item_components_operation ON item_components(operation_id);
`;

// Contagens e somas que a reconstrução não pode mudar.
function snapshot(db) {
  const items = db
    .prepare(
      'SELECT COUNT(*) AS n, COALESCE(SUM(id), 0) AS ids, COALESCE(SUM(purchase_price_cents), 0) AS purchase, COALESCE(SUM(COALESCE(net_received_cents, 0)), 0) AS net FROM items'
    )
    .get();
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return { items, catalog: count('catalog_items'), components: count('item_components'), links: count('item_operation_links') };
}

// Preserva o contador AUTOINCREMENT: a reconstrução o reiniciaria em MAX(id), reutilizando ids de itens apagados.
function restoreSequence(db, table, previous) {
  if (!previous) return;
  const current = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table);
  if (current) db.prepare('UPDATE sqlite_sequence SET seq = ? WHERE name = ?').run(Math.max(current.seq, previous.seq), table);
  else db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(table, previous.seq);
}

module.exports = {
  version: 19,
  name: 'consumed_generated_patch',
  disableForeignKeys: true,
  up(db) {
    const before = snapshot(db);
    const previousSeq = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get('items');
    db.exec(ITEMS_SQL);
    db.exec(CATALOG_SQL);
    db.exec(EXTRA_SQL);
    restoreSequence(db, 'items', previousSeq);
    const after = snapshot(db);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error('A migração 19 alterou contagens ou somas dos dados (itens, catálogo, componentes ou vínculos). Nada foi gravado.');
    }
  },
};

'use strict';

// Migração 25 (D369, Adendo 1, subetapa 11.4): lojas em qualquer das 17 moedas.
// - Reconstrói `stores` e `items` (o SQLite não altera CHECK de tabela): o `CHECK (currency IN ('USD','BRL'))` vira um `CHECK` de formato
//   (3 letras maiúsculas; a lista das moedas fica no `storeService`/`CURRENCIES`) e, nos itens, os pares moeda x cotação passam a ser
//   "USD sem cotação / outra moeda com cotação". Todo valor e toda cotação já gravados ficam exatamente como estão.
// - Acrescenta `deposits.amount_brl_currency` e `withdrawals.amount_brl_currency` (padrão 'BRL' para os registros existentes): a moeda
//   do valor informativo "pago/recebido" (E-P3-Q15, 4.8). O nome da coluna do valor (`amount_brl_cents`) não muda.
// Preserva ids, datas, contadores AUTOINCREMENT, índices e chaves estrangeiras; confere contagens e somas dentro da transação (qualquer
// diferença lança erro e o banco continua na v024). O backup automático roda antes (`backupBeforeMigrating`). Migração publicada
// nunca é editada (D69).
const ITEM_COLUMNS = [
  'id', 'name', 'category', 'variant', 'float_value', 'exterior', 'paint_seed', 'phase', 'inspect_link', 'asset_id',
  'acquisition_type', 'origin_detail', 'purchase_store_id', 'purchase_price_cents', 'purchase_currency',
  'fx_rate_at_purchase', 'acquired_at', 'trade_unlock_at', 'status', 'sale_store_id', 'sale_price_cents',
  'sale_currency', 'fx_rate_at_sale', 'sale_fee_type_applied', 'sale_fee_rate_applied', 'sale_fee_rounding_applied',
  'sale_min_fee_cents_applied', 'sale_fixed_fee_cents_applied', 'net_received_cents', 'sold_at', 'created_at',
  'updated_at', 'catalog_id', 'net_received_manual', 'sale_hold_days_applied', 'off_sale_at', 'for_sale_since',
  'sale_release_at', 'components_imported_at', 'consumed_at',
].join(', ');

const STORE_COLUMNS = [
  'id', 'name', 'currency', 'is_active', 'is_primary', 'sale_fee_type', 'sale_fee_rate', 'sale_fee_rounding', 'sale_min_fee_cents',
  'sale_fixed_fee_cents', 'allows_withdrawal', 'withdrawal_fee_rate', 'withdrawal_fixed_fee_cents', 'created_at', 'updated_at',
  'sale_hold_days',
].join(', ');

const STORES_SQL = `
CREATE TABLE stores_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0),
  currency TEXT NOT NULL CHECK (length(currency) = 3 AND currency = upper(currency)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  sale_fee_type TEXT NULL CHECK (sale_fee_type IN ('DEDUCTED','ADDED')),
  sale_fee_rate REAL NULL CHECK (sale_fee_rate >= 0 AND sale_fee_rate < 1),
  sale_fee_rounding TEXT NOT NULL DEFAULT 'CEIL' CHECK (sale_fee_rounding IN ('CEIL','ROUND','FLOOR')),
  sale_min_fee_cents INTEGER NULL CHECK (sale_min_fee_cents >= 0),
  sale_fixed_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (sale_fixed_fee_cents >= 0),
  allows_withdrawal INTEGER NOT NULL DEFAULT 0 CHECK (allows_withdrawal IN (0,1)),
  withdrawal_fee_rate REAL NULL CHECK (withdrawal_fee_rate >= 0 AND withdrawal_fee_rate < 1),
  withdrawal_fixed_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (withdrawal_fixed_fee_cents >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sale_hold_days INTEGER NOT NULL DEFAULT 0
  CHECK (sale_hold_days BETWEEN 0 AND 30),
  CHECK (is_primary = 0 OR is_active = 1)
) STRICT;
INSERT INTO stores_new (${STORE_COLUMNS}) SELECT ${STORE_COLUMNS} FROM stores;
DROP TABLE stores;
ALTER TABLE stores_new RENAME TO stores;
CREATE UNIQUE INDEX ux_stores_primary ON stores(is_primary) WHERE is_primary = 1;
`;

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
  purchase_currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(purchase_currency) = 3 AND purchase_currency = upper(purchase_currency)),
  fx_rate_at_purchase REAL NULL CHECK (fx_rate_at_purchase > 0),
  acquired_at TEXT NOT NULL,
  trade_unlock_at TEXT NULL,
  status TEXT NOT NULL DEFAULT 'EM_ESTOQUE' CHECK (status IN ('EM_ESTOQUE','VENDIDO','CONSUMIDO')),
  sale_store_id INTEGER NULL REFERENCES stores(id) ON DELETE RESTRICT,
  sale_price_cents INTEGER NULL CHECK (sale_price_cents > 0),
  sale_currency TEXT NULL CHECK (sale_currency IS NULL OR (length(sale_currency) = 3 AND sale_currency = upper(sale_currency))),
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
      OR (purchase_currency <> 'USD' AND fx_rate_at_purchase IS NOT NULL)),
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
      OR (sale_currency <> 'USD' AND fx_rate_at_sale IS NOT NULL)),
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

const EXTRA_SQL = `
ALTER TABLE deposits ADD COLUMN amount_brl_currency TEXT NOT NULL DEFAULT 'BRL' CHECK (length(amount_brl_currency) = 3);
ALTER TABLE withdrawals ADD COLUMN amount_brl_currency TEXT NOT NULL DEFAULT 'BRL' CHECK (length(amount_brl_currency) = 3);
`;

// Contagens e somas que a reconstrução não pode mudar.
function snapshot(db) {
  const items = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(id), 0) AS ids, COALESCE(SUM(purchase_price_cents), 0) AS purchase,
              COALESCE(SUM(COALESCE(net_received_cents, 0)), 0) AS net, COALESCE(SUM(COALESCE(fx_rate_at_purchase, 0)), 0) AS fxp,
              COALESCE(SUM(COALESCE(fx_rate_at_sale, 0)), 0) AS fxs, COUNT(DISTINCT purchase_currency) AS pcur FROM items`
    )
    .get();
  const stores = db
    .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(id), 0) AS ids, COALESCE(SUM(is_primary), 0) AS prim, COALESCE(SUM(is_active), 0) AS act FROM stores')
    .get();
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return {
    items, stores, deposits: count('deposits'), withdrawals: count('withdrawals'), balances: count('store_balances'),
    components: count('item_components'), links: count('item_operation_links'),
  };
}

// Preserva o contador AUTOINCREMENT: a reconstrução o reiniciaria em MAX(id), reutilizando ids de registros apagados.
function restoreSequence(db, table, previous) {
  if (!previous) return;
  const current = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table);
  if (current) db.prepare('UPDATE sqlite_sequence SET seq = ? WHERE name = ?').run(Math.max(current.seq, previous.seq), table);
  else db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(table, previous.seq);
}

module.exports = {
  version: 25,
  name: 'store_currencies',
  disableForeignKeys: true,
  up(db) {
    const before = snapshot(db);
    const itemsSeq = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get('items');
    const storesSeq = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get('stores');
    db.exec(STORES_SQL);
    db.exec(ITEMS_SQL);
    db.exec(EXTRA_SQL);
    restoreSequence(db, 'items', itemsSeq);
    restoreSequence(db, 'stores', storesSeq);
    const after = snapshot(db);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error('A migração 25 alterou contagens ou somas dos dados (lojas, itens, aportes, saques ou conferências). Nada foi gravado.');
    }
    const broken = db.prepare('PRAGMA foreign_key_check').all();
    if (broken.length > 0) throw new Error('A migração 25 deixou referências quebradas entre as tabelas. Nada foi gravado.');
  },
};

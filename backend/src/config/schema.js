const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0),
  currency TEXT NOT NULL CHECK (currency IN ('USD','BRL')),
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
  CHECK (is_primary = 0 OR is_active = 1)
) STRICT;
CREATE UNIQUE INDEX ux_stores_primary ON stores(is_primary) WHERE is_primary = 1;

CREATE TABLE items (
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
      AND sale_currency IS NOT NULL AND sale_fee_type_applied IS NOT NULL
      AND sale_fee_rate_applied IS NOT NULL AND sale_fee_rounding_applied IS NOT NULL
      AND sale_fixed_fee_cents_applied IS NOT NULL AND net_received_cents IS NOT NULL
      AND sold_at IS NOT NULL)
    OR
    (status = 'EM_ESTOQUE' AND sale_store_id IS NULL AND sale_price_cents IS NULL
      AND sale_currency IS NULL AND fx_rate_at_sale IS NULL AND sale_fee_type_applied IS NULL
      AND sale_fee_rate_applied IS NULL AND sale_fee_rounding_applied IS NULL
      AND sale_min_fee_cents_applied IS NULL AND sale_fixed_fee_cents_applied IS NULL
      AND net_received_cents IS NULL AND sold_at IS NULL)
  ),
  CHECK (status <> 'VENDIDO'
      OR (sale_currency = 'USD' AND fx_rate_at_sale IS NULL)
      OR (sale_currency = 'BRL' AND fx_rate_at_sale IS NOT NULL))
) STRICT;
CREATE INDEX idx_items_status ON items(status);
CREATE INDEX idx_items_category ON items(category);
CREATE INDEX idx_items_acquired_at ON items(acquired_at);
CREATE INDEX idx_items_sold_at ON items(sold_at);
CREATE INDEX idx_items_purchase_store ON items(purchase_store_id);
CREATE INDEX idx_items_sale_store ON items(sale_store_id);

CREATE TABLE deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount_brl_cents INTEGER NOT NULL CHECK (amount_brl_cents > 0),
  deposited_at TEXT NOT NULL,
  store_id INTEGER NULL REFERENCES stores(id) ON DELETE RESTRICT,
  note TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_deposits_deposited_at ON deposits(deposited_at);

CREATE TABLE withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NULL REFERENCES stores(id) ON DELETE RESTRICT,
  amount_store_cents INTEGER NULL CHECK (amount_store_cents > 0),
  amount_brl_cents INTEGER NOT NULL CHECK (amount_brl_cents > 0),
  withdrawn_at TEXT NOT NULL,
  note TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((store_id IS NULL) = (amount_store_cents IS NULL))
) STRICT;
CREATE INDEX idx_withdrawals_store_date ON withdrawals(store_id, withdrawn_at DESC, id DESC);
CREATE INDEX idx_withdrawals_withdrawn_at ON withdrawals(withdrawn_at);

CREATE TABLE store_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),
  fx_rate REAL NULL CHECK (fx_rate > 0),
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX idx_store_balances_store_date ON store_balances(store_id, recorded_at DESC, id DESC);

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  usd_brl_rate REAL NULL CHECK (usd_brl_rate > 0),
  usd_brl_rate_updated_at TEXT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`;

module.exports = { SCHEMA_SQL, SCHEMA_VERSION };

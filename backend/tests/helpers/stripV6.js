'use strict';

// Remove as colunas acrescentadas pelas migrações v6 (D199), v7 (D223) e v8 (D240), para comparar linhas de bancos
// anteriores com as migradas. A v7 acrescenta `amount_store_cents` só em `deposits` (os saques já a tinham desde a v1);
// a v8 acrescenta `kind`, `computed_cents`, `adjustment_cents` e `note` só em `store_balances` (linhas com `balance_cents`).
const V6_COLUMNS = ['fee_cents', 'sale_hold_days', 'sale_hold_days_applied'];

const V8_COLUMNS = ['kind', 'computed_cents', 'adjustment_cents', 'note'];

const stripV6 = (row) => Object.fromEntries(
  Object.entries(row).filter(([key]) => !V6_COLUMNS.includes(key)
    && !(key === 'amount_store_cents' && 'deposited_at' in row)
    && !(V8_COLUMNS.includes(key) && 'balance_cents' in row))
);
const stripV6Rows = (rows) => rows.map(stripV6);

module.exports = { V6_COLUMNS, stripV6, stripV6Rows };

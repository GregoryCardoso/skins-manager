'use strict';

// Remove as colunas acrescentadas pelas migrações v6 (D199), v7 (D223), v8 (D240) e v10 (D264), para comparar linhas de bancos
// anteriores com as migradas. A v7 acrescenta `amount_store_cents` só em `deposits` (os saques já a tinham desde a v1);
// a v8 acrescenta `kind`, `computed_cents`, `adjustment_cents` e `note` só em `store_balances` (linhas com `balance_cents`).
const V6_COLUMNS = ['fee_cents', 'sale_hold_days', 'sale_hold_days_applied'];

const V8_COLUMNS = ['kind', 'computed_cents', 'adjustment_cents', 'note'];
// A v10 acrescenta `off_sale_at` e `for_sale_since` só em `items` (D264).
const V10_COLUMNS = ['off_sale_at', 'for_sale_since'];
// A v14 acrescenta `sale_release_at` só em `items` (D312).
const V14_COLUMNS = ['sale_release_at'];
// A v17 acrescenta `components_imported_at` só em `items` (D343).
const V17_COLUMNS = ['components_imported_at'];

const stripV6 = (row) => Object.fromEntries(
  Object.entries(row).filter(([key]) => !V6_COLUMNS.includes(key)
    && !(key === 'amount_store_cents' && 'deposited_at' in row)
    // a v16 acrescenta `fee_cents` (taxa do aporte, D311) em deposits; o fee_cents dos saques é antigo e fica
    && !(key === 'fee_cents' && 'deposited_at' in row)
    && !(V8_COLUMNS.includes(key) && 'balance_cents' in row)
    && !V10_COLUMNS.includes(key)
    && !V14_COLUMNS.includes(key)
    && !V17_COLUMNS.includes(key))
);
const stripV6Rows = (rows) => rows.map(stripV6);

module.exports = { V6_COLUMNS, stripV6, stripV6Rows };

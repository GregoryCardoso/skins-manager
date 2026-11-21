'use strict';

// Remove as colunas acrescentadas pela migração v6 (D199), para comparar linhas de bancos anteriores à v6 com as migradas.
const V6_COLUMNS = ['fee_cents', 'sale_hold_days', 'sale_hold_days_applied'];

const stripV6 = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => !V6_COLUMNS.includes(key)));
const stripV6Rows = (rows) => rows.map(stripV6);

module.exports = { V6_COLUMNS, stripV6, stripV6Rows };

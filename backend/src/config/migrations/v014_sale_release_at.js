'use strict';

// Migração 14 (D312, parte 9.3): liberação real da venda importada do CSFloat. Só acrescenta uma coluna nula em `items`;
// vendas manuais (e as já gravadas) ficam com ela nula e continuam liberadas em `soldAt + saleHoldDaysApplied`. Não reconstrói a
// tabela nem desliga as chaves estrangeiras. Migração publicada nunca é editada (D69).
const SQL = `
ALTER TABLE items ADD COLUMN sale_release_at TEXT NULL;
`;

module.exports = {
  version: 14,
  name: 'sale_release_at',
  up(db) {
    db.exec(SQL);
  },
};

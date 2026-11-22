'use strict';

// Migração 10 (D264): itens "fora de venda" (8.7.2). Só acrescenta duas colunas nulas em `items` (todos os itens ficam à
// venda) e um índice; não reconstrói a tabela nem desliga as chaves estrangeiras (como a v6). Sem CHECK cruzado com
// `status`: a regra "só EM_ESTOQUE sai da venda" fica no service. Migração publicada nunca é editada (D69).
const SQL = `
ALTER TABLE items ADD COLUMN off_sale_at TEXT NULL;
ALTER TABLE items ADD COLUMN for_sale_since TEXT NULL;
CREATE INDEX idx_items_off_sale_at ON items(off_sale_at);
`;

module.exports = {
  version: 10,
  name: 'off_sale',
  up(db) {
    db.exec(SQL);
  },
};

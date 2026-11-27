'use strict';

// Migração 28 (D370, pedido do usuário): "Vendo nesta loja" (`sells_here`). Só ADD COLUMN em `stores`, como a v027: não reconstrói a tabela.
// Todas as lojas existentes recebem 1 (vendo nela), o padrão. Só filtra o preço mínimo do item; compras, vendas registradas, aportes,
// saques, saldos e importação continuam com todas as lojas ativas. O backup automático roda antes (`backupBeforeMigrating`).
// ATENÇÃO: a v025 reconstrói `stores` com lista de colunas fixa; uma reconstrução futura precisa incluir `sells_here`.
// Migração publicada nunca é editada (D69).
const SQL = `
ALTER TABLE stores ADD COLUMN sells_here INTEGER NOT NULL DEFAULT 1 CHECK (sells_here IN (0,1));
`;

module.exports = {
  version: 28,
  name: 'store_sells_here',
  up(db) {
    db.exec(SQL);
  },
};

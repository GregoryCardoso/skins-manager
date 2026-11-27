'use strict';

// Migração 27 (D370, 12.5a): densidade da tabela do inventário ('COMPACT' ou 'COMFORTABLE'). Só ADD COLUMN em `settings`, como a v11:
// não reconstrói a tabela. A linha atual recebe 'COMPACT' (padrão). O backup automático roda antes (`backupBeforeMigrating`).
// ATENÇÃO: a v023 tem a lista `COLUMNS` fixa; uma reconstrução futura de `settings` precisa incluir `inventory_density`.
// Migração publicada nunca é editada (D69).
const SQL = `
ALTER TABLE settings ADD COLUMN inventory_density TEXT NOT NULL DEFAULT 'COMPACT'
  CHECK (inventory_density IN ('COMPACT','COMFORTABLE'));
`;

module.exports = {
  version: 27,
  name: 'inventory_density',
  up(db) {
    db.exec(SQL);
  },
};

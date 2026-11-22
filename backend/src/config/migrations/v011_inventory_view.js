'use strict';

// Migração 11 (D276): preferência da visão do inventário (8.8). Só ADD COLUMN em `settings` (como a v2 com `theme`):
// não reconstrói a tabela. A linha atual recebe 'GROUPED' (padrão). Migração publicada nunca é editada (D69).
const SQL = `
ALTER TABLE settings ADD COLUMN inventory_view TEXT NOT NULL DEFAULT 'GROUPED'
  CHECK (inventory_view IN ('INDIVIDUAL','GROUPED'));
`;

module.exports = {
  version: 11,
  name: 'inventory_view',
  up(db) {
    db.exec(SQL);
  },
};

'use strict';

// Migração 4: base da Etapa 6 (D143). Só ADD COLUMN, UPDATE e PRAGMA, sem reconstruir tabelas.
// - usd_brl_rate_source / ptax_quoted_at: origem da cotação (MANUAL ou PTAX) e data da PTAX.
// - slow_item_days (2..365) e fast_turnover_days (1..364): limites de giro salvos pelo usuário (nulo = padrão: slow = .env, fast = 7).
//   A regra cruzada 1 <= fast < slow é validada no service (6.2), não no banco.
// - stores_seeded: o seed das lojas iniciais roda uma única vez (T5).
// - application_id 'SKMG': marca do arquivo do app (D151).
// Migração publicada nunca é editada (D69).
const SQL = `
ALTER TABLE settings ADD COLUMN usd_brl_rate_source TEXT NULL CHECK (usd_brl_rate_source IN ('MANUAL','PTAX'));
ALTER TABLE settings ADD COLUMN ptax_quoted_at TEXT NULL;
ALTER TABLE settings ADD COLUMN slow_item_days INTEGER NULL CHECK (slow_item_days BETWEEN 2 AND 365);
ALTER TABLE settings ADD COLUMN fast_turnover_days INTEGER NULL CHECK (fast_turnover_days BETWEEN 1 AND 364);
ALTER TABLE settings ADD COLUMN stores_seeded INTEGER NOT NULL DEFAULT 0 CHECK (stores_seeded IN (0,1));
UPDATE settings SET usd_brl_rate_source = 'MANUAL' WHERE usd_brl_rate IS NOT NULL;
UPDATE settings SET stores_seeded = 1 WHERE EXISTS (SELECT 1 FROM stores);
PRAGMA application_id = 1397444935;
`;

module.exports = {
  version: 4,
  name: 'stores_settings',
  up(db) {
    db.exec(SQL);
  },
};

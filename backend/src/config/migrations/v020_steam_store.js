'use strict';

// Migração 20 (D363, subetapa 10.4, E-P2-Q45): a loja Steam do app (`settings.steam_store_id`), usada no preço pago ao comprar o item
// de um terminal. Só ADD COLUMN, sem reconstruir tabelas nem desligar as chaves estrangeiras; loja excluída limpa a referência
// (`ON DELETE SET NULL`). Preenche uma única vez com a loja chamada "steam" (sem diferenciar maiúsculas, com `trim`) em BRL, se houver
// exatamente uma; senão fica nula (o usuário escolhe em Lojas). `items` e `item_operations` não mudam. Migração publicada nunca é
// editada (D69).
const SQL = `
ALTER TABLE settings ADD COLUMN steam_store_id INTEGER NULL REFERENCES stores(id) ON DELETE SET NULL;
`;

module.exports = {
  version: 20,
  name: 'steam_store',
  up(db) {
    db.exec(SQL);
    const candidates = db
      .prepare("SELECT id FROM stores WHERE lower(trim(name)) = 'steam' AND currency = 'BRL' ORDER BY id ASC")
      .all();
    if (candidates.length === 1) {
      db.prepare('UPDATE settings SET steam_store_id = ? WHERE id = 1').run(candidates[0].id);
    }
  },
};

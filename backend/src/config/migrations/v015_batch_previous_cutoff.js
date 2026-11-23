'use strict';

// Migração 15 (D326, parte 9.5.1c): a data de corte anterior fica no lote que a mudou, para o "Desfazer importação" restaurá-la.
// Só acrescenta uma coluna nula em `import_batches` (os lotes existentes não mudaram o corte). Não reconstrói a tabela nem
// desliga as chaves estrangeiras. A v015 estava só reservada para a 9.6 (nada publicado); a taxa do aporte passa para a v016.
// Migração publicada nunca é editada (D69).
const SQL = `
ALTER TABLE import_batches ADD COLUMN previous_trades_cutoff_at TEXT NULL;
`;

module.exports = {
  version: 15,
  name: 'batch_previous_cutoff',
  up(db) {
    db.exec(SQL);
  },
};

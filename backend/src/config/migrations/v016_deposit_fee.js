'use strict';

// Migração 16 (D311, parte 9.6): a taxa do aporte (`deposits.fee_cents`, opcional; nula = não informada, conta 0) e o corte
// anterior dos aportes e saques no lote que o mudou (`import_batches.previous_transactions_cutoff_at`, para o desfazer; texto vazio =
// o corte não existia). Só ADD COLUMN, sem reconstruir tabelas nem desligar as chaves estrangeiras. Os aportes já lançados ficam
// com a taxa nula: saldo, total colocado e lucro real não mudam. Migração publicada nunca é editada (D69).
const SQL = `
ALTER TABLE deposits ADD COLUMN fee_cents INTEGER NULL CHECK (fee_cents IS NULL OR fee_cents >= 0);
ALTER TABLE import_batches ADD COLUMN previous_transactions_cutoff_at TEXT NULL;
`;

module.exports = {
  version: 16,
  name: 'deposit_fee',
  up(db) {
    db.exec(SQL);
  },
};

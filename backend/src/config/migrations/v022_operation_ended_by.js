'use strict';

// Migração 22 (D366, subetapa 10.7): `item_operations.ended_by_operation_id`, a operação que encerrou uma `APPLY_COMPONENT` quando o
// pendurado aplicado do estoque foi separado da arma (modo `RETURN`: a unidade original volta ao estoque). Operação encerrada continua
// no histórico, mas sai do custo, do desfazer e das proteções, como a desfeita. Só ADD COLUMN e CREATE INDEX: nenhuma linha existente
// muda, e custo, saldo, giro e lucro real ficam idênticos. Migração publicada nunca é editada (D69).
const SQL = `
ALTER TABLE item_operations ADD COLUMN ended_by_operation_id INTEGER NULL REFERENCES item_operations(id);
CREATE INDEX idx_item_operations_ended_by ON item_operations(ended_by_operation_id);
`;

module.exports = {
  version: 22,
  name: 'operation_ended_by',
  up(db) {
    db.exec(SQL);
  },
};

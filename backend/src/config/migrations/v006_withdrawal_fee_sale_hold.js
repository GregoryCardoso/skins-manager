'use strict';

// Migração 6 (D199): taxa paga do saque, retenção do saldo na loja e snapshot da retenção na venda.
// Só ADD COLUMN e UPDATE: não reconstrói tabela e não desliga chaves estrangeiras.
// - withdrawals.fee_cents: nulo = "não informada"; 0 = pagou zero (a regra fee <= valor sacado fica no service).
// - stores.sale_hold_days: dias de retenção do líquido após a venda (0 a 30); CSFloat e CSMoney (sem diferenciar
//   maiúsculas, pois `name` é COLLATE NOCASE) passam a 7. Loja renomeada ou criada pelo usuário fica com 0.
// - items.sale_hold_days_applied: snapshot da retenção vigente na venda; nulo em estoque (CHECK) e nas vendas
//   anteriores à v6 ("retenção não registrada", tratada como liberada).
// Migração publicada nunca é editada (D69).
const SQL = `
ALTER TABLE withdrawals ADD COLUMN fee_cents INTEGER NULL CHECK (fee_cents >= 0);
ALTER TABLE stores ADD COLUMN sale_hold_days INTEGER NOT NULL DEFAULT 0
  CHECK (sale_hold_days BETWEEN 0 AND 30);
ALTER TABLE items ADD COLUMN sale_hold_days_applied INTEGER NULL
  CHECK (sale_hold_days_applied IS NULL OR (status = 'VENDIDO' AND sale_hold_days_applied BETWEEN 0 AND 30));
UPDATE stores SET sale_hold_days = 7 WHERE name IN ('CSFloat', 'CSMoney');
`;

module.exports = {
  version: 6,
  name: 'withdrawal_fee_sale_hold',
  up(db) {
    db.exec(SQL);
  },
};

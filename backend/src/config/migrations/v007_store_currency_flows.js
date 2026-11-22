'use strict';

// Migração 7 (D223): aportes e saques na moeda da loja (8.5).
// O SQLite não remove NOT NULL: reconstrói `deposits` (nova `amount_store_cents`; `amount_brl_cents` passa a ser
// anulável e só informativo) e `withdrawals` (`amount_brl_cents` anulável). Nada é apagado nem convertido:
// todo aporte antigo fica com `amount_store_cents` nulo (registro legado, critério derivado, sem flag).
// Preserva ids, datas e o contador AUTOINCREMENT, e recria os índices. Migração publicada nunca é editada (D69).
const SQL = `
CREATE TABLE deposits_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NULL REFERENCES stores(id) ON DELETE RESTRICT,
  amount_store_cents INTEGER NULL CHECK (amount_store_cents > 0),
  amount_brl_cents INTEGER NULL CHECK (amount_brl_cents > 0),
  deposited_at TEXT NOT NULL,
  note TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (amount_store_cents IS NULL OR store_id IS NOT NULL),
  CHECK (amount_store_cents IS NOT NULL OR amount_brl_cents IS NOT NULL)
) STRICT;
INSERT INTO deposits_new (id, store_id, amount_store_cents, amount_brl_cents, deposited_at, note, created_at, updated_at)
  SELECT id, store_id, NULL, amount_brl_cents, deposited_at, note, created_at, updated_at FROM deposits;
DROP TABLE deposits;
ALTER TABLE deposits_new RENAME TO deposits;
CREATE INDEX idx_deposits_deposited_at ON deposits(deposited_at);

CREATE TABLE withdrawals_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NULL REFERENCES stores(id) ON DELETE RESTRICT,
  amount_store_cents INTEGER NULL CHECK (amount_store_cents > 0),
  fee_cents INTEGER NULL CHECK (fee_cents >= 0),
  amount_brl_cents INTEGER NULL CHECK (amount_brl_cents > 0),
  withdrawn_at TEXT NOT NULL,
  note TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((store_id IS NULL) = (amount_store_cents IS NULL)),
  CHECK (store_id IS NOT NULL OR amount_brl_cents IS NOT NULL)
) STRICT;
INSERT INTO withdrawals_new (id, store_id, amount_store_cents, fee_cents, amount_brl_cents, withdrawn_at, note, created_at, updated_at)
  SELECT id, store_id, amount_store_cents, fee_cents, amount_brl_cents, withdrawn_at, note, created_at, updated_at FROM withdrawals;
DROP TABLE withdrawals;
ALTER TABLE withdrawals_new RENAME TO withdrawals;
CREATE INDEX idx_withdrawals_store_date ON withdrawals(store_id, withdrawn_at DESC, id DESC);
CREATE INDEX idx_withdrawals_withdrawn_at ON withdrawals(withdrawn_at);
`;

// Preserva o contador AUTOINCREMENT: a reconstrução o reiniciaria em MAX(id), reutilizando ids de registros apagados.
function restoreSequence(db, table, previous) {
  if (!previous) return;
  const current = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table);
  if (current) {
    db.prepare('UPDATE sqlite_sequence SET seq = ? WHERE name = ?').run(Math.max(current.seq, previous.seq), table);
  } else {
    db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(table, previous.seq);
  }
}

module.exports = {
  version: 7,
  name: 'store_currency_flows',
  disableForeignKeys: true,
  up(db) {
    const read = (table) => db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get(table);
    const previousDeposits = read('deposits');
    const previousWithdrawals = read('withdrawals');
    db.exec(SQL);
    restoreSequence(db, 'deposits', previousDeposits);
    restoreSequence(db, 'withdrawals', previousWithdrawals);
  },
};

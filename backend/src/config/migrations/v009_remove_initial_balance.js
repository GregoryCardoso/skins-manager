'use strict';

// Migração 9 (D253): fim do saldo inicial (Revisão 23). Reconstrói `store_balances` para o banco recusar `INITIAL`.
// Os `INITIAL` viram registros antigos (`CHECK` sem cálculo nem ajuste); nada é apagado e os ids são mantidos.
// A coluna `kind` fica, com um único valor. Migração publicada nunca é editada (D69): a v008 não muda.
const SQL = `
CREATE TABLE store_balances_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL DEFAULT 'CHECK' CHECK (kind = 'CHECK'),
  balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),
  computed_cents INTEGER NULL,
  adjustment_cents INTEGER NULL CHECK (adjustment_cents <> 0),
  fx_rate REAL NULL CHECK (fx_rate > 0),
  note TEXT NULL,
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (adjustment_cents IS NULL OR computed_cents IS NOT NULL)
) STRICT;
INSERT INTO store_balances_new (id, store_id, kind, balance_cents, computed_cents, adjustment_cents, fx_rate, note, recorded_at, created_at)
  SELECT id, store_id, 'CHECK', balance_cents,
         CASE WHEN kind = 'INITIAL' THEN NULL ELSE computed_cents END,
         CASE WHEN kind = 'INITIAL' THEN NULL ELSE adjustment_cents END,
         fx_rate, note, recorded_at, created_at
  FROM store_balances;
DROP TABLE store_balances;
ALTER TABLE store_balances_new RENAME TO store_balances;
CREATE INDEX idx_store_balances_store_date ON store_balances(store_id, recorded_at DESC, id DESC);
`;

// Preserva o contador AUTOINCREMENT (a reconstrução o reiniciaria em MAX(id)).
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
  version: 9,
  name: 'remove_initial_balance',
  disableForeignKeys: true,
  up(db) {
    const previous = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get('store_balances');
    db.exec(SQL);
    restoreSequence(db, 'store_balances', previous);
  },
};

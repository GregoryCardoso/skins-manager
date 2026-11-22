'use strict';

// Migração 8 (D240): saldo das lojas calculado (8.6).
// `store_balances` ganha `kind` (INITIAL = saldo inicial; CHECK = conferência), `computed_cents`, `adjustment_cents` e
// `note`. O SQLite não altera CHECK, então a tabela é reconstruída (nome mantido: REQUIRED_TABLES do backup, D151).
// Nada é apagado: todo registro antigo vira conferência ("registro antigo", sem calculado nem ajuste), e o mais
// recente de cada loja (desempate pelo maior id) vira o saldo inicial (E8-Q18). Os ajustes nunca nascem aqui: são
// feitos pelo service. Os itens não mudam. Migração publicada nunca é editada (D69).
const SQL = `
CREATE TABLE store_balances_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('INITIAL','CHECK')),
  balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),
  computed_cents INTEGER NULL,
  adjustment_cents INTEGER NULL CHECK (adjustment_cents <> 0),
  fx_rate REAL NULL CHECK (fx_rate > 0),
  note TEXT NULL,
  recorded_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (kind = 'CHECK' OR (computed_cents IS NULL AND adjustment_cents IS NULL)),
  CHECK (adjustment_cents IS NULL OR computed_cents IS NOT NULL)
) STRICT;
INSERT INTO store_balances_new (id, store_id, kind, balance_cents, computed_cents, adjustment_cents, fx_rate, note, recorded_at, created_at)
  SELECT id, store_id, 'CHECK', balance_cents, NULL, NULL, fx_rate, NULL, recorded_at, created_at FROM store_balances;
DROP TABLE store_balances;
ALTER TABLE store_balances_new RENAME TO store_balances;
UPDATE store_balances SET kind = 'INITIAL' WHERE id IN (
  SELECT (SELECT x.id FROM store_balances x WHERE x.store_id = s.store_id ORDER BY x.recorded_at DESC, x.id DESC LIMIT 1)
  FROM (SELECT DISTINCT store_id FROM store_balances) s);
CREATE INDEX idx_store_balances_store_date ON store_balances(store_id, recorded_at DESC, id DESC);
CREATE UNIQUE INDEX ux_store_balances_initial ON store_balances(store_id) WHERE kind = 'INITIAL';
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
  version: 8,
  name: 'computed_store_balance',
  disableForeignKeys: true,
  up(db) {
    const previous = db.prepare('SELECT seq FROM sqlite_sequence WHERE name = ?').get('store_balances');
    db.exec(SQL);
    restoreSequence(db, 'store_balances', previous);
  },
};

const INSERT_STORE_SQL = `
  INSERT INTO stores (
    name, currency, is_active, is_primary, sale_fee_type, sale_fee_rate, sale_fee_rounding,
    sale_min_fee_cents, sale_fixed_fee_cents, allows_withdrawal, withdrawal_fee_rate,
    withdrawal_fixed_fee_cents, created_at, updated_at
  ) VALUES (
    @name, @currency, 1, @isPrimary, @saleFeeType, @saleFeeRate, @saleFeeRounding,
    NULL, @saleFixedFeeCents, @allowsWithdrawal, @withdrawalFeeRate,
    @withdrawalFixedFeeCents, @now, @now
  )`;

const DEFAULT_STORES = [
  { name: 'CSFloat', currency: 'USD', isPrimary: 1, saleFeeType: 'DEDUCTED', saleFeeRate: 0.02, saleFeeRounding: 'CEIL', saleFixedFeeCents: 0, allowsWithdrawal: 1, withdrawalFeeRate: 0.025, withdrawalFixedFeeCents: 0 },
  { name: 'Steam', currency: 'BRL', isPrimary: 0, saleFeeType: 'ADDED', saleFeeRate: 0.15, saleFeeRounding: 'CEIL', saleFixedFeeCents: 0, allowsWithdrawal: 0, withdrawalFeeRate: null, withdrawalFixedFeeCents: 0 },
  { name: 'CSMoney', currency: 'USD', isPrimary: 0, saleFeeType: null, saleFeeRate: null, saleFeeRounding: 'CEIL', saleFixedFeeCents: 0, allowsWithdrawal: 1, withdrawalFeeRate: null, withdrawalFixedFeeCents: 0 },
];

// T5: as lojas iniciais só nascem uma vez (`stores_seeded`); excluir todas não as recria (D143).
function runSeed(db, now = new Date()) {
  const nowIso = now.toISOString();
  db.transaction(() => {
    db.prepare(
      'INSERT OR IGNORE INTO settings (id, usd_brl_rate, usd_brl_rate_updated_at, updated_at) VALUES (1, NULL, NULL, ?)'
    ).run(nowIso);
    // Esquema anterior à v4 (só ocorre com listas de migração truncadas, em testes): sem a marca, usa "tabela vazia".
    const hasFlag = db.prepare("SELECT 1 FROM pragma_table_info('settings') WHERE name = 'stores_seeded'").get();
    const seeded = hasFlag
      ? db.prepare('SELECT stores_seeded FROM settings WHERE id = 1').get().stores_seeded
      : Number(db.prepare('SELECT COUNT(*) AS total FROM stores').get().total > 0);
    if (seeded === 0) {
      const insert = db.prepare(INSERT_STORE_SQL);
      for (const store of DEFAULT_STORES) insert.run({ ...store, now: nowIso });
      if (hasFlag) db.prepare('UPDATE settings SET stores_seeded = 1 WHERE id = 1').run();
    }
  })();
}

module.exports = { runSeed };

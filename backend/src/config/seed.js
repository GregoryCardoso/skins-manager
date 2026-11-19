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

function runSeed(db, now = new Date()) {
  const nowIso = now.toISOString();
  db.transaction(() => {
    const { total } = db.prepare('SELECT COUNT(*) AS total FROM stores').get();
    if (total === 0) {
      const insert = db.prepare(INSERT_STORE_SQL);
      for (const store of DEFAULT_STORES) insert.run({ ...store, now: nowIso });
    }
    db.prepare(
      'INSERT OR IGNORE INTO settings (id, usd_brl_rate, usd_brl_rate_updated_at, updated_at) VALUES (1, NULL, NULL, ?)'
    ).run(nowIso);
  })();
}

module.exports = { runSeed };

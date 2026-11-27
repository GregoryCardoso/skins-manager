// Retenção do saldo (D213): a coluna nasce na v6; em listas de migração truncadas (testes) ela não existe.
const insertStoreSql = (withHold) => `
  INSERT INTO stores (
    name, currency, is_active, is_primary, sale_fee_type, sale_fee_rate, sale_fee_rounding,
    sale_min_fee_cents, sale_fixed_fee_cents, allows_withdrawal, withdrawal_fee_rate,
    withdrawal_fixed_fee_cents, ${withHold ? 'sale_hold_days, ' : ''}created_at, updated_at
  ) VALUES (
    @name, @currency, 1, @isPrimary, @saleFeeType, @saleFeeRate, @saleFeeRounding,
    NULL, @saleFixedFeeCents, @allowsWithdrawal, @withdrawalFeeRate,
    @withdrawalFixedFeeCents, ${withHold ? '@saleHoldDays, ' : ''}@now, @now
  )`;

const DEFAULT_STORES = [
  { name: 'CSFloat', currency: 'USD', isPrimary: 1, saleFeeType: 'DEDUCTED', saleFeeRate: 0.02, saleFeeRounding: 'CEIL', saleFixedFeeCents: 0, allowsWithdrawal: 1, withdrawalFeeRate: 0.025, withdrawalFixedFeeCents: 0, saleHoldDays: 7, sellsHere: 1 },
  { name: 'Steam', currency: 'BRL', isPrimary: 0, saleFeeType: 'ADDED', saleFeeRate: 0.15, saleFeeRounding: 'CEIL', saleFixedFeeCents: 0, allowsWithdrawal: 0, withdrawalFeeRate: null, withdrawalFixedFeeCents: 0, saleHoldDays: 0, sellsHere: 0 },
  { name: 'CSMoney', currency: 'USD', isPrimary: 0, saleFeeType: null, saleFeeRate: null, saleFeeRounding: 'CEIL', saleFixedFeeCents: 0, allowsWithdrawal: 1, withdrawalFeeRate: null, withdrawalFixedFeeCents: 0, saleHoldDays: 7, sellsHere: 0 },
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
      const withHold = db.prepare("SELECT 1 FROM pragma_table_info('stores') WHERE name = 'sale_hold_days'").get() !== undefined;
      const insert = db.prepare(insertStoreSql(withHold));
      // A Steam nasce na moeda de conversão inicial da instalação (D369 A4): USD num banco novo. Esquemas anteriores à v024 (só em
      // testes, com listas de migração truncadas) não têm a coluna e mantêm a Steam em BRL, como antes.
      const hasDisplayCurrency = db.prepare("SELECT 1 FROM pragma_table_info('settings') WHERE name = 'display_currency'").get() !== undefined;
      const steamCurrency = hasDisplayCurrency ? db.prepare('SELECT display_currency FROM settings WHERE id = 1').get().display_currency : 'BRL';
      // "Vendo nesta loja" (v028): numa instalação nova só a CSFloat vem ligada; Steam e CSMoney vêm desligadas e quem vende nelas
      // liga (decisão do usuário, 12.12). Instalações existentes não mudam (a v028 ligou todas). Esquemas antes da v028 (testes) não
      // têm a coluna.
      const hasSellsHere = db.prepare("SELECT 1 FROM pragma_table_info('stores') WHERE name = 'sells_here'").get() !== undefined;
      const setSellsHere = hasSellsHere ? db.prepare('UPDATE stores SET sells_here = ? WHERE id = ?') : null;
      for (const { saleHoldDays, sellsHere, ...store } of DEFAULT_STORES) {
        const currency = store.name === 'Steam' ? steamCurrency : store.currency;
        const { lastInsertRowid } = insert.run({ ...store, currency, ...(withHold ? { saleHoldDays } : {}), now: nowIso });
        if (setSellsHere) setSellsHere.run(sellsHere, lastInsertRowid);
      }
      if (hasFlag) db.prepare('UPDATE settings SET stores_seeded = 1 WHERE id = 1').run();
      // Banco novo: a v020 rodou antes das lojas existirem; aplica aqui a mesma regra dela (exatamente uma loja "steam"; a moeda é a da
      // instalação, D369 A4).
      const hasSteamColumn = db.prepare("SELECT 1 FROM pragma_table_info('settings') WHERE name = 'steam_store_id'").get() !== undefined;
      if (hasSteamColumn) {
        const current = db.prepare('SELECT steam_store_id FROM settings WHERE id = 1').get();
        if (current && current.steam_store_id === null) {
          const candidates = db.prepare("SELECT id FROM stores WHERE lower(trim(name)) = 'steam' ORDER BY id ASC").all();
          if (candidates.length === 1) db.prepare('UPDATE settings SET steam_store_id = ? WHERE id = 1').run(candidates[0].id);
        }
      }
    }
    // Integração CSFloat (D316): a linha nasce aqui (a migração v12 só cria a tabela). Só existe com o esquema >= v12.
    const hasIntegrations = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'integrations'").get() !== undefined;
    if (hasIntegrations) {
      db.prepare(
        `INSERT OR IGNORE INTO integrations (source, store_id, created_at, updated_at)
         VALUES ('CSFLOAT',
                 (SELECT id FROM stores WHERE name = 'CSFloat' COLLATE NOCASE AND currency = 'USD' ORDER BY id LIMIT 1),
                 @now, @now)`
      ).run({ now: nowIso });
    }
  })();
}

module.exports = { runSeed };

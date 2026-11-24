const { getDb } = require('../config/database');
const { mapRow, updateRow } = require('./modelHelpers');

const FIELDS = ['usdBrlRate', 'usdBrlRateUpdatedAt', 'usdBrlRateSource', 'rateQuotedAt', 'fxRefreshSource', 'catalogUpdatedAt', 'theme', 'language', 'inventoryView',
  'fastTurnoverDays', 'slowItemDays', 'steamStoreId'];

// Só as colunas do contrato (sem `id`, linha única).
function get() {
  return mapRow(
    getDb()
      .prepare(
        `SELECT usd_brl_rate, usd_brl_rate_updated_at, usd_brl_rate_source, rate_quoted_at, fx_refresh_source, catalog_updated_at,
                theme, language, inventory_view, fast_turnover_days, slow_item_days, steam_store_id, updated_at
         FROM settings WHERE id = 1`
      )
      .get()
  );
}

function update(partial = {}, { now = new Date() } = {}) {
  updateRow(getDb(), 'settings', 1, partial, FIELDS, { updated_at: now.toISOString() });
  return get();
}

module.exports = { get, update };

const { getDb } = require('../config/database');
const { mapRow, updateRow } = require('./modelHelpers');

const FIELDS = ['usdBrlRate', 'usdBrlRateUpdatedAt', 'usdBrlRateSource', 'rateQuotedAt', 'fxRefreshSource', 'catalogUpdatedAt', 'theme', 'language', 'inventoryView',
  'fastTurnoverDays', 'slowItemDays', 'steamStoreId'];
// Estado da atualização de preços (D364): fora de `get()`/`update()` de propósito, para não aparecer na API de configurações.
const PRICE_REFRESH_FIELDS = ['priceRefreshStartedAt', 'priceRefreshLastAt', 'priceRefreshLastStatus', 'priceRefreshLastErrorCode'];

// Só as colunas do contrato (sem `id`, linha única).
function get() {
  return mapRow(
    getDb()
      .prepare(
        `SELECT usd_brl_rate, usd_brl_rate_updated_at, usd_brl_rate_source, rate_quoted_at, fx_refresh_source, catalog_updated_at,
                theme, language, inventory_view, fast_turnover_days, slow_item_days, steam_store_id,
                updated_at
         FROM settings WHERE id = 1`
      )
      .get()
  );
}

function update(partial = {}, { now = new Date() } = {}) {
  updateRow(getDb(), 'settings', 1, partial, FIELDS, { updated_at: now.toISOString() });
  return get();
}

function getPriceRefresh() {
  return mapRow(
    getDb()
      .prepare(
        `SELECT price_refresh_started_at, price_refresh_last_at, price_refresh_last_status, price_refresh_last_error_code
         FROM settings WHERE id = 1`
      )
      .get()
  );
}

// Não mexe em `updated_at` (não é uma configuração do usuário).
function updatePriceRefresh(partial = {}) {
  updateRow(getDb(), 'settings', 1, partial, PRICE_REFRESH_FIELDS);
  return getPriceRefresh();
}

module.exports = { get, update, getPriceRefresh, updatePriceRefresh };

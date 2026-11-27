const { getDb } = require('../config/database');
const { mapRow, updateRow } = require('./modelHelpers');
const FxRate = require('./FxRate');

// Colunas reais de `settings`. A cotação do BRL (`usdBrlRate`, `usdBrlRateUpdatedAt`, `usdBrlRateSource`, `rateQuotedAt`,
// `fxRefreshSource`) vive em `fx_rates` desde a v024 (D369) e continua aparecendo aqui, derivada da linha do BRL (compatibilidade
// até o fim da 11.3); as colunas antigas de `settings` ficam sem uso.
const FIELDS = ['catalogUpdatedAt', 'theme', 'language', 'inventoryView', 'inventoryDensity', 'fastTurnoverDays', 'slowItemDays', 'steamStoreId', 'displayCurrency'];
const BRL_FIELDS = ['usdBrlRate', 'usdBrlRateUpdatedAt', 'usdBrlRateSource', 'rateQuotedAt', 'fxRefreshSource'];
// Estado da atualização de preços (D364): fora de `get()`/`update()` de propósito, para não aparecer na API de configurações.
const PRICE_REFRESH_FIELDS = ['priceRefreshStartedAt', 'priceRefreshLastAt', 'priceRefreshLastStatus', 'priceRefreshLastErrorCode'];

// Só as colunas do contrato (sem `id`, linha única).
function get() {
  const row = mapRow(
    getDb()
      .prepare(
        `SELECT catalog_updated_at, theme, language, inventory_view, inventory_density, fast_turnover_days, slow_item_days, steam_store_id, display_currency,
                updated_at
         FROM settings WHERE id = 1`
      )
      .get()
  );
  if (row === null) return null;
  const rows = FxRate.findAll();
  const brl = rows.find((r) => r.currency === 'BRL') ?? null;
  // `rates`: moeda -> cotação (só as que têm valor). Os services convertem por aqui.
  const rates = {};
  for (const r of rows) if (r.rate !== null) rates[r.currency] = r.rate;
  return {
    usdBrlRate: brl ? brl.rate : null,
    usdBrlRateUpdatedAt: brl && brl.rate !== null ? brl.updatedAt : null,
    usdBrlRateSource: brl ? brl.source : null,
    rateQuotedAt: brl ? brl.quotedAt : null,
    fxRefreshSource: brl ? brl.refreshSource : 'AWESOMEAPI',
    ...row,
    rates,
  };
}

// Grava as preferências (colunas de `settings`) e, se vierem, os campos da cotação do BRL (linha do BRL em `fx_rates`).
function update(partial = {}, { now = new Date() } = {}) {
  const own = {};
  const brl = {};
  for (const [key, value] of Object.entries(partial)) {
    if (BRL_FIELDS.includes(key)) brl[key] = value;
    else own[key] = value;
  }
  updateRow(getDb(), 'settings', 1, own, FIELDS, { updated_at: now.toISOString() });
  const brlPartial = {};
  if (brl.usdBrlRate !== undefined) brlPartial.rate = brl.usdBrlRate;
  if (brl.usdBrlRateSource !== undefined) brlPartial.source = brl.usdBrlRateSource;
  if (brl.rateQuotedAt !== undefined) brlPartial.quotedAt = brl.rateQuotedAt;
  if (brl.usdBrlRateUpdatedAt !== undefined) brlPartial.updatedAt = brl.usdBrlRateUpdatedAt;
  if (brl.fxRefreshSource !== undefined) brlPartial.refreshSource = brl.fxRefreshSource;
  if (Object.keys(brlPartial).length > 0) FxRate.upsert('BRL', brlPartial, { now });
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

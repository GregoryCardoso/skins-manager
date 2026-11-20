const { getDb } = require('../config/database');
const { mapRow, updateRow } = require('./modelHelpers');

const FIELDS = ['usdBrlRate', 'usdBrlRateUpdatedAt'];

// Só as colunas do contrato (sem `id`, linha única).
function get() {
  return mapRow(
    getDb()
      .prepare('SELECT usd_brl_rate, usd_brl_rate_updated_at, updated_at FROM settings WHERE id = 1')
      .get()
  );
}

function update(partial = {}, { now = new Date() } = {}) {
  updateRow(getDb(), 'settings', 1, partial, FIELDS, { updated_at: now.toISOString() });
  return get();
}

module.exports = { get, update };

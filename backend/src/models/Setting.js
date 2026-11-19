const { getDb } = require('../config/database');
const { mapRow, updateRow } = require('./modelHelpers');

const FIELDS = ['usdBrlRate', 'usdBrlRateUpdatedAt'];

function get() {
  return mapRow(getDb().prepare('SELECT * FROM settings WHERE id = 1').get());
}

function update(partial = {}) {
  updateRow(getDb(), 'settings', 1, partial, FIELDS, { updated_at: new Date().toISOString() });
  return get();
}

module.exports = { get, update };

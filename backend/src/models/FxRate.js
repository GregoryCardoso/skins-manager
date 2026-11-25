const { getDb } = require('../config/database');
const { mapRow } = require('./modelHelpers');

// Cotações por moeda (D369, v024): "unidades da moeda por 1 US$". Só SQL, sem regra de negócio.
const FIELDS = ['rate', 'source', 'refreshSource', 'quotedAt', 'updatedAt'];
const COLUMN = { rate: 'rate', source: 'source', refreshSource: 'refresh_source', quotedAt: 'quoted_at', updatedAt: 'updated_at' };

function findAll() {
  return getDb()
    .prepare('SELECT currency, rate, source, refresh_source, quoted_at, updated_at FROM fx_rates ORDER BY currency ASC')
    .all()
    .map((row) => mapRow(row));
}

function find(currency) {
  return mapRow(
    getDb().prepare('SELECT currency, rate, source, refresh_source, quoted_at, updated_at FROM fx_rates WHERE currency = ?').get(currency)
  );
}

// Cria a linha (rate e source nulos, fonte do botão AWESOMEAPI) se ainda não existir e grava só os campos informados.
// `updatedAt` só é obrigatório na criação (a coluna é NOT NULL): o chamador passa `now`.
function upsert(currency, partial = {}, { now = new Date() } = {}) {
  const db = getDb();
  const exists = db.prepare('SELECT 1 FROM fx_rates WHERE currency = ?').get(currency) !== undefined;
  const stamp = now.toISOString();
  if (!exists) {
    db.prepare('INSERT INTO fx_rates (currency, rate, source, refresh_source, quoted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      currency,
      partial.rate ?? null,
      partial.source ?? null,
      partial.refreshSource ?? 'AWESOMEAPI',
      partial.quotedAt ?? null,
      partial.updatedAt ?? stamp
    );
    return find(currency);
  }
  const keys = FIELDS.filter((field) => partial[field] !== undefined);
  if (keys.length > 0) {
    db.prepare(`UPDATE fx_rates SET ${keys.map((k) => `${COLUMN[k]} = ?`).join(', ')} WHERE currency = ?`).run(
      ...keys.map((k) => partial[k]),
      currency
    );
  }
  return find(currency);
}

module.exports = { findAll, find, upsert };

'use strict';

// Acesso à tabela `market_prices` (D364): cache de preço por item de mercado. Só SQL, sem regra de negócio.
const { getDb } = require('../config/database');
const { mapRow } = require('./modelHelpers');

const CHUNK = 500;
const toPrice = (row) => mapRow(row);

// Linhas da fonte para as chaves informadas: Map priceKey -> linha.
function findByKeys(source, keys) {
  const out = new Map();
  const unique = [...new Set(keys)];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const rows = getDb()
      .prepare(`SELECT * FROM market_prices WHERE source = ? AND price_key IN (${chunk.map(() => '?').join(',')})`)
      .all(source, ...chunk);
    for (const row of rows) out.set(row.price_key, toPrice(row));
  }
  return out;
}

function listBySource(source) {
  return getDb().prepare('SELECT * FROM market_prices WHERE source = ? ORDER BY id ASC').all(source).map(toPrice);
}

// Grava o resultado de uma tentativa. `row`: { source, priceKey, marketHashName, paintIndex, status, basePriceCents, referenceQuantity,
// sourceUpdatedAt }. Num NOT_FOUND mantém o último preço OK (`base_price_cents`/`priced_at`) e só atualiza `status`/`fetched_at`.
function upsertResult(row, now = new Date()) {
  const stamp = now.toISOString();
  const db = getDb();
  const current = db.prepare('SELECT id FROM market_prices WHERE source = ? AND price_key = ?').get(row.source, row.priceKey);
  if (!current) {
    const ok = row.status === 'OK';
    db.prepare(
      `INSERT INTO market_prices (source, price_key, market_hash_name, paint_index, currency, status, base_price_cents, reference_quantity,
         source_updated_at, priced_at, fetched_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.source, row.priceKey, row.marketHashName, row.paintIndex ?? null, row.status, ok ? row.basePriceCents : null,
      ok ? row.referenceQuantity ?? null : null, ok ? row.sourceUpdatedAt ?? null : null, ok ? stamp : null, stamp, stamp, stamp
    );
    return;
  }
  if (row.status === 'OK') {
    db.prepare(
      `UPDATE market_prices SET status = 'OK', base_price_cents = ?, reference_quantity = ?, source_updated_at = ?, priced_at = ?,
         fetched_at = ?, updated_at = ? WHERE id = ?`
    ).run(row.basePriceCents, row.referenceQuantity ?? null, row.sourceUpdatedAt ?? null, stamp, stamp, stamp, current.id);
  } else {
    db.prepare("UPDATE market_prices SET status = 'NOT_FOUND', fetched_at = ?, updated_at = ? WHERE id = ?").run(stamp, stamp, current.id);
  }
}

function maxFetchedAt(source) {
  const row = getDb().prepare('SELECT MAX(fetched_at) AS at FROM market_prices WHERE source = ?').get(source);
  return row ? row.at : null;
}

function maxPricedAt(source) {
  const row = getDb().prepare('SELECT MAX(priced_at) AS at FROM market_prices WHERE source = ?').get(source);
  return row ? row.at : null;
}

module.exports = { findByKeys, listBySource, upsertResult, maxFetchedAt, maxPricedAt };

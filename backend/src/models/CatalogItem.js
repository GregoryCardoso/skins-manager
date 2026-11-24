const { getDb } = require('../config/database');
const { mapRow } = require('./modelHelpers');

const BOOLEAN_FIELDS = ['hasStattrak', 'hasSouvenir'];
const IDS_CHUNK = 500;

const UPSERT_SQL = `
  INSERT INTO catalog_items (
    id, source, category, name, name_pt_br, name_key, search_text, image_url, min_float, max_float,
    has_stattrak, has_souvenir, phase, rarity, updated_at
  ) VALUES (
    @id, @source, @category, @name, @namePtBr, @nameKey, @searchText, @imageUrl, @minFloat, @maxFloat,
    @hasStattrak, @hasSouvenir, @phase, @rarity, @updatedAt
  )
  ON CONFLICT(id) DO UPDATE SET
    source = excluded.source, category = excluded.category, name = excluded.name,
    name_pt_br = excluded.name_pt_br, name_key = excluded.name_key, search_text = excluded.search_text,
    image_url = excluded.image_url, min_float = excluded.min_float, max_float = excluded.max_float,
    has_stattrak = excluded.has_stattrak, has_souvenir = excluded.has_souvenir, phase = excluded.phase,
    rarity = excluded.rarity, updated_at = excluded.updated_at`;

const mapItem = (row) => mapRow(row, BOOLEAN_FIELDS);

const bit = (v) => (v === true || v === 1 ? 1 : 0);

// Recebe linhas camelCase com `nameKey` e `searchText` já calculados (o model não calcula nada).
function upsertMany(rows, { now = new Date() } = {}) {
  const db = getDb();
  const stmt = db.prepare(UPSERT_SQL);
  const updatedAt = now.toISOString();
  db.transaction(() => {
    for (const row of rows) {
      stmt.run({
        id: row.id,
        source: row.source,
        category: row.category,
        name: row.name,
        namePtBr: row.namePtBr ?? null,
        nameKey: row.nameKey,
        searchText: row.searchText,
        imageUrl: row.imageUrl ?? null,
        minFloat: row.minFloat ?? null,
        maxFloat: row.maxFloat ?? null,
        hasStattrak: bit(row.hasStattrak),
        hasSouvenir: bit(row.hasSouvenir),
        phase: row.phase ?? null,
        rarity: row.rarity ?? null,
        updatedAt,
      });
    }
  })();
  return rows.length;
}

function findById(id) {
  return mapItem(getDb().prepare('SELECT * FROM catalog_items WHERE id = ?').get(id));
}

function findByIds(ids) {
  const unique = [...new Set(ids)];
  const out = [];
  for (let i = 0; i < unique.length; i += IDS_CHUNK) {
    const chunk = unique.slice(i, i + IDS_CHUNK);
    const sql = `SELECT * FROM catalog_items WHERE id IN (${chunk.map(() => '?').join(',')})`;
    for (const row of getDb().prepare(sql).all(...chunk)) out.push(mapItem(row));
  }
  return out;
}

function findByNameKey(nameKey, category) {
  return getDb()
    .prepare('SELECT * FROM catalog_items WHERE name_key = ? AND category = ? ORDER BY id')
    .all(nameKey, category)
    .map(mapItem);
}

// Todas as entradas de um nome normalizado, de qualquer categoria (importação: o tipo do trade não diz a categoria do app).
function findByNameKeyAnyCategory(nameKey) {
  return getDb().prepare('SELECT * FROM catalog_items WHERE name_key = ? ORDER BY id').all(nameKey).map(mapItem);
}

const LIKE_ESCAPE = '\\';
const escapeLike = (text) => text.replace(/[\\%_]/g, (c) => LIKE_ESCAPE + c);

// Cada token precisa aparecer em search_text (LIKE com ESCAPE, `%`, `_` e `\` literais).
// `dedupe` (D115): colapsa entradas funcionalmente idênticas (categoria, nome, fase, faixa de float, StatTrak/Souvenir);
// o representante tem imagem primeiro e depois o menor id. `total` conta grupos.
function search({ tokens, category, limit, dedupe = false }) {
  const conditions = tokens.map(() => `search_text LIKE ? ESCAPE '${LIKE_ESCAPE}'`);
  const params = tokens.map((t) => `%${escapeLike(t)}%`);
  if (category !== undefined) {
    conditions.push('category = ?');
    params.push(category);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const db = getDb();
  const first = tokens.length ? `${escapeLike(tokens[0])}%` : '%';
  const order = `ORDER BY (CASE WHEN name_key LIKE ? ESCAPE '${LIKE_ESCAPE}' THEN 0 ELSE 1 END), length(name), name, id`;

  if (!dedupe) {
    const total = db.prepare(`SELECT COUNT(*) AS n FROM catalog_items ${where}`).get(...params).n;
    const rows = db.prepare(`SELECT * FROM catalog_items ${where} ${order} LIMIT ?`).all(...params, first, limit).map(mapItem);
    return { rows, total };
  }

  const ranked = `
    WITH ranked AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY category, name_key, COALESCE(phase, ''), min_float, max_float, has_stattrak, has_souvenir
        ORDER BY (image_url IS NULL), id
      ) AS rn
      FROM catalog_items ${where}
    )`;
  const total = db.prepare(`${ranked} SELECT COUNT(*) AS n FROM ranked WHERE rn = 1`).get(...params).n;
  const rows = db
    .prepare(`${ranked} SELECT * FROM ranked WHERE rn = 1 ${order} LIMIT ?`)
    .all(...params, first, limit)
    .map(({ rn, ...row }) => mapItem(row));
  return { rows, total };
}

function countBySource() {
  const counts = { SKINS: 0, STICKERS: 0, CRATES: 0, KEYCHAINS: 0, AGENTS: 0, PATCHES: 0 };
  for (const row of getDb().prepare('SELECT source, COUNT(*) AS n FROM catalog_items GROUP BY source').all()) {
    counts[row.source] = row.n;
  }
  return counts;
}

module.exports = { upsertMany, findById, findByIds, findByNameKey, findByNameKeyAnyCategory, search, countBySource };

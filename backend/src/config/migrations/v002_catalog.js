'use strict';

// Migração 2: catálogo local, vínculo do item com o catálogo, preferências (tema/idioma) e T32 (D79).
// Só ADD COLUMN e CREATE (sem reconstruir tabelas). Migração publicada nunca é editada (D69).
const SQL = `
CREATE TABLE catalog_items (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 100),
  source TEXT NOT NULL CHECK (source IN ('SKINS','STICKERS','CRATES','KEYCHAINS','AGENTS')),
  category TEXT NOT NULL CHECK (category IN ('SKIN','FACA','LUVA','CAIXA','CAPSULA','STICKER','PINGENTE','PERSONAGEM','PASSE_BATALHA','OUTRO')),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  name_pt_br TEXT NULL,
  name_key TEXT NOT NULL,
  search_text TEXT NOT NULL,
  image_url TEXT NULL,
  min_float REAL NULL CHECK (min_float >= 0 AND min_float <= 1),
  max_float REAL NULL CHECK (max_float >= 0 AND max_float <= 1),
  has_stattrak INTEGER NOT NULL DEFAULT 0 CHECK (has_stattrak IN (0,1)),
  has_souvenir INTEGER NOT NULL DEFAULT 0 CHECK (has_souvenir IN (0,1)),
  phase TEXT NULL,
  rarity TEXT NULL,
  updated_at TEXT NOT NULL,
  CHECK (min_float IS NULL OR max_float IS NULL OR min_float <= max_float)
) STRICT;
CREATE INDEX idx_catalog_items_category_key ON catalog_items(category, name_key);
ALTER TABLE items ADD COLUMN catalog_id TEXT NULL;
CREATE INDEX idx_items_catalog_id ON items(catalog_id);
ALTER TABLE settings ADD COLUMN catalog_updated_at TEXT NULL;
ALTER TABLE settings ADD COLUMN theme TEXT NOT NULL DEFAULT 'SYSTEM' CHECK (theme IN ('SYSTEM','LIGHT','DARK'));
ALTER TABLE settings ADD COLUMN language TEXT NOT NULL DEFAULT 'pt-BR' CHECK (language IN ('pt-BR','en'));
UPDATE items SET purchase_price_cents = 0, purchase_currency = 'USD', fx_rate_at_purchase = NULL
 WHERE acquisition_type = 'GANHEI'
   AND (purchase_price_cents <> 0 OR purchase_currency <> 'USD' OR fx_rate_at_purchase IS NOT NULL);
`;

module.exports = {
  version: 2,
  name: 'catalog',
  up(db) {
    db.exec(SQL);
  },
};

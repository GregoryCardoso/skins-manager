'use strict';

// Migração 18 (D361, subetapa 10.2): o CS2 permite dois stickers no mesmo slot (posicionamento livre), então o índice único de
// slot da v017 sai; o lote de importação ganha as contagens de componentes preenchidos e não registrados. Só DROP INDEX e
// ADD COLUMN, sem reconstruir nenhuma tabela: itens, componentes, saldos e lucro real ficam idênticos. A v017 não é editada
// (migração publicada nunca é editada, D69).
const SQL = `
DROP INDEX IF EXISTS idx_item_components_slot;
ALTER TABLE import_batches ADD COLUMN components_filled_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN components_skipped_count INTEGER NOT NULL DEFAULT 0;
`;

module.exports = {
  version: 18,
  name: 'component_slots_and_batch_counts',
  up(db) {
    db.exec(SQL);
  },
};

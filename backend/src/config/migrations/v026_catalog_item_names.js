'use strict';

// Migração 26 (D369, subetapa 11.5): nomes dos itens do catálogo em vários idiomas, só para exibição.
// - Cria `catalog_item_names (catalog_id, language, name)`, uma linha por item e idioma (o idioma é o código do app: `pt-BR`, `es`, ...).
//   O nome em inglês continua em `catalog_items.name` (canônico, chaves, buscas internas, importação e valor de mercado).
// - Copia os nomes pt-BR que já existem (`catalog_items.name_pt_br`) para a tabela nova. A coluna antiga fica sem uso e sem reconstrução
//   (dado regenerável a partir do catálogo); nenhuma linha existente é alterada ou apagada.
// O `trim` do SQLite só tira espaços por padrão; a lista explícita cobre também tab e quebras de linha (achado do QA).
// Só CREATE e INSERT: o backup automático roda antes (`backupBeforeMigrating`). Migração publicada nunca é editada (D69).
const SQL = `
CREATE TABLE catalog_item_names (
  catalog_id TEXT NOT NULL REFERENCES catalog_items(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK (length(language) BETWEEN 2 AND 10),
  name TEXT NOT NULL CHECK (length(trim(name, ' ' || char(9, 10, 11, 12, 13))) > 0),
  PRIMARY KEY (catalog_id, language)
) STRICT;
INSERT INTO catalog_item_names (catalog_id, language, name)
  SELECT id, 'pt-BR', trim(name_pt_br, ' ' || char(9, 10, 11, 12, 13)) FROM catalog_items
  WHERE name_pt_br IS NOT NULL AND length(trim(name_pt_br, ' ' || char(9, 10, 11, 12, 13))) > 0;
`;

module.exports = {
  version: 26,
  name: 'catalog_item_names',
  up(db) {
    db.exec(SQL);
  },
};

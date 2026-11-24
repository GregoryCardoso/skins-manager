'use strict';

// Componentes (stickers, chaveiro, Sticker Slab) vindos do CSFloat (10.2, D361). Duas portas:
//   - `forPurchase`: compra criada pela importação, "Lançar compra", "Foi drop" e "Criar mesmo assim";
//   - `fillFromTrades`: a "Varredura completa" preenche, uma única vez, as compras já importadas.
// Componente nunca bloqueia nem falha uma importação: o que não casa com o catálogo vira aviso. Preencher não é edição: o
// `updated_at` do item e o `entityUpdatedAt` do vínculo ficam como estão (o desfazer do lote original não pede confirmação por isso).
const CatalogItem = require('../../models/CatalogItem');
const Item = require('../../models/Item');
const ItemComponent = require('../../models/ItemComponent');
const catalogService = require('../catalogService');
const itemComponentService = require('../itemComponentService');
const externalItemMapper = require('./externalItemMapper');

const findByNameKeyAnyCategory = (key) => CatalogItem.findByNameKeyAnyCategory(key);

// Componentes do trade (lista normalizada do mapper) -> { components, warnings } para um item da `category`.
function forPurchase(rawComponents, category) {
  return externalItemMapper.mapComponents(rawComponents, { category, findByNameKeyAnyCategory });
}

// Preenche os componentes das compras já importadas (varredura completa). `entries`: [{ trade, itemId }] (trades BUY relidos com
// vínculo CREATED de compra). Em lote: uma consulta de itens e uma de componentes. Devolve { filled, skipped }.
//   - item inexistente ou já marcado (`components_imported_at`): pula;
//   - item com qualquer componente (manual): só marca, nunca sobrescreve;
//   - senão grava os do CSFloat (com a categoria ATUAL do item no app) e marca, mesmo que a lista fique vazia.
function fillFromTrades(entries, { now }) {
  const result = { filled: 0, skipped: 0 };
  if (!entries.length) return result;
  const ids = entries.map((e) => e.itemId);
  const items = Item.findByIds(ids);
  const existing = ItemComponent.listByItemIds(ids);
  const stamp = now.toISOString();
  const done = new Set();
  for (const { trade, itemId } of entries) {
    const item = items.get(itemId);
    if (!item || item.componentsImportedAt || done.has(itemId)) continue;
    done.add(itemId);
    if ((existing.get(itemId) || []).length > 0) {
      Item.markComponentsImported(itemId, stamp);
      continue;
    }
    const mapped = forPurchase(trade.item.components, item.category);
    result.skipped += mapped.warnings.length;
    const rows = itemComponentService.normalizeComponents(mapped.components, {
      category: item.category, source: 'CSFLOAT', findCatalogById: (id) => catalogService.getCatalogItem(id),
    });
    if (rows.length) {
      ItemComponent.insertMany(itemId, rows, { now });
      result.filled += 1;
    }
    Item.markComponentsImported(itemId, stamp);
  }
  return result;
}

module.exports = { forPurchase, fillFromTrades };

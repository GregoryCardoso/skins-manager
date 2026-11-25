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
const { resolveSourceKinds, SOURCE_CATEGORIES } = require('../operations/componentApplicationService');
const externalItemMapper = require('./externalItemMapper');
const { MAYBE_APPLIED_WARNING } = require('./entryActions');

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

const MAX_STOCK_WARNINGS = 10;

// Avisos "componente possivelmente aplicado do estoque" (D362 item 9, E-P2-Q30): o trade vendido trouxe um componente que a unidade
// vendida não tem no app, e há no estoque uma unidade aplicável do mesmo item do catálogo (adquirida até a data da venda). Nunca é
// automático: só o aviso, que oferece "Aplicar e registrar". Devolve [{ code, name, candidateItemId }] (no máximo 10).
function maybeAppliedFromStock(rawComponents, item) {
  if (!Array.isArray(rawComponents) || rawComponents.length === 0 || !item || itemComponentService.allowedKindsFor(item.category).length === 0) return [];
  const { components } = forPurchase(rawComponents, item.category);
  if (components.length === 0) return [];
  const have = ItemComponent.listByItemIds([item.id]).get(item.id) ?? [];
  const taken = new Map();
  for (const row of have) taken.set(`${row.kind}|${row.catalogId}`, (taken.get(`${row.kind}|${row.catalogId}`) ?? 0) + 1);
  const missing = [];
  for (const component of components) {
    const key = `${component.kind}|${component.catalogId}`;
    if ((taken.get(key) ?? 0) > 0) taken.set(key, taken.get(key) - 1);
    else missing.push(component);
  }
  if (missing.length === 0) return [];
  const soldMs = item.soldAt ? Date.parse(item.soldAt) : Infinity;
  const pool = Item.findInStockByCategories(SOURCE_CATEGORIES).filter((unit) => unit.id !== item.id && Date.parse(unit.acquiredAt) <= soldMs);
  const byKey = new Map();
  const resolvedUnits = resolveSourceKinds(pool); // em lote, sem uma consulta de catálogo por unidade (S1)
  for (const unit of pool) {
    const resolved = resolvedUnits.get(unit.id);
    if (!resolved) continue;
    const key = `${resolved.kind}|${resolved.entry.id}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(unit);
  }
  const remaining = itemComponentService.remainingFor(have);
  const bucketOf = (kind) => (kind === 'STICKER' ? 'stickers' : kind === 'PATCH' ? 'patches' : 'hanging');
  const warnings = [];
  const used = new Set();
  for (const component of missing) {
    if (warnings.length >= MAX_STOCK_WARNINGS) break;
    const bucket = bucketOf(component.kind);
    if (remaining[bucket] <= 0) continue;
    const unit = (byKey.get(`${component.kind}|${component.catalogId}`) ?? []).find((u) => !used.has(u.id));
    if (!unit) continue;
    used.add(unit.id);
    remaining[bucket] -= 1;
    warnings.push({ code: MAYBE_APPLIED_WARNING, name: unit.name, candidateItemId: unit.id });
  }
  return warnings;
}

module.exports = { forPurchase, fillFromTrades, maybeAppliedFromStock };

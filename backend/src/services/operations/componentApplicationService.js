'use strict';

// "Aplicar do estoque" (D355, D356, D362 itens 4 e 5): consome uma unidade de sticker, chaveiro, Sticker Slab ou patch do estoque e a
// grava como componente de uma arma (ou de um agente, no caso do patch). O custo da unidade consumida passa para o alvo (custo
// efetivo, calculado: nenhum `purchase_price` muda). Não é venda: não mexe em saldo, lucro real (salvo a aplicação retroativa em arma
// já vendida, E-P2-Q47), giro nem itemStats da arma. Também "Remover para sempre" (SCRAPE_OFF) de sticker e patch aplicados.
const Item = require('../../models/Item');
const ItemComponent = require('../../models/ItemComponent');
const ItemOperation = require('../../models/ItemOperation');
const { runInTransaction } = require('../../models/modelHelpers');
const { AppError, ValidationError, NotFoundError, ConflictError } = require('../../errors/AppError');
const catalogService = require('../catalogService');
const { normalizeSearchText } = require('../catalog/csgoApiAdapter');
const itemComponentService = require('../itemComponentService');
const { parseDate } = require('../dateUtils');
const { isInTradeLock, isOffSale } = require('../inventoryAgingService');
const { assertDate } = require('./operationDates');
const operationContext = require('./operationContext');

const SOURCE_CATEGORIES = Object.freeze(['STICKER', 'PINGENTE', 'PATCH', 'OUTRO']);
const KIND_BY_CATEGORY = Object.freeze({ STICKER: 'STICKER', PINGENTE: 'CHARM', PATCH: 'PATCH' });
const SLAB_PREFIX = 'Sticker Slab | ';
const isNil = (v) => v === null || v === undefined;

const unprocessable = (code, message, extra) => new AppError(422, code, message, extra);
// Tipo de componente que a unidade vira ao ser aplicada, e a entrada do catálogo do componente; ou null se não serve (sem catálogo,
// outra categoria, patch ou slab sem casamento). O slab é uma unidade `OUTRO` "Sticker Slab | X" com o sticker "Sticker | X" no catálogo.
function resolveSourceKind(item, { getCatalogItem = (id) => catalogService.getCatalogItem(id), findExactMatch = (q) => catalogService.findExactMatch(q) } = {}) {
  if (KIND_BY_CATEGORY[item.category]) {
    if (isNil(item.catalogId)) return null;
    const entry = getCatalogItem(item.catalogId);
    if (!entry || entry.category !== item.category) return null;
    return { kind: KIND_BY_CATEGORY[item.category], entry };
  }
  if (item.category === 'OUTRO' && typeof item.name === 'string' && item.name.startsWith(SLAB_PREFIX)) {
    const entry = findExactMatch({ name: `Sticker | ${item.name.slice(SLAB_PREFIX.length)}`, category: 'STICKER' });
    return entry ? { kind: 'STICKER_SLAB', entry } : null;
  }
  return null;
}

// Em lote (S1): Map id da unidade -> { kind, entry } só das que servem como componente; uma consulta de catálogo por id e uma por nome de
// Sticker Slab, em vez de uma por unidade. Mesma regra de `resolveSourceKind`.
function resolveSourceKinds(units) {
  const entries = new Map(catalogService.getCatalogItemsByIds(units.map((u) => u.catalogId).filter((id) => !isNil(id))).map((c) => [c.id, c]));
  const slabs = units.filter((u) => !KIND_BY_CATEGORY[u.category] && u.category === 'OUTRO' && typeof u.name === 'string' && u.name.startsWith(SLAB_PREFIX));
  const stickerByName = slabs.length ? catalogService.findExactMatches(slabs.map((u) => `Sticker | ${u.name.slice(SLAB_PREFIX.length)}`), 'STICKER') : new Map();
  const out = new Map();
  for (const unit of units) {
    const resolved = resolveSourceKind(unit, {
      getCatalogItem: (id) => entries.get(id) ?? null,
      findExactMatch: ({ name }) => stickerByName.get(normalizeSearchText(name)) ?? null,
    });
    if (resolved) out.set(unit.id, resolved);
  }
  return out;
}

function findOrFail(id, role) {
  const item = Item.findById(id);
  if (!item) throw new NotFoundError('Item não encontrado.', 'ITEM_NOT_FOUND', { params: { itemId: id, role } });
  return item;
}

function notInStock(item, role) {
  return new ConflictError('O item não está em estoque.', 'ITEM_NOT_IN_STOCK', { params: { itemId: item.id, role, status: item.status } });
}

// Alvo: em estoque (ou vendido, só na aplicação retroativa da importação); consumido nunca.
function assertTargetStatus(target, { allowSoldTarget }) {
  if (target.status === 'CONSUMIDO') throw new ConflictError('Esta unidade foi consumida: desfaça a aplicação antes.', 'ITEM_CONSUMED', { params: { itemId: target.id } });
  if (target.status === 'EM_ESTOQUE') return;
  if (!(allowSoldTarget && target.status === 'VENDIDO')) throw notInStock(target, 'TARGET');
}

// `input`: { targetId, sourceItemId, slot?, wear?, pattern?, appliedAt? }. `ctx.allowSoldTarget`: opção INTERNA da ação "Aplicar e
// registrar" da importação (E-P2-Q47); nunca vem do corpo da API nem do botão comum. Devolve { operation, target, source }.
function applyFromStock(input, ctx = {}) {
  const { now = new Date(), allowSoldTarget = false } = ctx;
  return runInTransaction(() => {
    const target = findOrFail(input.targetId, 'TARGET');
    const source = findOrFail(input.sourceItemId, 'SOURCE');
    if (source.id === target.id) {
      throw unprocessable('APPLY_SOURCE_NOT_APPLICABLE', 'A unidade não pode ser aplicada nela mesma.', { field: 'sourceItemId', params: { reason: 'SAME_ITEM' } });
    }
    assertTargetStatus(target, { allowSoldTarget });
    if (source.status !== 'EM_ESTOQUE') throw notInStock(source, 'SOURCE');
    const resolved = resolveSourceKind(source);
    if (!resolved) {
      throw unprocessable('APPLY_SOURCE_NOT_APPLICABLE', 'Esta unidade não pode ser aplicada como componente.', { field: 'sourceItemId', params: { reason: 'NOT_A_COMPONENT' } });
    }
    const { kind, entry } = resolved;
    if (!itemComponentService.allowedKindsFor(target.category).includes(kind)) {
      throw new ValidationError('Este item não aceita este tipo de componente.', 'COMPONENTS_NOT_ALLOWED', {
        field: 'components', params: { index: 0, category: target.category },
      });
    }
    const slot = isNil(input.slot) ? null : input.slot;
    const wear = isNil(input.wear) ? null : input.wear;
    const pattern = isNil(input.pattern) ? null : input.pattern;
    itemComponentService.checkNumbers(kind, { slot, wear, pattern }, 0);
    const existing = ItemComponent.listByItemIds([target.id]).get(target.id) ?? [];
    itemComponentService.assertLimits([...existing, { kind }]);

    const appliedAt = isNil(input.appliedAt) ? now : parseDate(input.appliedAt, 'Data da aplicação', { field: 'appliedAt' });
    assertDate(appliedAt, {
      now,
      lowerBounds: [{ reason: 'BEFORE_TARGET_ACQUIRED', at: target.acquiredAt }, { reason: 'BEFORE_SOURCE_ACQUIRED', at: source.acquiredAt }],
      soldAt: target.status === 'VENDIDO' ? target.soldAt : null,
    });
    const stamp = appliedAt.toISOString();

    const operation = ItemOperation.createOperation({ kind: 'APPLY_COMPONENT', outcome: 'TRANSFERRED', occurredAt: stamp }, { now });
    ItemOperation.createLink({ operationId: operation.id, itemId: source.id, role: 'CONSUMED', costShareBp: null });
    ItemOperation.createLink({ operationId: operation.id, itemId: target.id, role: 'TARGET', costShareBp: null });
    ItemComponent.insertOne(
      target.id,
      {
        kind, catalogId: entry.id, name: itemComponentService.buildName(kind, entry.name), slot, wear, pattern, purchaseReferenceCents: null,
        source: 'MANUAL', origin: 'APPLIED_FROM_STOCK', sourceItemId: source.id, operationId: operation.id,
      },
      { now }
    );
    // `off_sale_at`, `for_sale_since` e `trade_unlock_at` ficam como estão: o desfazer devolve a unidade como estava.
    Item.update(source.id, { status: 'CONSUMIDO', consumedAt: stamp }, { now });
    Item.update(target.id, {}, { now }); // renova o `updated_at` (o desfazer da importação passa a avisar ITEM_EDITED)
    return { operation, target: Item.findById(target.id), source: Item.findById(source.id) };
  });
}

// "Remover para sempre" (SCRAPE_OFF): só sticker e patch aplicados do estoque. O componente sai da arma e o custo continua nela
// (custo afundado, E-P2-Q27): o custo herdado vem dos vínculos da aplicação, que seguem ativos.
function scrapeOff({ targetId, componentId, occurredAt = null }, ctx = {}) {
  const { now = new Date() } = ctx;
  return runInTransaction(() => {
    const target = findOrFail(targetId, 'TARGET');
    if (target.status === 'CONSUMIDO') throw new ConflictError('Esta unidade foi consumida: desfaça a aplicação antes.', 'ITEM_CONSUMED', { params: { itemId: target.id } });
    if (target.status !== 'EM_ESTOQUE') throw notInStock(target, 'TARGET');
    const component = ItemComponent.findById(componentId);
    if (!component || component.itemId !== target.id) throw new NotFoundError('Componente não encontrado.', 'COMPONENT_NOT_FOUND', { params: { componentId } });
    if (component.origin !== 'APPLIED_FROM_STOCK' || itemComponentService.isDetachable(component.kind)) {
      throw new ConflictError('Este componente não pode ser removido para sempre.', 'COMPONENT_NOT_SCRAPEABLE', { params: { componentId, kind: component.kind } });
    }
    const applyOp = ItemOperation.findById(component.operationId);
    const date = isNil(occurredAt) ? now : parseDate(occurredAt, 'Data da remoção', { field: 'occurredAt' });
    assertDate(date, { now, lowerBounds: [{ reason: 'BEFORE_APPLICATION', at: applyOp.occurredAt }], field: 'occurredAt', errorField: 'occurredAt' });
    const stamp = date.toISOString();
    const detail = {
      component: {
        kind: component.kind, catalogId: component.catalogId, name: component.name, slot: component.slot, wear: component.wear,
        pattern: component.pattern, purchaseReferenceCents: component.purchaseReferenceCents, source: component.source,
        origin: component.origin, sourceItemId: component.sourceItemId, operationId: component.operationId,
      },
    };
    const operation = ItemOperation.createOperation(
      { kind: 'SCRAPE_OFF', outcome: 'TRANSFERRED', occurredAt: stamp, detailJson: JSON.stringify(detail) },
      { now }
    );
    ItemOperation.createLink({ operationId: operation.id, itemId: target.id, role: 'TARGET', costShareBp: null });
    ItemComponent.remove(component.id);
    Item.update(target.id, {}, { now });
    return { operation, target: Item.findById(target.id) };
  });
}

// Unidades do estoque que podem ser aplicadas no alvo (D362 item 10). Vazio se o alvo não aceitar componentes ou não estiver em estoque.
// Cada candidata: { itemId, kind, catalogId, name, namePtBr, imageUrl, acquiredAt, effectiveCostUsdCents, costEstimated, tradeLocked, offSale }.
function listCandidates(targetId, { now = new Date() } = {}) {
  const target = findOrFail(targetId, 'TARGET');
  const allowedKinds = target.status === 'EM_ESTOQUE' ? itemComponentService.allowedKindsFor(target.category) : [];
  const rows = ItemComponent.listByItemIds([target.id]).get(target.id) ?? [];
  // Tipos que o item não aceita não têm vaga (B1): zera o que não cabe na categoria.
  const remainingAll = itemComponentService.remainingFor(rows);
  const remaining = {
    stickers: allowedKinds.includes('STICKER') ? remainingAll.stickers : 0,
    hanging: allowedKinds.some((kind) => itemComponentService.isDetachable(kind)) ? remainingAll.hanging : 0,
    patches: allowedKinds.includes('PATCH') ? remainingAll.patches : 0,
  };
  if (allowedKinds.length === 0) return { allowedKinds, remaining, candidates: [] };
  const units = Item.findInStockByCategories(SOURCE_CATEGORIES).filter((unit) => unit.id !== target.id);
  const resolvedBy = new Map();
  for (const [unitId, resolved] of resolveSourceKinds(units)) if (allowedKinds.includes(resolved.kind)) resolvedBy.set(unitId, resolved);
  const chosen = units.filter((unit) => resolvedBy.has(unit.id));
  const { costIndex } = operationContext.loadOperationContext(chosen);
  const candidates = chosen.map((unit) => {
    const { kind, entry } = resolvedBy.get(unit.id);
    const cost = costIndex.effectiveOf(unit);
    let namePtBr = entry.namePtBr ?? null;
    if (namePtBr && kind === 'STICKER_SLAB') namePtBr = `${SLAB_PREFIX}${itemComponentService.stripPrefix(namePtBr, 'Sticker | ')}`;
    return {
      itemId: unit.id,
      kind,
      catalogId: entry.id,
      name: unit.name,
      namePtBr,
      imageUrl: entry.imageUrl ?? null,
      acquiredAt: unit.acquiredAt,
      effectiveCostUsdCents: cost.effectiveUsdCents,
      costEstimated: cost.estimated,
      tradeLocked: isInTradeLock(unit, now),
      offSale: isOffSale(unit),
    };
  });
  return { allowedKinds, remaining, candidates };
}

module.exports = { SOURCE_CATEGORIES, resolveSourceKind, resolveSourceKinds, applyFromStock, scrapeOff, listCandidates };

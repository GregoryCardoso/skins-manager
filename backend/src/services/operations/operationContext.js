'use strict';

// Carrega as operações ativas (as tabelas são pequenas: uma consulta cada) e monta o índice de custo efetivo e as regras de desfazer
// (D362 itens 3 e 6). `assessUndo` é pura. Só orquestra consultas dos models; nenhuma regra de gravação fica aqui.
const Item = require('../../models/Item');
const ItemOperation = require('../../models/ItemOperation');
const { buildCostIndex, EMPTY_COST_INDEX } = require('./costService');
const itemComponentService = require('../itemComponentService');

const parseDetail = (operation) => {
  try {
    return operation.detailJson ? JSON.parse(operation.detailJson) : {};
  } catch (err) {
    return {};
  }
};

// Vínculo TARGET que guarda a arma de uma separação: o `weaponItemId` do detalhe, ou o primeiro TARGET (registros sem o detalhe).
function weaponLinkOf(links, detail) {
  const targets = links.filter((link) => link.role === 'TARGET');
  return targets.find((link) => link.itemId === detail.weaponItemId) ?? targets[0] ?? null;
}

// Regra única de HANGING_OCCUPIED (B4): a arma já tem outro pendurado (colocado à mão depois)? Pura: `rows` são os componentes atuais da arma.
const isHangingOccupied = (rows) => rows.some((row) => itemComponentService.isDetachable(row.kind));

// Operações ativas, vínculos agrupados por operação e a operação ativa mais recente (maior id) de cada unidade.
function loadActiveOperations() {
  const operations = ItemOperation.listActive();
  const links = operations.length ? ItemOperation.listLinksByOperationIds(operations.map((op) => op.id)) : [];
  const linksByOperation = new Map();
  const latestOpIdByItem = new Map();
  const consumedByItem = new Map(); // unidade consumida -> vínculo CONSUMED da operação ativa
  const createdByItem = new Map(); // unidade gerada -> vínculo CREATED da operação ativa (D363)
  const opsById = new Map(operations.map((op) => [op.id, op]));
  const detachByItem = new Map(); // unidade separada (gerada ou devolvida) -> { operation, role, detail } da separação ativa mais recente (D366)
  for (const link of links) {
    if (link.role === 'CONSUMED') consumedByItem.set(link.itemId, link);
    if (link.role === 'CREATED') createdByItem.set(link.itemId, link);
    if (!linksByOperation.has(link.operationId)) linksByOperation.set(link.operationId, []);
    linksByOperation.get(link.operationId).push(link);
    const current = latestOpIdByItem.get(link.itemId);
    if (current === undefined || link.operationId > current) latestOpIdByItem.set(link.itemId, link.operationId);
  }
  for (const operation of operations) {
    if (operation.kind !== 'DETACH_COMPONENT') continue;
    let detail = {};
    try {
      detail = operation.detailJson ? JSON.parse(operation.detailJson) : {};
    } catch (err) {
      detail = {};
    }
    for (const link of linksByOperation.get(operation.id) ?? []) {
      const isGenerated = link.role === 'CREATED';
      const isReturned = link.role === 'TARGET' && detail.mode === 'RETURN' && link.itemId === detail.returnedItemId;
      if (isGenerated || isReturned) detachByItem.set(link.itemId, { operation, role: isGenerated ? 'GENERATED' : 'RETURNED', detail });
    }
  }
  return { operations, links, linksByOperation, latestOpIdByItem, consumedByItem, createdByItem, detachByItem, opsById };
}

// Itens (os informados mais as unidades ligadas a operações ativas) por id.
function itemsMapWithLinked(items, links) {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const missing = [...new Set(links.map((l) => l.itemId))].filter((id) => !itemsById.has(id));
  if (missing.length) for (const [id, item] of Item.findByIds(missing)) itemsById.set(id, item);
  return itemsById;
}

// Só o índice de custo (lucro real).
function loadCostIndex(items) {
  const active = loadActiveOperations();
  return buildCostIndex({ itemsById: itemsMapWithLinked(items, active.links), operations: active.operations, links: active.links });
}

// Tudo o que as visões de item precisam: índice de custo, vínculos e a operação mais recente de cada unidade.
// `excludeOperationId`: calcula o custo como se essa operação não estivesse ativa (a prévia da separação de um pendurado aplicado do
// estoque, D366); as demais saídas (vínculos, mais recentes) seguem as da base.
function loadOperationContext(items, { excludeOperationId = null } = {}) {
  const active = loadActiveOperations();
  const itemsById = itemsMapWithLinked(items, active.links);
  const costIndex = excludeOperationId === null
    ? buildCostIndex({ itemsById, operations: active.operations, links: active.links })
    : buildCostIndex({ itemsById, operations: active.operations.filter((op) => op.id !== excludeOperationId), links: active.links });
  return { ...active, itemsById, costIndex };
}

// Função pura: a operação pode ser desfeita? `ctx`: { linksByOperation, latestOpIdByItem, itemsById, componentRowsOf? }.
// `componentRowsOf(itemId)`: os componentes atuais da unidade; sem ele, as conferências que dependem deles (separação e raspagem) não rodam.
// Devolve { undoable, reason, params }; `reason`: ALREADY_UNDONE | DETACHED | NOT_LATEST | TARGET_SOLD | TARGET_NOT_IN_STOCK |
// HANGING_OCCUPIED (separação) | COMPONENTS_NOT_ALLOWED | COMPONENT_LIMIT (raspagem: o componente não volta à arma).
function assessUndo(operation, ctx) {
  if (operation.undoneAt) return { undoable: false, reason: 'ALREADY_UNDONE', params: {} };
  // Aplicação encerrada por uma separação (D366): desfaz-se a separação antes.
  if (operation.endedByOperationId) return { undoable: false, reason: 'DETACHED', params: { operationId: operation.endedByOperationId } };
  const links = ctx.linksByOperation.get(operation.id) ?? [];
  for (const link of links) {
    const latest = ctx.latestOpIdByItem.get(link.itemId);
    if (latest !== undefined && latest !== operation.id) {
      return { undoable: false, reason: 'NOT_LATEST', params: { operationId: latest, itemId: link.itemId } };
    }
  }
  for (const link of links) {
    if (link.role !== 'TARGET' && link.role !== 'CREATED') continue;
    const item = ctx.itemsById.get(link.itemId);
    if (!item || item.status === 'EM_ESTOQUE') continue;
    return { undoable: false, reason: item.status === 'VENDIDO' ? 'TARGET_SOLD' : 'TARGET_NOT_IN_STOCK', params: { itemId: item.id } };
  }
  if (typeof ctx.componentRowsOf === 'function') {
    if (operation.kind === 'DETACH_COMPONENT') {
      // Separação (D366 item 6): o pendurado precisa de lugar na arma para voltar.
      const weapon = weaponLinkOf(links, parseDetail(operation));
      if (weapon && isHangingOccupied(ctx.componentRowsOf(weapon.itemId))) return { undoable: false, reason: 'HANGING_OCCUPIED', params: { itemId: weapon.itemId } };
    } else if (operation.kind === 'SCRAPE_OFF') {
      // Raspagem: o componente volta para a arma, que precisa ainda aceitá-lo e ter lugar (M5).
      const { component } = parseDetail(operation);
      const target = links.find((link) => link.role === 'TARGET');
      const item = target ? ctx.itemsById.get(target.itemId) : null;
      if (component && target && item) {
        if (!itemComponentService.allowedKindsFor(item.category).includes(component.kind)) {
          return { undoable: false, reason: 'COMPONENTS_NOT_ALLOWED', params: { itemId: item.id, category: item.category } };
        }
        try {
          itemComponentService.assertLimits([...ctx.componentRowsOf(target.itemId), { kind: component.kind }]);
        } catch (err) {
          return { undoable: false, reason: 'COMPONENT_LIMIT', params: { itemId: item.id, kind: component.kind } };
        }
      }
    }
  }
  return { undoable: true, reason: null, params: {} };
}

// Contexto sem nenhuma operação (as funções de visão que não recebem o contexto usam este).
const EMPTY_OPERATION_CONTEXT = Object.freeze({
  operations: [], links: [], linksByOperation: new Map(), latestOpIdByItem: new Map(), consumedByItem: new Map(), createdByItem: new Map(), detachByItem: new Map(), opsById: new Map(),
  itemsById: new Map(), costIndex: EMPTY_COST_INDEX,
});

module.exports = { weaponLinkOf, isHangingOccupied, EMPTY_OPERATION_CONTEXT, loadActiveOperations, loadCostIndex, loadOperationContext, assessUndo };

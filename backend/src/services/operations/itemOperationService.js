'use strict';

// Fachada das operações de unidades (D362 item 10): aplica, remove para sempre, desfaz e lista, devolvendo as visões da API. A regra
// fica em `componentApplicationService` e `operationUndoService`; aqui só se monta a resposta (as visões de item vêm do itemService).
const Item = require('../../models/Item');
const ItemComponent = require('../../models/ItemComponent');
const itemComponentService = require('../itemComponentService');
const ItemOperation = require('../../models/ItemOperation');
const { NotFoundError } = require('../../errors/AppError');
const itemService = require('../itemService');
const applicationService = require('./componentApplicationService');
const undoService = require('./operationUndoService');
const operationContext = require('./operationContext');
const openingService = require('./openingService');
const detachService = require('./detachService');

function operationView(operation) {
  return {
    id: operation.id,
    kind: operation.kind,
    outcome: operation.outcome,
    occurredAt: operation.occurredAt,
    undoneAt: operation.undoneAt ?? null,
    note: operation.note ?? null,
  };
}

function applyComponent(targetId, body, ctx = {}) {
  const { operation } = applicationService.applyFromStock({ ...body, targetId }, ctx);
  return { operation: operationView(operation), item: itemService.getItem(targetId, ctx) };
}

function scrapeComponent(targetId, componentId, body, ctx = {}) {
  const { operation } = applicationService.scrapeOff({ targetId, componentId, occurredAt: body.occurredAt ?? null }, ctx);
  return { operation: operationView(operation), item: itemService.getItem(targetId, ctx) };
}

function undo(operationId, ctx = {}) {
  const { operation, itemIds, removedItemIds = [] } = undoService.undoOperation(operationId, ctx);
  return { operation: operationView(operation), items: itemIds.map((id) => itemService.getItem(id, ctx)), removedItemIds };
}

// Abrir caixa, cápsula, pacote ou terminal (D363 item 9).
function openContainer(containerId, body, ctx = {}) {
  const { operation, generatedItem, consumedIds } = openingService.openContainer({ ...body, containerId }, ctx);
  return {
    operation: operationView(operation),
    generatedItem: generatedItem ? itemService.getItem(generatedItem.id, ctx) : null,
    consumedItemIds: consumedIds,
  };
}

function openOptions(containerId, ctx = {}) {
  return openingService.getOpenOptions(containerId, ctx);
}

// Separar o chaveiro ou o Sticker Slab da arma (D366): prévia (só leitura) e a operação.
function detachPreview(itemId, componentId, query = {}, ctx = {}) {
  return detachService.previewDetach({ itemId, componentId, hangingShareBp: query.hangingShareBp ?? null }, ctx);
}

function detachComponent(itemId, componentId, body, ctx = {}) {
  const { operation, detachedItem } = detachService.detachComponent({ ...body, itemId, componentId }, ctx);
  return { operation: operationView(operation), item: itemService.getItem(itemId, ctx), detachedItem: itemService.getItem(detachedItem.id, ctx) };
}

function candidates(targetId, ctx = {}) {
  return applicationService.listCandidates(targetId, ctx);
}

// Aplicação encerrada por uma separação: { operationId, occurredAt }.
function endedByOf(operationId) {
  const ender = ItemOperation.findById(operationId);
  return { operationId, occurredAt: ender ? ender.occurredAt : null };
}

// Detalhe da separação para o histórico: modo, componente, porcentagem e os preços usados (sem valores convertidos).
function detachView(detail) {
  const component = detail.component ?? {};
  return {
    mode: detail.mode ?? null,
    weaponItemId: detail.weaponItemId ?? null,
    component: { kind: component.kind ?? null, name: component.name ?? null, pattern: component.pattern ?? null, source: component.source ?? null },
    share: detail.share ?? null,
    applyOperationId: detail.applyOperationId ?? null,
    returnedItemId: detail.returnedItemId ?? null,
  };
}

// Histórico das operações do item (D362 item 10): da mais nova para a mais antiga, as desfeitas inclusive.
function listForItem(itemId) {
  if (!Item.findById(itemId)) throw new NotFoundError('Item não encontrado.', 'ITEM_NOT_FOUND');
  const operations = ItemOperation.listByItem(itemId);
  if (operations.length === 0) return [];
  const links = ItemOperation.listLinksByOperationIds(operations.map((op) => op.id));
  const linksByOperation = new Map();
  for (const link of links) {
    if (!linksByOperation.has(link.operationId)) linksByOperation.set(link.operationId, []);
    linksByOperation.get(link.operationId).push(link);
  }
  const itemsById = Item.findByIds(links.map((link) => link.itemId));
  const context = operationContext.loadOperationContext([...itemsById.values()]);
  return operations.map((operation) => {
    const own = (linksByOperation.get(operation.id) ?? []).find((link) => link.itemId === itemId);
    let verdict = operationContext.assessUndo(operation, context);
    // Separação: a arma não pode ter outro pendurado (colocado à mão depois), senão o pendurado não tem onde voltar (D366 item 6).
    if (verdict.undoable && operation.kind === 'DETACH_COMPONENT') {
      const weaponLink = (linksByOperation.get(operation.id) ?? []).find((link) => link.role === 'TARGET');
      const weaponRows = weaponLink ? ItemComponent.listByItemIds([weaponLink.itemId]).get(weaponLink.itemId) ?? [] : [];
      if (weaponRows.some((row) => itemComponentService.isDetachable(row.kind))) {
        verdict = { undoable: false, reason: 'HANGING_OCCUPIED', params: { itemId: weaponLink.itemId } };
      }
    }
    let detail = {};
    try {
      detail = operation.detailJson ? JSON.parse(operation.detailJson) : {};
    } catch (err) {
      detail = {};
    }
    // Perda (terminal recusado, D363): o custo efetivo da unidade consumida, enquanto a operação estiver ativa.
    const lossUsdCents = operation.outcome === 'LOST' && !operation.undoneAt ? context.costIndex.poolOf(operation.id).usdCents : null;
    return {
      ...operationView(operation),
      lossUsdCents,
      endedBy: operation.endedByOperationId ? endedByOf(operation.endedByOperationId) : null,
      detail: operation.kind === 'APPLY_COMPONENT' || operation.kind === 'SCRAPE_OFF' ? null : {
        container: detail.container ?? null, decision: detail.decision ?? null, undoneGenerated: detail.undoneGenerated ?? null,
        detach: operation.kind === 'DETACH_COMPONENT' ? detachView(detail) : null,
      },
      role: own ? own.role : null,
      counterparts: (linksByOperation.get(operation.id) ?? [])
        .filter((link) => link.itemId !== itemId)
        .map((link) => {
          const other = itemsById.get(link.itemId);
          return { itemId: link.itemId, name: other ? other.name : null, role: link.role, status: other ? other.status : null };
        }),
      undoable: verdict.undoable,
      undoBlockedReason: verdict.reason,
    };
  });
}

module.exports = {
  operationView, applyComponent, scrapeComponent, undo, openContainer, openOptions, candidates, listForItem, detachPreview, detachComponent,
};

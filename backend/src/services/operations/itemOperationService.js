'use strict';

// Fachada das operações de unidades (D362 item 10): aplica, remove para sempre, desfaz e lista, devolvendo as visões da API. A regra
// fica em `componentApplicationService` e `operationUndoService`; aqui só se monta a resposta (as visões de item vêm do itemService).
const Item = require('../../models/Item');
const ItemOperation = require('../../models/ItemOperation');
const { NotFoundError } = require('../../errors/AppError');
const itemService = require('../itemService');
const applicationService = require('./componentApplicationService');
const undoService = require('./operationUndoService');
const operationContext = require('./operationContext');
const openingService = require('./openingService');

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

function candidates(targetId, ctx = {}) {
  return applicationService.listCandidates(targetId, ctx);
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
    const verdict = operationContext.assessUndo(operation, context);
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
      detail: operation.kind === 'APPLY_COMPONENT' || operation.kind === 'SCRAPE_OFF' ? null : {
        container: detail.container ?? null, decision: detail.decision ?? null, undoneGenerated: detail.undoneGenerated ?? null,
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

module.exports = { operationView, applyComponent, scrapeComponent, undo, openContainer, openOptions, candidates, listForItem };

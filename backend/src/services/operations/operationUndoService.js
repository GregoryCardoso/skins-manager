'use strict';

// Desfazer uma operação (D355, D362 item 6): correção de um lançamento errado, não um evento do jogo. Só a operação mais recente de
// cada unidade envolvida, enquanto o alvo continuar em estoque. A operação desfeita e seus vínculos ficam no histórico e saem de
// todos os cálculos (o índice de custo só enxerga as ativas).
const Item = require('../../models/Item');
const ItemComponent = require('../../models/ItemComponent');
const ItemOperation = require('../../models/ItemOperation');
const { runInTransaction } = require('../../models/modelHelpers');
const { NotFoundError, ConflictError } = require('../../errors/AppError');
const externalLinkService = require('../externalLinkService');
const operationContext = require('./operationContext');

function undoOperation(operationId, { now = new Date() } = {}) {
  return runInTransaction(() => {
    const operation = ItemOperation.findById(operationId);
    if (!operation) throw new NotFoundError('Operação não encontrada.', 'OPERATION_NOT_FOUND');
    const context = operationContext.loadOperationContext([]);
    const verdict = operationContext.assessUndo(operation, context);
    if (!verdict.undoable) {
      if (verdict.reason === 'ALREADY_UNDONE') throw new ConflictError('Esta operação já foi desfeita.', 'OPERATION_ALREADY_UNDONE');
      throw new ConflictError('Esta operação não pode ser desfeita agora.', 'OPERATION_UNDO_BLOCKED', { params: { reason: verdict.reason, ...verdict.params } });
    }
    const links = context.linksByOperation.get(operation.id) ?? [];
    let itemIds = [...new Set(links.map((link) => link.itemId))];
    const removedItemIds = [];
    if (operation.kind === 'APPLY_COMPONENT') {
      ItemComponent.removeByOperation(operation.id);
      // A unidade volta como estava: holding, trade lock e giro não foram tocados na aplicação.
      for (const link of links) if (link.role === 'CONSUMED') Item.update(link.itemId, { status: 'EM_ESTOQUE', consumedAt: null }, { now });
    } else if (operation.kind === 'SCRAPE_OFF') {
      const { component } = JSON.parse(operation.detailJson);
      const target = links.find((link) => link.role === 'TARGET');
      ItemComponent.insertOne(target.itemId, component, { now });
    } else if (operation.kind === 'OPEN_CASE' || operation.kind === 'OPEN_TERMINAL') {
      // Abertura (D363 item 6): a unidade gerada é excluída (com os componentes, em cascata; no terminal comprado, a compra some e o saldo da
      // loja Steam volta) e as consumidas voltam como estavam. Um retrato da gerada fica no histórico.
      const created = links.find((link) => link.role === 'CREATED');
      let snapshot = null;
      if (created) {
        const generated = Item.findById(created.itemId);
        if (generated) {
          snapshot = {
            name: generated.name, catalogId: generated.catalogId, category: generated.category, acquisitionType: generated.acquisitionType,
            purchasePriceCents: generated.purchasePriceCents, purchaseCurrency: generated.purchaseCurrency,
          };
          ItemOperation.deleteCreatedLink(operation.id, generated.id); // o vínculo é RESTRICT
          // Operações já desfeitas em que a gerada participou (ex.: aplicada e desfeita, ou aberta e desfeita) também a prendem pelo RESTRICT;
          // saem como na exclusão comum de item (itemService). A operação atual não entra: o vínculo CREATED dela já saiu acima.
          ItemOperation.deleteUndoneForItem(generated.id);
          externalLinkService.detachOnRemove('ITEM_PURCHASE', generated.id, { now });
          externalLinkService.detachOnRemove('ITEM_SALE', generated.id, { now });
          Item.remove(generated.id);
          removedItemIds.push(generated.id);
        }
      }
      const detail = operation.detailJson ? JSON.parse(operation.detailJson) : {};
      ItemOperation.updateDetail(operation.id, JSON.stringify({ ...detail, undoneGenerated: snapshot }));
      for (const link of links) if (link.role === 'CONSUMED') Item.update(link.itemId, { status: 'EM_ESTOQUE', consumedAt: null }, { now });
      itemIds = itemIds.filter((id) => !removedItemIds.includes(id));
    } else {
      throw new ConflictError('Este tipo de operação não pode ser desfeito.', 'OPERATION_UNDO_BLOCKED', { params: { reason: 'KIND_NOT_SUPPORTED' } });
    }
    for (const id of itemIds) Item.update(id, {}, { now });
    ItemOperation.markUndone(operation.id, now.toISOString());
    return { operation: ItemOperation.findById(operation.id), itemIds, removedItemIds };
  });
}

module.exports = { undoOperation };

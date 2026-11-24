'use strict';

// Ações de uma pendência da importação (9.4, D301; 9.5.1b, D331). Função pura, usada pela visão (`allowedActions`) e pela
// resolução (o que vale para cada entrada). O frontend lê `allowedActions` em vez de repetir esta tabela.
// `SPLIT_FROM_ITEM` ("Separar de um item que comprei", D321) fica reservado: nunca é devolvido nem aceito por enquanto.
// `APPLY_FROM_STOCK` (10.3, D362 item 9, E-P2-Q47): "Aplicar e registrar" do aviso de componente possivelmente aplicado do estoque.
const RESOLVE_ACTIONS = Object.freeze(['REMOVE', 'KEEP', 'CREATE', 'LINK', 'IGNORE', 'CREATE_PURCHASE', 'MARK_WON', 'APPLY_FROM_STOCK', 'SPLIT_FROM_ITEM']);
const RESERVED_ACTIONS = Object.freeze(['SPLIT_FROM_ITEM']);
const BULK_ACTIONS = Object.freeze(['MARK_WON', 'IGNORE', 'REOPEN']);
const WITHOUT_PURCHASE_REASON = 'PURCHASE_NOT_FOUND';

// Ações de uma entrada ABERTA, pelo resultado e pelo motivo.
function openActionsFor(entry) {
  if (entry.outcome === 'REVERTED') return ['REMOVE', 'KEEP'];
  if (entry.outcome === 'POSSIBLE_DUPLICATE') return ['CREATE', 'LINK', 'IGNORE'];
  if (entry.outcome === 'FAILED' && entry.reasonCode === WITHOUT_PURCHASE_REASON) return ['CREATE_PURCHASE', 'MARK_WON', 'IGNORE'];
  if (entry.outcome === 'FAILED' || entry.outcome === 'UNKNOWN_STATE') return ['IGNORE'];
  return stockActionsFor(entry);
}

const MAYBE_APPLIED_WARNING = 'COMPONENT_MAYBE_APPLIED_FROM_STOCK';

// Avisos "componente possivelmente aplicado do estoque" guardados no `display_json` da entrada: [{ code, name, candidateItemId }].
function applyWarningsOf(entry) {
  if (typeof entry.displayJson !== 'string' || entry.displayJson === '') return [];
  try {
    const display = JSON.parse(entry.displayJson);
    const list = display && Array.isArray(display.componentWarnings) ? display.componentWarnings : [];
    return list.filter((w) => w && w.code === MAYBE_APPLIED_WARNING && Number.isSafeInteger(w.candidateItemId));
  } catch (err) {
    return [];
  }
}

// Venda importada (criada ou ligada) cuja arma não tem o componente do trade e há uma unidade igual no estoque: pode "Aplicar e registrar".
function stockActionsFor(entry) {
  const isSaleEntry = (entry.outcome === 'CREATED' || entry.outcome === 'MATCHED') && entry.entityType === 'ITEM_SALE';
  return isSaleEntry && applyWarningsOf(entry).length > 0 ? ['APPLY_FROM_STOCK'] : [];
}

// `reopenable`: a entrada está na lista de ignoradas (D329) e pode voltar para as pendências.
function allowedActionsFor(entry, { reopenable = false } = {}) {
  if (entry.resolution !== null && entry.resolution !== undefined) return reopenable ? ['REOPEN'] : [];
  return openActionsFor(entry);
}

module.exports = { MAYBE_APPLIED_WARNING, applyWarningsOf, RESOLVE_ACTIONS, RESERVED_ACTIONS, BULK_ACTIONS, WITHOUT_PURCHASE_REASON, openActionsFor, allowedActionsFor };

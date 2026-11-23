'use strict';

// Ações de uma pendência da importação (9.4, D301; 9.5.1b, D331). Função pura, usada pela visão (`allowedActions`) e pela
// resolução (o que vale para cada entrada). O frontend lê `allowedActions` em vez de repetir esta tabela.
// `SPLIT_FROM_ITEM` ("Separar de um item que comprei", D321) fica reservado: nunca é devolvido nem aceito por enquanto.
const RESOLVE_ACTIONS = Object.freeze(['REMOVE', 'KEEP', 'CREATE', 'LINK', 'IGNORE', 'CREATE_PURCHASE', 'MARK_WON', 'SPLIT_FROM_ITEM']);
const RESERVED_ACTIONS = Object.freeze(['SPLIT_FROM_ITEM']);
const BULK_ACTIONS = Object.freeze(['MARK_WON', 'IGNORE', 'REOPEN']);
const WITHOUT_PURCHASE_REASON = 'PURCHASE_NOT_FOUND';

// Ações de uma entrada ABERTA, pelo resultado e pelo motivo.
function openActionsFor(entry) {
  if (entry.outcome === 'REVERTED') return ['REMOVE', 'KEEP'];
  if (entry.outcome === 'POSSIBLE_DUPLICATE') return ['CREATE', 'LINK', 'IGNORE'];
  if (entry.outcome === 'FAILED' && entry.reasonCode === WITHOUT_PURCHASE_REASON) return ['CREATE_PURCHASE', 'MARK_WON', 'IGNORE'];
  if (entry.outcome === 'FAILED' || entry.outcome === 'UNKNOWN_STATE') return ['IGNORE'];
  return [];
}

// `reopenable`: a entrada está na lista de ignoradas (D329) e pode voltar para as pendências.
function allowedActionsFor(entry, { reopenable = false } = {}) {
  if (entry.resolution !== null && entry.resolution !== undefined) return reopenable ? ['REOPEN'] : [];
  return openActionsFor(entry);
}

module.exports = { RESOLVE_ACTIONS, RESERVED_ACTIONS, BULK_ACTIONS, WITHOUT_PURCHASE_REASON, openActionsFor, allowedActionsFor };

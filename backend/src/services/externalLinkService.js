'use strict';

// Vínculos entre lançamentos do app e registros externos (D292, D318). Quem apaga um lançamento importado chama
// `detachOnRemove`: o vínculo some e o registro vira REMOVED_IN_APP (nunca mais é importado).
const ExternalLink = require('../models/ExternalLink');
const ExternalRecord = require('../models/ExternalRecord');
const ImportBatchEntry = require('../models/ImportBatchEntry');

const SOURCE = 'CSFLOAT';

// Chamado dentro da transação da operação (excluir item, desfazer venda). Sem vínculo, não faz nada.
function detachOnRemove(entityType, entityId, { now = new Date() } = {}) {
  const link = ExternalLink.findByEntity(entityType, entityId);
  if (!link) return false;
  ExternalLink.removeByEntity(entityType, entityId);
  ExternalRecord.update(link.recordId, { tracking: 'REMOVED_IN_APP' }, { now });
  ImportBatchEntry.resolveOpenForRecord(link.recordId, 'REMOVED', { now });
  return true;
}

// Map itemId -> 'CSFLOAT' (selo na tabela). Sem ids = todos os itens com vínculo.
function sourcesByItemIds(itemIds = null) {
  return ExternalLink.sourcesByItemIds(itemIds);
}

// Troca de conta (D293): os trades abertos da conta anterior viram IGNORED e as pendências deles ficam resolvidas como IGNORED.
// Chamado dentro da transação da troca.
function ignoreOpenForAccountSwitch({ source = SOURCE, now = new Date() } = {}) {
  const ids = ExternalRecord.ignoreOpenForAccountSwitch(source, { now });
  for (const id of ids) ImportBatchEntry.resolveOpenForRecord(id, 'IGNORED', { now });
  return ids.length;
}

module.exports = { detachOnRemove, sourcesByItemIds, ignoreOpenForAccountSwitch };

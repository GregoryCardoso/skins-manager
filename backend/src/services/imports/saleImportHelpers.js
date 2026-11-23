'use strict';

// Helpers da venda importada do CSFloat (9.3, D299, D312), usados pela importação e pela resolução de pendências (9.4, D301):
// crédito real do extrato (`contract_sold`), liberação real (`trade_verified`/`verify_sale_at`) e a taxa esperada pela loja.
const ExternalRecord = require('../../models/ExternalRecord');
const ExternalLink = require('../../models/ExternalLink');
const Item = require('../../models/Item');
const { AppError } = require('../../errors/AppError');
const itemService = require('../itemService');
const { resolveSaleNet } = require('../pricingService');

const SOURCE = 'CSFLOAT';

// Data da venda importada: `contract.sold_at` (ou o aceite, ou a criação do trade).
const saleMoment = (trade) => trade.soldAt || trade.acceptedAt || trade.createdAt;

// Liberação real da venda (D312): a data do `trade_verified` do contrato, quando já veio; senão, o `verify_sale_at`; senão nula
// (vale a retenção da loja).
function saleReleaseOf(contractId, verifySaleAt) {
  const verified = contractId ? ExternalRecord.findTransactionsByContract(SOURCE, contractId, ['trade_verified']) : [];
  if (verified.length) {
    return verified.map((tx) => tx.externalCreatedAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  }
  return verifySaleAt || null;
}

// Atualiza a liberação de uma venda CRIADA pela importação (a manual ligada nunca é alterada, E9-Q10). A atualização do próprio
// import não conta como "editado" no desfazer: o `entity_updated_at` acompanha, se o item ainda não tinha sido editado.
function syncSaleRelease(link, record, { now }) {
  if (!link || link.entityType !== 'ITEM_SALE' || link.linkKind !== 'CREATED') return;
  const item = Item.findById(link.entityId);
  if (!item || item.status !== 'VENDIDO') return;
  const next = saleReleaseOf(record.contractId, record.verifySaleAt);
  if ((item.saleReleaseAt ?? null) === (next ? new Date(next).toISOString() : null)) return;
  const wasClean = item.updatedAt === link.entityUpdatedAt;
  const updated = itemService.updateImportedSaleRelease(item.id, next, { now });
  if (wasClean) ExternalLink.update(link.id, { entityUpdatedAt: updated.updatedAt });
}

// `trade_verified` lidos neste lote: atualiza a liberação das vendas importadas desses contratos.
function syncReleasesFromTransactions(transactions, { now }) {
  const contractIds = transactions.filter((tx) => tx.type === 'trade_verified' && tx.contractId).map((tx) => tx.contractId);
  if (!contractIds.length) return;
  const records = ExternalRecord.findTradesByContractIds(SOURCE, contractIds);
  const links = ExternalLink.findByRecordIds([...records.values()].map((r) => r.id));
  for (const record of records.values()) syncSaleRelease(links.get(record.id), record, { now });
}

// Taxa que as regras da loja dariam para o preço (só para o aviso FEE_MISMATCH), ou null se a loja não tem taxa configurada.
function expectedFeeCents(priceCents, store) {
  try {
    return resolveSaleNet({ salePriceCents: priceCents, store }).feeCents;
  } catch (err) {
    if (err instanceof AppError) return null;
    throw err;
  }
}

// Crédito da venda no extrato (`contract_sold` do mesmo contrato): `{ netCents, feeCents }`, `{ missing: true }` (o extrato ainda
// não trouxe) ou `{ inconsistent: true }` (o pendente não bate com preço − taxa).
function saleCreditOf(trade) {
  const sold = ExternalRecord.findTransactionsByContract(SOURCE, trade.contractId, ['contract_sold']);
  if (!sold.length) return { missing: true };
  const tx = sold[0];
  const netCents = tx.pendingOffsetCents;
  if (!Number.isSafeInteger(netCents)) return { inconsistent: true };
  if (tx.feeCents !== null && tx.feeCents !== undefined && netCents !== trade.priceCents - tx.feeCents) return { inconsistent: true };
  return { netCents, feeCents: trade.priceCents - netCents };
}

module.exports = { saleMoment, saleReleaseOf, syncSaleRelease, syncReleasesFromTransactions, expectedFeeCents, saleCreditOf };

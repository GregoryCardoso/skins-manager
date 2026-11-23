'use strict';

// Monta as visões `ImportBatchView`, `ImportBatchSummary` e `ImportEntryView` (D318 seção 10). Funções puras.
// O `display_json` guardado é neutro (sem dados pessoais); o nome traduzido e a imagem saem do catálogo na hora da resposta.

const { allowedActionsFor } = require('./entryActions');

function parseJson(text, fallback) {
  if (typeof text !== 'string' || text === '') return fallback;
  try {
    const value = JSON.parse(text);
    return value === null || value === undefined ? fallback : value;
  } catch (err) {
    return fallback;
  }
}

function toDisplay(displayJson, catalogById) {
  const display = parseJson(displayJson, {});
  const catalog = display.catalogId && catalogById ? catalogById.get(display.catalogId) : null;
  return {
    direction: display.direction ?? null,
    marketHashName: display.marketHashName ?? null,
    name: catalog ? catalog.name : display.marketHashName ?? null,
    namePtBr: catalog ? catalog.namePtBr ?? null : null,
    imageUrl: catalog ? catalog.imageUrl ?? null : null,
    catalogId: display.catalogId ?? null,
    category: display.category ?? null,
    variant: display.variant ?? null,
    floatValue: display.floatValue ?? null,
    paintSeed: display.paintSeed ?? null,
    phase: display.phase ?? null,
    priceCents: display.priceCents ?? null,
    currency: display.currency ?? 'USD',
    date: display.date ?? null,
    state: display.state ?? null,
    // Venda importada com taxa diferente da calculada pela loja (FEE_MISMATCH, D299): a cobrada pelo CSFloat e a das regras.
    feeCents: display.feeCents ?? null,
    expectedFeeCents: display.expectedFeeCents ?? null,
  };
}

// `linkKinds`: Map recordId -> 'CREATED' | 'MATCHED' (o lançamento ligado foi criado pela importação ou é manual).
// `reopenable`: a entrada está na lista de ignoradas e pode voltar (D329). `allowedActions` vem daqui (D331).
function toEntryView(entry, catalogById, linkKinds = new Map(), { reopenable = false } = {}) {
  return {
    allowedActions: allowedActionsFor(entry, { reopenable }),
    linkKind: (entry.recordId && linkKinds.get(entry.recordId)) || null,
    id: entry.id,
    batchId: entry.batchId,
    outcome: entry.outcome,
    reasonCode: entry.reasonCode ?? null,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    candidateIds: parseJson(entry.candidateIds, []),
    resolution: entry.resolution ?? null,
    resolvedAt: entry.resolvedAt ?? null,
    display: toDisplay(entry.displayJson, catalogById),
  };
}

function toBatchSummary(batch, { undoable = false, openEntriesCount = 0 } = {}) {
  return {
    id: batch.id,
    source: batch.source,
    trigger: batch.trigger,
    status: batch.status,
    startedAt: batch.startedAt,
    finishedAt: batch.finishedAt,
    fullScan: batch.fullScan === true,
    cutoffAt: batch.cutoffAt ?? null,
    pagesRead: { trades: batch.tradePagesRead, transactions: batch.transactionPagesRead },
    warnings: parseJson(batch.warningsJson, []),
    counts: {
      purchasesCreated: batch.purchasesCreated,
      salesCreated: batch.salesCreated,
      matched: batch.matchedCount,
      known: batch.knownCount,
      beforeCutoff: batch.beforeCutoffCount,
      notTransferred: batch.notTransferredCount,
      review: batch.reviewCount,
      reverted: batch.revertedCount,
      failed: batch.failedCount,
      unknownState: batch.unknownStateCount,
      deferredSales: batch.deferredCount,
      withoutPurchase: batch.withoutPurchaseCount,
      // Aceitos e revertidos antes de importar (9.4): guardado no diagnóstico (a v13 não tem coluna própria).
      revertedBeforeImport: Number(parseJson(batch.diagnosticsJson, {}).revertedBeforeImport) || 0,
    },
    unknownTypes: parseJson(batch.unknownTypesJson, {}),
    diagnostics: parseJson(batch.diagnosticsJson, {}),
    errorCode: batch.errorCode ?? null,
    undoneAt: batch.undoneAt ?? null,
    undoable: Boolean(undoable),
    openEntriesCount,
  };
}

function toBatchView(batch, entries, { catalogById = new Map(), undoable = false, openEntriesCount = 0, linkKinds = new Map() } = {}) {
  return {
    ...toBatchSummary(batch, { undoable, openEntriesCount }),
    entries: entries.map((entry) => toEntryView(entry, catalogById, linkKinds)),
  };
}

module.exports = { parseJson, toDisplay, toEntryView, toBatchSummary, toBatchView };

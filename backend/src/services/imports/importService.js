'use strict';

// Importação de lojas externas, parte 9.2: compras do CSFloat (D285 a D318). Duas fases:
//   1. leitura (rede): conta, extrato e trades, página a página, sem gravar nada;
//   2. aplicação: tudo numa única transação síncrona (falha no meio = nada gravado).
// Regra de negócio aqui; o Adapter fala com a rede (e nunca vê o banco) e os models só fazem SQL. A chave da API nunca passa por
// este arquivo: o Adapter a recebe de `integrationService.requireApiKey` e nunca a devolve.
const ImportBatch = require('../../models/ImportBatch');
const ImportBatchEntry = require('../../models/ImportBatchEntry');
const ExternalRecord = require('../../models/ExternalRecord');
const ExternalLink = require('../../models/ExternalLink');
const Integration = require('../../models/Integration');
const CatalogItem = require('../../models/CatalogItem');
const Item = require('../../models/Item');
const Store = require('../../models/Store');
const { runInTransaction } = require('../../models/modelHelpers');
const { AppError, ValidationError, ConflictError, UpstreamError, NotFoundError } = require('../../errors/AppError');
const {
  CSFLOAT_IMPORT_TOTAL_TIMEOUT_MS, CSFLOAT_PAGE_LIMIT, CSFLOAT_PAGE_DELAY_MS, IMPORT_BATCHES_PAGE_SIZE,
} = require('../../config/constants');
const integrationService = require('../integrationService');
const itemService = require('../itemService');
const catalogService = require('../catalogService');
const backupService = require('../backupService');
const { normalizeSearchText } = require('../catalog/csgoApiAdapter');
const { waitForRateLimit } = require('./adapters/csfloatHttp');
const { KNOWN_TX_TYPES, PURCHASE_REVERSAL_TX_TYPES } = require('./adapters/csfloatStates');
const { validateAdapter } = require('./importSource');
const importLock = require('./importLock');
const scanPolicy = require('./scanPolicy');
const tradeClassifier = require('./tradeClassifier');
const externalItemMapper = require('./externalItemMapper');
const manualMatchService = require('./manualMatchService');
const cutoffService = require('./cutoffService');
const undoService = require('./undoService');
const importViews = require('./importViews');

const SOURCE = 'CSFLOAT';
const MAX_UNKNOWN_KEYS = 50;
const CLOSED = tradeClassifier.CLOSED_TRACKINGS;
const FAILURE_TRACKINGS = ['RETRY', 'UNKNOWN_STATE'];

const isImportInProgress = importLock.isImportInProgress;
const tradeMoment = (trade) => trade.soldAt || trade.createdAt;
const toMs = (iso) => (iso ? Date.parse(iso) : null);

// --- Pré-condições ----------------------------------------------------------------------------------------------------

function requireImportStore(row) {
  if (row.storeId === null || row.storeId === undefined) {
    throw new ConflictError('Crie, em Lojas, uma loja em US$ chamada "CSFloat".', 'IMPORT_STORE_REQUIRED');
  }
  const store = Store.findById(row.storeId);
  if (!store) throw new ConflictError('Crie, em Lojas, uma loja em US$ chamada "CSFloat".', 'IMPORT_STORE_REQUIRED');
  if (store.currency !== 'USD') {
    throw new ValidationError('A loja da integração precisa ser em dólar (US$).', 'IMPORT_STORE_CURRENCY_NOT_ALLOWED', { field: 'storeId' });
  }
  return store;
}

// --- Leitura (rede) ---------------------------------------------------------------------------------------------------

const defaultSleep = (ms, signal) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });

// Lê o extrato (order=desc) até o cursor ou o corte, mais a janela de reverificação (D295). Nada é gravado.
async function readTransactions(env) {
  const { adapter, apiKey, row, cutoffMs, fullScan, fetchFn, signal, deadlineAt, nowFn, sleepFn, firstImport } = env;
  const cursorCreatedAt = row.lastTransactionId ? ExternalRecord.findTransactionCreatedAt(SOURCE, row.lastTransactionId) : null;
  const cursorMs = cursorCreatedAt ? Date.parse(cursorCreatedAt) : null;
  const list = [];
  let pages = 0;
  let invalid = 0;
  const warnings = [];
  for (let page = 0; ; page += 1) {
    const result = await adapter.pageTransactions({
      apiKey, page, limit: CSFLOAT_PAGE_LIMIT, order: 'desc', fetchFn, totalSignal: signal, totalDeadlineAt: deadlineAt, nowFn, sleepFn,
    });
    pages += 1;
    const oks = result.transactions.filter((t) => t.ok).map((t) => t.transaction);
    invalid += result.transactions.length - oks.length;
    list.push(...oks);
    const oldestMs = oks.length ? Math.min(...oks.map((t) => Date.parse(t.createdAt))) : NaN;
    const decision = scanPolicy.shouldStopTransactions({
      page, limit: CSFLOAT_PAGE_LIMIT, count: result.count, pageSize: result.transactions.length, oldestMs,
      cursorCreatedMs: firstImport ? null : cursorMs, cutoffMs, fullScan,
    });
    if (decision.reason === 'LIMIT') warnings.push('SCAN_LIMIT_REACHED');
    if (decision.stop) break;
    await waitForRateLimit(result.rateLimit, { totalSignal: signal, totalDeadlineAt: deadlineAt, nowFn, sleepFn });
    await (sleepFn || defaultSleep)(CSFLOAT_PAGE_DELAY_MS, signal);
  }
  return { transactions: list, pages, invalid, warnings };
}

// Lê os trades, parando pelas regras da D295. Devolve só os que a leitura trouxe; nada é gravado.
async function readTrades(env, { transactions }) {
  const { adapter, apiKey, row, cutoffMs, fullScan, fetchFn, signal, deadlineAt, nowFn, sleepFn, firstImport } = env;

  // Horizonte de reverificação: o mais antigo entre os registros abertos, as transações novas sem trade conhecido e a última importação.
  const existingTx = ExternalRecord.findManyByExternalIds(SOURCE, 'TRANSACTION', transactions.map((t) => t.externalId));
  const newTx = transactions.filter((t) => !existingTx.has(t.externalId) && t.contractId);
  const knownContracts = ExternalRecord.findKnownTradeContractIds(SOURCE, newTx.map((t) => t.contractId));
  const orphanTx = newTx.filter((t) => !knownContracts.has(t.contractId));
  const horizonMs = scanPolicy.computeHorizon({
    openRecordsOldestMs: toMs(ExternalRecord.oldestOpenTradeCreatedAt(SOURCE)),
    newTransactionsOldestMs: orphanTx.length ? Math.min(...orphanTx.map((t) => Date.parse(t.createdAt))) : null,
    lastImportMs: toMs(row.lastImportAt),
  });

  const trades = new Map();
  const invalid = [];
  const warnings = [];
  let pages = 0;
  let orderBroken = false;
  let previousMs = null;
  for (let page = 0; ; page += 1) {
    const result = await adapter.pageTrades({
      apiKey, page, limit: CSFLOAT_PAGE_LIMIT, fetchFn, totalSignal: signal, totalDeadlineAt: deadlineAt, nowFn, sleepFn,
    });
    pages += 1;
    const oks = result.trades.filter((t) => t.ok).map((t) => t.trade);
    for (const bad of result.trades.filter((t) => !t.ok)) invalid.push(bad);
    const createdList = oks.map((t) => Date.parse(t.createdAt));
    if (!orderBroken && scanPolicy.isOrderBroken(createdList, previousMs)) orderBroken = true;
    if (createdList.length) previousMs = createdList[createdList.length - 1];
    for (const trade of oks) if (!trades.has(trade.externalId)) trades.set(trade.externalId, trade);

    const known = ExternalRecord.findManyByExternalIds(SOURCE, 'TRADE', oks.map((t) => t.externalId));
    const allClosed = oks.length > 0 && oks.every((t) => known.has(t.externalId) && CLOSED.includes(known.get(t.externalId).tracking));
    const decision = scanPolicy.shouldStopTrades({
      page, limit: CSFLOAT_PAGE_LIMIT, count: result.count, pageSize: result.trades.length,
      oldestMs: createdList.length ? Math.min(...createdList) : NaN, allClosed, horizonMs, cutoffMs, fullScan, firstImport, orderBroken,
    });
    if (decision.reason === 'LIMIT') warnings.push('SCAN_LIMIT_REACHED');
    if (decision.stop) break;
    await waitForRateLimit(result.rateLimit, { totalSignal: signal, totalDeadlineAt: deadlineAt, nowFn, sleepFn });
    await (sleepFn || defaultSleep)(CSFLOAT_PAGE_DELAY_MS, signal);
  }
  if (orderBroken) warnings.push('ORDER_NOT_GUARANTEED');
  return { trades: [...trades.values()], invalid, pages, orderBroken, warnings };
}

// --- Aplicação (síncrona, numa transação) -----------------------------------------------------------------------------

function directionOf(trade, steamId) {
  const buyer = trade.buyerId === steamId;
  const seller = trade.sellerId === steamId;
  if (buyer === seller) return null;
  return buyer ? 'BUY' : 'SELL';
}

function startOfPreviousLocalDay(iso) {
  const date = new Date(iso);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - 1);
  return date.toISOString();
}

function buildDisplay(trade, direction, mapped) {
  const catalogEntry = mapped && mapped.catalogEntry;
  return {
    direction,
    marketHashName: trade.item.marketHashName,
    catalogId: catalogEntry ? catalogEntry.id : null,
    category: mapped ? mapped.category : null,
    variant: mapped ? mapped.variant : null,
    floatValue: mapped ? mapped.floatValue : null,
    paintSeed: mapped ? mapped.paintSeed : null,
    phase: mapped ? (catalogEntry && catalogEntry.phase) || mapped.phase : null,
    priceCents: trade.priceCents,
    currency: 'USD',
    date: tradeMoment(trade),
    state: trade.rawState,
  };
}

function bump(counter, key) {
  if (Object.keys(counter).length >= MAX_UNKNOWN_KEYS && !(key in counter)) return;
  counter[key] = (counter[key] || 0) + 1;
}

// Aplica tudo o que foi lido. Devolve { batchId }.
function applyImport(env, read) {
  const { row, store, now, finishedAt, cutoffToStore, effectiveCutoff, steamId, account, trigger } = env;
  const counts = {
    purchasesCreated: 0, matched: 0, known: 0, beforeCutoff: 0, notTransferred: 0, review: 0, reverted: 0, failed: 0,
    unknownState: 0, deferred: 0,
  };
  const unknownTypes = {};
  const warnings = [...new Set(read.warnings)];
  const effectiveFullScan = env.fullScan || read.orderBroken;
  const stamp = now.toISOString();

  const batch = ImportBatch.create(
    {
      source: SOURCE, trigger, status: 'DONE', startedAt: stamp, finishedAt: finishedAt.toISOString(), fullScan: effectiveFullScan,
      cutoffAt: effectiveCutoff, previousTransactionCursor: row.lastTransactionId ?? null,
    },
    { now }
  );

  // (b) liga a conta, se ainda não estava; (c) grava o corte informado.
  integrationService.ensureAccountLinked(account, row, { now });
  const fingerprint = Integration.get(SOURCE).accountFingerprint;
  if (cutoffToStore) Integration.update(SOURCE, { tradesCutoffAt: cutoffToStore }, { now });

  // (d) extrato: cada transação vira um registro "visto". Nenhum lançamento nasce dele na 9.2.
  const existingTx = ExternalRecord.findManyByExternalIds(SOURCE, 'TRANSACTION', read.transactions.map((t) => t.externalId));
  for (const tx of read.transactions) {
    if (!KNOWN_TX_TYPES.includes(tx.type)) bump(unknownTypes, tx.type);
    const fields = {
      contractId: tx.contractId, relatedTradeId: tx.tradeId, txType: tx.type, tracking: 'SEEN', externalCreatedAt: tx.createdAt,
      balanceOffsetCents: tx.balanceOffsetCents, pendingOffsetCents: tx.pendingOffsetCents, feeCents: tx.feeCents,
      lastBatchId: batch.id, lastSeenAt: stamp,
    };
    const existing = existingTx.get(tx.externalId);
    if (existing) ExternalRecord.update(existing.id, fields, { now });
    else {
      ExternalRecord.create(
        { source: SOURCE, kind: 'TRANSACTION', externalId: tx.externalId, accountFingerprint: fingerprint, firstBatchId: batch.id, ...fields },
        { now }
      );
    }
  }

  // (e) trades, do mais antigo para o mais novo.
  const trades = [...read.trades].sort((a, b) => Date.parse(tradeMoment(a)) - Date.parse(tradeMoment(b)));
  const existingTrades = ExternalRecord.findManyByExternalIds(SOURCE, 'TRADE', trades.map((t) => t.externalId));
  const linksByRecord = ExternalLink.findByRecordIds([...existingTrades.values()].map((r) => r.id));
  const refundContracts = ExternalRecord.findContractIdsWithTransactionTypes(
    SOURCE, trades.map((t) => t.contractId), PURCHASE_REVERSAL_TX_TYPES
  );
  const diagnostics = { trades: { BUY: {}, SELL: {} }, duplicateContractIds: 0, tradesRead: trades.length, transactionsRead: read.transactions.length,
    invalidTrades: read.invalidTrades.length, invalidTransactions: read.invalidTransactions };
  const contractSeen = new Set();
  const cutoffMs = Date.parse(effectiveCutoff);
  const toImport = [];

  const saveTrade = (trade, direction, tracking, existing) => {
    const fields = {
      contractId: trade.contractId, direction, rawState: trade.rawState, offerState: trade.offerState, tracking,
      externalCreatedAt: trade.createdAt, soldAt: trade.soldAt, acceptedAt: trade.acceptedAt, protectionEndsAt: trade.protectionEndsAt,
      verifySaleAt: trade.verifySaleAt, amountCents: trade.priceCents, displayName: trade.item.marketHashName,
      lastBatchId: batch.id, lastSeenAt: stamp,
    };
    if (existing) return ExternalRecord.update(existing.id, fields, { now });
    return ExternalRecord.create(
      { source: SOURCE, kind: 'TRADE', externalId: trade.externalId, accountFingerprint: fingerprint, firstBatchId: batch.id, ...fields },
      { now }
    );
  };
  const addEntry = (record, data) =>
    ImportBatchEntry.create(
      {
        batchId: batch.id, recordId: record ? record.id : null, outcome: data.outcome, reasonCode: data.reasonCode ?? null,
        entityType: data.entityType ?? null, entityId: data.entityId ?? null,
        candidateIds: data.candidateIds ? JSON.stringify(data.candidateIds) : null, displayJson: JSON.stringify(data.display),
      },
      { now }
    );

  // Trades com dados essenciais ausentes: registro tentado de novo e entrada para conferir (sem payload bruto).
  for (const bad of read.invalidTrades) {
    counts.failed += 1;
    let record = null;
    if (bad.externalId) {
      const existing = ExternalRecord.find(SOURCE, 'TRADE', bad.externalId);
      const fields = { tracking: 'RETRY', lastBatchId: batch.id, lastSeenAt: stamp };
      record = existing
        ? ExternalRecord.update(existing.id, fields, { now })
        : ExternalRecord.create(
          { source: SOURCE, kind: 'TRADE', externalId: bad.externalId, accountFingerprint: fingerprint, firstBatchId: batch.id, externalCreatedAt: stamp, ...fields },
          { now }
        );
    }
    addEntry(record, { outcome: 'FAILED', reasonCode: 'SOURCE_RECORD_INVALID', display: { direction: null, marketHashName: null, priceCents: null, currency: 'USD', date: null } });
  }

  for (const trade of trades) {
    const direction = directionOf(trade, steamId);
    const existing = existingTrades.get(trade.externalId) || null;
    if (contractSeen.has(trade.contractId)) diagnostics.duplicateContractIds += 1;
    contractSeen.add(trade.contractId);
    if (direction) bump(diagnostics.trades[direction], `${trade.rawState || 'null'}|${tradeClassifier.isAccepted(trade) ? 'accepted' : 'not_accepted'}`);

    if (direction === null) {
      const record = saveTrade(trade, null, 'RETRY', existing);
      counts.failed += 1;
      addEntry(record, { outcome: 'FAILED', reasonCode: 'DIRECTION_UNKNOWN', display: buildDisplay(trade, null, null) });
      continue;
    }

    const link = existing ? linksByRecord.get(existing.id) : null;
    const cls = tradeClassifier.classify(trade, direction, existing, {
      now, cutoffMs, refundSignal: refundContracts.has(trade.contractId), hasLink: Boolean(link),
    });
    if (cls.entry && cls.entry.reasonCode === 'UNKNOWN_STATE') {
      bump(unknownTypes, tradeClassifier.stateKind(trade.rawState) === 'UNKNOWN' ? `state:${trade.rawState}` : `offer:${trade.offerState}`);
    }

    if (cls.kind === 'KEEP') {
      counts[cls.count] += 1;
      ExternalRecord.update(existing.id, { lastBatchId: batch.id, lastSeenAt: stamp }, { now });
      continue;
    }
    if (cls.kind === 'IMPORT') {
      const record = saveTrade(trade, direction, 'RETRY', existing);
      toImport.push({ trade, direction, record, tracking: cls.tracking });
      continue;
    }

    // MARK (sem lançamento) ou LINKED (já ligado a um lançamento): grava o novo tracking.
    const previousTracking = existing ? existing.tracking : null;
    const record = saveTrade(trade, direction, cls.tracking, existing);
    counts[cls.count] += 1;
    if (previousTracking && FAILURE_TRACKINGS.includes(previousTracking) && !FAILURE_TRACKINGS.includes(cls.tracking)) {
      ImportBatchEntry.resolveOpenForRecord(record.id, 'IGNORED', { now });
    }
    if (cls.entry && (cls.kind === 'MARK' || previousTracking !== cls.tracking || cls.tracking === 'UNKNOWN_STATE')) {
      addEntry(record, {
        outcome: cls.entry.outcome, reasonCode: cls.entry.reasonCode, entityType: link ? link.entityType : null,
        entityId: link ? link.entityId : null, display: buildDisplay(trade, direction, null),
      });
    }
  }

  // (f) compras a importar: catálogo, casamento com manuais e criação.
  if (toImport.length) {
    const prepared = [];
    for (const entry of toImport) {
      const mapped = externalItemMapper.mapTradeItem(entry.trade.item, { findByNameKeyAnyCategory: (key) => CatalogItem.findByNameKeyAnyCategory(key) });
      if (!mapped.ok) {
        counts.failed += 1;
        addEntry(entry.record, { outcome: 'FAILED', reasonCode: mapped.reason, display: buildDisplay(entry.trade, entry.direction, null) });
        continue;
      }
      prepared.push({ ...entry, mapped });
    }
    const candidates = prepared.length ? Item.findUnlinkedPurchases(store.id, { acquiredFrom: startOfPreviousLocalDay(effectiveCutoff) }) : [];
    const matches = manualMatchService.matchPurchases(
      prepared.map(({ trade, mapped }) => ({
        key: trade.externalId,
        catalogId: mapped.catalogEntry ? mapped.catalogEntry.id : null,
        category: mapped.category,
        nameKey: normalizeSearchText(mapped.name),
        variant: mapped.variant,
        phase: (mapped.catalogEntry && mapped.catalogEntry.phase) || mapped.phase,
        floatValue: mapped.floatValue,
        paintSeed: mapped.paintSeed,
        priceCents: trade.priceCents,
        date: tradeMoment(trade),
      })),
      candidates
    );

    for (const entry of prepared) {
      const { trade, direction, record, mapped } = entry;
      const display = buildDisplay(trade, direction, mapped);
      const match = matches.get(trade.externalId) || { kind: 'NONE' };
      const mismatch = hasPriceMismatch(trade);
      if (match.kind === 'AMBIGUOUS') {
        ExternalRecord.update(record.id, { tracking: 'NEEDS_REVIEW' }, { now });
        counts.review += 1;
        addEntry(record, { outcome: 'POSSIBLE_DUPLICATE', reasonCode: null, candidateIds: match.candidateIds, display });
        continue;
      }
      if (match.kind === 'MATCH') {
        const item = Item.findById(match.itemId);
        ExternalLink.create(
          { recordId: record.id, entityType: 'ITEM_PURCHASE', entityId: item.id, linkKind: 'MATCHED', batchId: batch.id, entityUpdatedAt: item.updatedAt },
          { now }
        );
        ExternalRecord.update(record.id, { tracking: entry.tracking }, { now });
        ImportBatchEntry.resolveOpenForRecord(record.id, 'LINKED', { now });
        counts.matched += 1;
        addEntry(record, { outcome: 'MATCHED', reasonCode: mismatch ? 'PRICE_MISMATCH' : null, entityType: 'ITEM_PURCHASE', entityId: item.id, display });
        continue;
      }
      let created;
      try {
        created = itemService.createItem(externalItemMapper.buildPurchaseInput(trade, mapped, { storeId: store.id }), { now });
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        counts.failed += 1;
        addEntry(record, { outcome: 'FAILED', reasonCode: String(err.code || 'ITEM_INVALID').slice(0, 60), display });
        continue;
      }
      ExternalLink.create(
        { recordId: record.id, entityType: 'ITEM_PURCHASE', entityId: created.id, linkKind: 'CREATED', batchId: batch.id, entityUpdatedAt: created.updatedAt },
        { now }
      );
      ExternalRecord.update(record.id, { tracking: entry.tracking }, { now });
      ImportBatchEntry.resolveOpenForRecord(record.id, 'CREATED', { now });
      counts.purchasesCreated += 1;
      addEntry(record, { outcome: 'CREATED', reasonCode: mismatch ? 'PRICE_MISMATCH' : null, entityType: 'ITEM_PURCHASE', entityId: created.id, display });
    }
  }

  // (h) cursor do extrato: a transação mais nova lida.
  const cursor = newestTransactionId(read.transactions);
  Integration.update(
    SOURCE,
    {
      ...(cursor ? { lastTransactionId: cursor } : {}), lastImportAt: stamp, lastImportStatus: 'OK', lastImportErrorCode: null, autoImportPaused: false,
    },
    { now }
  );

  // (i) contagens e dados do lote.
  ImportBatch.update(batch.id, {
    tradePagesRead: read.tradePages, transactionPagesRead: read.transactionPages, purchasesCreated: counts.purchasesCreated,
    matchedCount: counts.matched, knownCount: counts.known, beforeCutoffCount: counts.beforeCutoff, notTransferredCount: counts.notTransferred,
    reviewCount: counts.review, revertedCount: counts.reverted, failedCount: counts.failed, unknownStateCount: counts.unknownState,
    deferredCount: counts.deferred, unknownTypesJson: JSON.stringify(unknownTypes), diagnosticsJson: JSON.stringify(diagnostics),
    warningsJson: JSON.stringify(warnings),
  });
  return { batchId: batch.id };
}

// A transação do extrato com a data mais recente (a primeira, em caso de empate).
function newestTransactionId(transactions) {
  let best = null;
  for (const tx of transactions) if (best === null || Date.parse(tx.createdAt) > Date.parse(best.createdAt)) best = tx;
  return best ? best.externalId : null;
}

// Confere o valor debitado no extrato (`contract_purchased`) com o preço do trade: só aviso (D297).
function hasPriceMismatch(trade) {
  const purchases = ExternalRecord.findTransactionsByContract(SOURCE, trade.contractId, ['contract_purchased']);
  return purchases.length > 0 && !purchases.some((tx) => tx.balanceOffsetCents === -trade.priceCents);
}

// --- Falha ------------------------------------------------------------------------------------------------------------

// Grava o lote FAILED (numa transação curta). Nunca lança: a falha original é a que importa.
function recordFailure({ trigger, fullScan, now, nowFn, cutoffAt, errorCode }) {
  try {
    const finishedAt = new Date(Math.max(now.getTime(), nowFn()));
    runInTransaction(() => {
      ImportBatch.create(
        { source: SOURCE, trigger, status: 'FAILED', startedAt: now.toISOString(), finishedAt: finishedAt.toISOString(), fullScan, cutoffAt, errorCode },
        { now }
      );
      Integration.update(SOURCE, { lastImportStatus: 'FAILED', lastImportErrorCode: errorCode }, { now });
    });
  } catch (err) {
    console.error('Não foi possível registrar a falha da importação.');
  }
}

// --- Execução ---------------------------------------------------------------------------------------------------------

// `now`: Date do relógio do app. `nowFn`/`sleepFn`/`fetchFn` são injetáveis (testes).
async function runImport({
  trigger = 'MANUAL', cutoffAt, fullScan = false, source = SOURCE, fetchFn, now = new Date(), nowFn = Date.now, sleepFn,
} = {}) {
  // 1. Pré-condições (síncronas, antes de qualquer rede).
  const adapter = integrationService.getAdapter(source);
  const problems = validateAdapter(adapter);
  if (problems.length) throw new Error(`Adapter inválido: ${problems.join(', ')}`);
  if (trigger !== 'MANUAL') throw new ConflictError('A importação automática ainda não está disponível.', 'IMPORT_AUTO_NOT_AVAILABLE');
  const row = integrationService.loadRow(source, { now });
  const store = requireImportStore(row);
  const apiKey = integrationService.requireApiKey(source);
  importLock.assertIdle();
  if (backupService.isBackupBusy()) {
    throw new ConflictError('Há uma operação em andamento (catálogo, cotação ou backup). Aguarde terminar e tente de novo.', 'BACKUP_BUSY');
  }
  const firstImport = row.tradesCutoffAt === null;
  let cutoffToStore = null;
  if (firstImport) cutoffToStore = cutoffService.validateCutoff(cutoffAt, { now });
  else if (cutoffAt !== undefined && cutoffAt !== null) {
    throw new ValidationError('A data de corte já foi definida.', 'IMPORT_CUTOFF_ALREADY_SET', { field: 'cutoffAt' });
  }
  const effectiveCutoff = row.tradesCutoffAt ?? cutoffToStore;

  // 2. Trava e prazo total.
  const release = importLock.acquire();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CSFLOAT_IMPORT_TOTAL_TIMEOUT_MS);
  const failure = (errorCode) => recordFailure({ trigger, fullScan, now, nowFn, cutoffAt: row.tradesCutoffAt, errorCode });
  try {
    const env = {
      adapter, apiKey, row, store, now, nowFn, sleepFn, fetchFn, trigger, fullScan, firstImport, cutoffToStore, effectiveCutoff,
      cutoffMs: Date.parse(effectiveCutoff), signal: controller.signal, deadlineAt: nowFn() + CSFLOAT_IMPORT_TOTAL_TIMEOUT_MS,
    };

    // 3 a 5. Leitura: nada é gravado até aqui.
    let read;
    try {
      const account = await adapter.getAccount({
        apiKey, fetchFn, totalSignal: env.signal, totalDeadlineAt: env.deadlineAt, nowFn, sleepFn,
      });
      integrationService.assertSameAccount(account, row);
      env.account = account;
      env.steamId = account.steamId; // só em memória; nunca é gravado (D309)
      const tx = await readTransactions(env);
      const tr = await readTrades(env, { transactions: tx.transactions });
      read = {
        transactions: tx.transactions, invalidTransactions: tx.invalid, transactionPages: tx.pages, trades: tr.trades, invalidTrades: tr.invalid, tradePages: tr.pages,
        orderBroken: tr.orderBroken, warnings: [...tx.warnings, ...tr.warnings],
      };
    } catch (err) {
      if (err instanceof UpstreamError) failure(err.code);
      else if (!(err instanceof AppError)) failure('INTERNAL_ERROR');
      throw err;
    }

    // 6 a 9. Aplicação, numa única transação.
    env.finishedAt = new Date(Math.max(now.getTime(), nowFn()));
    let applied;
    try {
      applied = runInTransaction(() => applyImport(env, read));
    } catch (err) {
      failure('INTERNAL_ERROR');
      throw err;
    }
    return { batch: getBatchView(applied.batchId) };
  } finally {
    clearTimeout(timer);
    release();
  }
}

// --- Consultas e desfazer ---------------------------------------------------------------------------------------------

function catalogMapForEntries(displays) {
  const ids = displays.map((d) => d && d.catalogId).filter(Boolean);
  return new Map(catalogService.getCatalogItemsByIds(ids).map((c) => [c.id, c]));
}

function catalogMapForRawEntries(entries) {
  return catalogMapForEntries(entries.map((e) => importViews.parseJson(e.displayJson, {})));
}

function isUndoable(batch) {
  const latest = ImportBatch.findLatestUndoable(SOURCE);
  return Boolean(latest && latest.id === batch.id && batch.status === 'DONE');
}

function getBatchView(batchId) {
  const batch = ImportBatch.findById(batchId);
  if (!batch) throw new NotFoundError('Importação não encontrada.', 'IMPORT_BATCH_NOT_FOUND');
  const entries = ImportBatchEntry.listByBatch(batchId);
  return importViews.toBatchView(batch, entries, {
    catalogById: catalogMapForRawEntries(entries),
    undoable: isUndoable(batch),
    openEntriesCount: ImportBatchEntry.countOpenByBatch([batchId]).get(batchId) || 0,
  });
}

function listBatches({ limit = IMPORT_BATCHES_PAGE_SIZE, before = null } = {}) {
  const rows = ImportBatch.list(SOURCE, { limit: limit + 1, before });
  const page = rows.slice(0, limit);
  const openByBatch = ImportBatchEntry.countOpenByBatch(page.map((b) => b.id));
  const latest = ImportBatch.findLatestUndoable(SOURCE);
  return {
    batches: page.map((b) =>
      importViews.toBatchSummary(b, { undoable: Boolean(latest && latest.id === b.id), openEntriesCount: openByBatch.get(b.id) || 0 })
    ),
    nextBefore: rows.length > limit ? page[page.length - 1].id : null,
  };
}

function listOpenEntries() {
  const entries = ImportBatchEntry.listOpen();
  const catalogById = catalogMapForRawEntries(entries);
  return { entries: entries.map((e) => importViews.toEntryView(e, catalogById)) };
}

function getUndoPreview(batchId) {
  return undoService.preview(batchId);
}

function undoBatch(batchId, { confirmWarnings = false, now = new Date() } = {}) {
  undoService.undo(batchId, { confirmWarnings, now });
  return getBatchView(batchId);
}

module.exports = {
  SOURCE,
  isImportInProgress,
  runImport,
  getBatchView,
  listBatches,
  listOpenEntries,
  getUndoPreview,
  undoBatch,
  directionOf,
  startOfPreviousLocalDay,
};

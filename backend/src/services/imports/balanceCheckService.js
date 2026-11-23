'use strict';

// Conferência do saldo com o CSFloat (9.7, D313, E9-Q16, E9-Q17). Só leitura e sob demanda: nunca grava nada (a conferência
// oficial continua sendo a da 8.6, que o usuário registra se quiser).
//   - checkBalance: uma chamada (GET /me). Compara o disponível e o pendente calculados da loja da integração com o `balance` e o
//     `pending_balance` do CSFloat, descontando o "em trânsito" conhecido pelos registros já lidos.
//   - explainDifference: lê o extrato inteiro e lista as transações sem lançamento no app (antes do corte, ignoradas, multas...).
const ExternalRecord = require('../../models/ExternalRecord');
const ExternalLink = require('../../models/ExternalLink');
const Store = require('../../models/Store');
const { ConflictError, ValidationError } = require('../../errors/AppError');
const { CSFLOAT_IMPORT_TOTAL_TIMEOUT_MS, CSFLOAT_PAGE_LIMIT, CSFLOAT_PAGE_DELAY_MS } = require('../../config/constants');
const integrationService = require('../integrationService');
const storeBalanceService = require('../storeBalanceService');
const { waitForRateLimit } = require('./adapters/csfloatHttp');
const scanPolicy = require('./scanPolicy');
const importLock = require('./importLock');

const SOURCE = 'CSFLOAT';
const BID_TYPES = Object.freeze(['bid_posted', 'bid_accepted']);
const MAX_LISTED = 200;
const WAITING = Object.freeze(['WAITING_TRANSFER']);

function requireStore(row) {
  const store = row.storeId ? Store.findById(row.storeId) : null;
  if (!store) throw new ConflictError('Crie, em Lojas, uma loja em US$ chamada "CSFloat".', 'IMPORT_STORE_REQUIRED');
  if (store.currency !== 'USD') {
    throw new ValidationError('A loja da integração precisa ser em dólar (US$).', 'IMPORT_STORE_CURRENCY_NOT_ALLOWED', { field: 'storeId' });
  }
  return store;
}

// "Em trânsito" (D313), função pura sobre os registros já gravados:
//   - compras pagas e ainda não transferidas: o CSFloat já debitou (contract_purchased), o app ainda não importou;
//   - vendas pagas e ainda não transferidas: o CSFloat já creditou no pendente (contract_sold), o app ainda não importou;
//   - lances abertos: bid_posted sem o bid_accepted correspondente (reserva do saldo; os pares somam zero).
// `transactions`: registros TRANSACTION; `tradesByContract`: Map contractId -> registro do trade.
function computeInTransit(transactions, tradesByContract) {
  let purchasesCents = 0;
  let salesPendingCents = 0;
  let bidsNet = 0;
  let count = 0;
  const waiting = (contractId) => {
    const trade = contractId ? tradesByContract.get(contractId) : null;
    return !trade || WAITING.includes(trade.tracking);
  };
  for (const tx of transactions) {
    if (tx.txType === 'contract_purchased' && waiting(tx.contractId)) {
      purchasesCents += Math.abs(tx.balanceOffsetCents ?? 0);
      count += 1;
    } else if (tx.txType === 'contract_sold' && waiting(tx.contractId)) {
      salesPendingCents += tx.pendingOffsetCents ?? 0;
      count += 1;
    } else if (BID_TYPES.includes(tx.txType)) {
      bidsNet += tx.balanceOffsetCents ?? 0;
    }
  }
  const openBidsCents = bidsNet < 0 ? -bidsNet : 0;
  return { purchasesCents, salesPendingCents, openBidsCents, count };
}

// Comparação (função pura). O esperado no CSFloat = o calculado no app − o que já saiu lá e ainda não entrou aqui.
function compareBalances({ app, csfloat, inTransit }) {
  const expected = {
    availableCents: app.availableCents - inTransit.purchasesCents - inTransit.openBidsCents,
    pendingCents: app.pendingCents + inTransit.salesPendingCents,
  };
  const difference = {
    availableCents: csfloat.balanceCents === null ? null : csfloat.balanceCents - expected.availableCents,
    pendingCents: csfloat.pendingBalanceCents === null ? null : csfloat.pendingBalanceCents - expected.pendingCents,
  };
  return { expected, difference, explained: difference.availableCents === 0 && difference.pendingCents === 0 };
}

// "Conferir com o CSFloat": uma chamada ao /me.
async function checkBalance({ fetchFn, nowFn, now = new Date() } = {}) {
  const row = integrationService.loadRow(SOURCE, { now });
  const store = requireStore(row);
  const account = await integrationService.fetchAccount(SOURCE, { fetchFn, nowFn });
  integrationService.assertSameAccount(account, row);
  const current = storeBalanceService.listCurrent({ now }).stores.find((s) => s.storeId === store.id);
  const app = { availableCents: current ? current.availableCents : 0, pendingCents: current ? current.pending.cents : 0 };
  const csfloat = { balanceCents: account.balanceCents, pendingBalanceCents: account.pendingBalanceCents };
  const records = ExternalRecord.listTrades(SOURCE);
  const tradesByContract = new Map(records.filter((r) => r.contractId).map((r) => [r.contractId, r]));
  const inTransit = computeInTransit(ExternalRecord.listTransactions(SOURCE), tradesByContract);
  return {
    checkedAt: now.toISOString(),
    storeId: store.id,
    store: app,
    csfloat,
    inTransit,
    ...compareBalances({ app, csfloat, inTransit }),
    feeCheck: integrationService.buildFeeCheck(account, store),
  };
}

// Por que a transação não tem lançamento no app (função pura). `record`: o registro gravado da transação (ou null); `trade`: o
// trade do mesmo contrato (ou null); `link`: o vínculo do registro (transação) ou do trade.
function unmatchedReason(tx, { record, trade, txLinked, tradeLink }) {
  if (BID_TYPES.includes(tx.type)) return null; // lances: só o saldo líquido (aberto) importa
  if (tx.type === 'deposit' || tx.type === 'withdrawal') {
    if (txLinked) return null;
    if (!record) return 'NOT_READ';
    if (record.tracking === 'BEFORE_CUTOFF') return 'BEFORE_CUTOFF';
    if (record.tracking === 'IGNORED') return 'IGNORED';
    if (record.tracking === 'REMOVED_IN_APP') return 'REMOVED_IN_APP';
    return 'NOT_IMPORTED';
  }
  if (tx.type === 'contract_purchased') {
    if (tradeLink && tradeLink.entityType === 'ITEM_PURCHASE') return null;
  } else if (tx.type === 'contract_sold' || tx.type === 'trade_verified') {
    if (tradeLink && tradeLink.entityType === 'ITEM_SALE') return null;
  } else if (tx.type === 'fine') {
    return 'FINE';
  } else if (['contract_purchase_refund', 'contract_sale_refund', 'rollback'].includes(tx.type)) {
    return 'REFUND';
  } else {
    return 'UNKNOWN_TYPE';
  }
  if (!trade) return 'NOT_READ';
  if (trade.tracking === 'BEFORE_CUTOFF') return 'BEFORE_CUTOFF';
  if (trade.tracking === 'WAITING_TRANSFER') return 'IN_TRANSIT';
  if (trade.tracking === 'IGNORED') return 'IGNORED';
  if (trade.tracking === 'REMOVED_IN_APP') return 'REMOVED_IN_APP';
  return 'NOT_IMPORTED';
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// "Explicar diferença": lê o extrato inteiro (todas as páginas) e lista o que não tem lançamento no app.
async function explainDifference({ fetchFn, nowFn = Date.now, sleepFn, now = new Date() } = {}) {
  if (importLock.isImportInProgress()) throw new ConflictError('Já há uma importação em andamento. Aguarde terminar.', 'IMPORT_IN_PROGRESS');
  const row = integrationService.loadRow(SOURCE, { now });
  requireStore(row);
  const apiKey = integrationService.requireApiKey(SOURCE);
  const adapter = integrationService.getAdapter(SOURCE);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CSFLOAT_IMPORT_TOTAL_TIMEOUT_MS);
  const deadlineAt = nowFn() + CSFLOAT_IMPORT_TOTAL_TIMEOUT_MS;
  const transactions = [];
  let pages = 0;
  try {
    const account = await adapter.getAccount({ apiKey, fetchFn, totalSignal: controller.signal, totalDeadlineAt: deadlineAt, nowFn, sleepFn });
    integrationService.assertSameAccount(account, row);
    for (let page = 0; ; page += 1) {
      const result = await adapter.pageTransactions({
        apiKey, page, limit: CSFLOAT_PAGE_LIMIT, order: 'desc', fetchFn, totalSignal: controller.signal, totalDeadlineAt: deadlineAt, nowFn, sleepFn,
      });
      pages += 1;
      for (const item of result.transactions) if (item.ok) transactions.push(item.transaction);
      const decision = scanPolicy.shouldStopTransactions({
        page, limit: CSFLOAT_PAGE_LIMIT, count: result.count, pageSize: result.transactions.length, oldestMs: NaN, fullScan: true,
      });
      if (decision.stop) break;
      await waitForRateLimit(result.rateLimit, { totalSignal: controller.signal, totalDeadlineAt: deadlineAt, nowFn, sleepFn });
      await (sleepFn || defaultSleep)(CSFLOAT_PAGE_DELAY_MS, controller.signal);
    }
  } finally {
    clearTimeout(timer);
  }

  const stored = ExternalRecord.findManyByExternalIds(SOURCE, 'TRANSACTION', transactions.map((t) => t.externalId));
  const trades = ExternalRecord.listTrades(SOURCE);
  const tradesByContract = new Map(trades.filter((r) => r.contractId).map((r) => [r.contractId, r]));
  const links = ExternalLink.findByRecordIds([...stored.values(), ...trades].map((r) => r.id));
  const byReason = new Map();
  const items = [];
  let sumBalanceCents = 0;
  let sumPendingCents = 0;
  let bidsNet = 0;
  let totalBalanceCents = 0;
  let totalPendingCents = 0;
  for (const tx of transactions) {
    totalBalanceCents += tx.balanceOffsetCents;
    totalPendingCents += tx.pendingOffsetCents;
    if (BID_TYPES.includes(tx.type)) {
      bidsNet += tx.balanceOffsetCents;
      continue;
    }
    const record = stored.get(tx.externalId) || null;
    const trade = tx.contractId ? tradesByContract.get(tx.contractId) || null : null;
    const reason = unmatchedReason(tx, {
      record, trade, txLinked: Boolean(record && links.get(record.id)), tradeLink: trade ? links.get(trade.id) || null : null,
    });
    if (!reason) continue;
    sumBalanceCents += tx.balanceOffsetCents;
    sumPendingCents += tx.pendingOffsetCents;
    const key = `${reason}|${tx.type}`;
    const group = byReason.get(key) || { reason, type: tx.type, count: 0, balanceCents: 0, pendingCents: 0 };
    group.count += 1;
    group.balanceCents += tx.balanceOffsetCents;
    group.pendingCents += tx.pendingOffsetCents;
    byReason.set(key, group);
    if (items.length < MAX_LISTED) {
      items.push({ type: tx.type, reason, createdAt: tx.createdAt, balanceOffsetCents: tx.balanceOffsetCents, pendingOffsetCents: tx.pendingOffsetCents });
    }
  }
  return {
    checkedAt: now.toISOString(),
    pagesRead: pages,
    transactionsRead: transactions.length,
    // Soma de todo o extrato (dá o mesmo total do /me, D313).
    totals: { balanceCents: totalBalanceCents, pendingCents: totalPendingCents },
    groups: [...byReason.values()].sort((a, b) => Math.abs(b.balanceCents + b.pendingCents) - Math.abs(a.balanceCents + a.pendingCents)),
    unmatched: items,
    truncated: items.length >= MAX_LISTED,
    sumBalanceCents,
    sumPendingCents,
    openBidsCents: bidsNet < 0 ? -bidsNet : 0,
  };
}

module.exports = { computeInTransit, compareBalances, unmatchedReason, checkBalance, explainDifference };

'use strict';

// Lucro da venda (2.5) e lucro real (2.10).
const { toUsdCents, isValidFxRate, approxCounterpart } = require('./currencyService');
const { roundCents } = require('./fees/rounding');
const { WARNING_FX, WARNINGS } = require('./warnings');
const { buildCurrentBalances } = require('./storeBalanceService');
const Setting = require('../models/Setting');
const Item = require('../models/Item');
const Store = require('../models/Store');
const Deposit = require('../models/Deposit');
const Withdrawal = require('../models/Withdrawal');
const StoreBalance = require('../models/StoreBalance');

const sumOf = (values) => values.reduce((acc, v) => acc + v, 0);
const addNullable = (a, b) => (a === null || b === null ? null : a + b);

// netReceived − custo, ambos em USD com a cotação gravada no item; null se não vendido.
function computeSaleProfitUsdCents(item) {
  if (item.status !== 'VENDIDO') return null;
  const net = toUsdCents(item.netReceivedCents, item.saleCurrency, item.fxRateAtSale);
  const cost = toUsdCents(item.purchasePriceCents, item.purchaseCurrency, item.fxRateAtPurchase);
  return net - cost;
}

// Valores da venda em USD (cotação gravada de cada lado, 2.9) e "≈ R$" pela cotação atual (D125); null se não vendido.
function buildSaleInfo(item, usdBrlRate = null) {
  if (item.status !== 'VENDIDO') return null;
  const salePriceUsdCents = toUsdCents(item.salePriceCents, item.saleCurrency, item.fxRateAtSale);
  const netReceivedUsdCents = toUsdCents(item.netReceivedCents, item.saleCurrency, item.fxRateAtSale);
  const purchaseCostUsdCents = toUsdCents(item.purchasePriceCents, item.purchaseCurrency, item.fxRateAtPurchase);
  const fxUsed = {
    sale: item.saleCurrency === 'BRL' ? item.fxRateAtSale : null,
    purchase: item.purchaseCurrency === 'BRL' ? item.fxRateAtPurchase : null,
  };
  const approx = (cents) => {
    const r = approxCounterpart(cents, 'USD', usdBrlRate);
    return r ? r.cents : null;
  };
  return {
    salePriceUsdCents,
    netReceivedUsdCents,
    purchaseCostUsdCents,
    fxUsed,
    usesRecordedFx: fxUsed.sale !== null || fxUsed.purchase !== null,
    approxBrl: {
      salePrice: approx(salePriceUsdCents),
      netReceived: approx(netReceivedUsdCents),
      purchaseCost: approx(purchaseCostUsdCents),
      profit: approx(netReceivedUsdCents - purchaseCostUsdCents),
    },
  };
}

// Estoque pelo custo (P1): BRL nominal; USD × cotação das configurações.
function estimateStockBrl(stockItems, usdBrlRate) {
  let total = 0;
  for (const item of stockItems.filter((i) => i.status === 'EM_ESTOQUE')) {
    if (item.purchaseCurrency === 'BRL') {
      total += item.purchasePriceCents;
    } else if (item.purchasePriceCents === 0) {
      continue;
    } else if (isValidFxRate(usdBrlRate)) {
      total += roundCents(item.purchasePriceCents * usdBrlRate, 'ROUND');
    } else {
      return { totalBrlCents: null, warning: WARNING_FX };
    }
  }
  return { totalBrlCents: total, warning: null };
}

// Lucro real (2.10, D205, D206). `balances` é o resultado de `storeBalanceService.buildCurrentBalances` (uma linha por
// loja, com disponível, pendente e liberado após o último registro já convertidos, cada parcela com ROUND, T82).
// Lojas não sacáveis entram como as demais; a soma "não sacável" é só informativa e não é somada de novo (D212).
// Avisos (T48): objetos { source, storeId, storeName, code, text }, sem concatenar texto; o frontend traduz pelo código.
function computeRealProfit(input = {}) {
  const deposits = input.deposits ?? [];
  const withdrawals = input.withdrawals ?? [];
  const balanceRows = (input.balances && input.balances.stores) || [];
  const stockItems = input.stockItems ?? [];
  const settings = input.settings ?? {};
  const usdBrlRate = settings.usdBrlRate;
  const warnings = [];

  const depositsBrlCents = sumOf(deposits.map((d) => d.amountBrlCents));
  const withdrawalsBrlCents = sumOf(withdrawals.map((w) => w.amountBrlCents));

  const sumRows = (pick) => balanceRows.reduce((acc, row) => addNullable(acc, pick(row)), 0);
  const platformBalanceEstimatedBrlCents = sumRows((row) => row.availableEstimatedBrlCents);
  const pendingBalanceEstimatedBrlCents = sumRows((row) => row.pending.estimatedBrlCents);
  const releasedAfterBalanceEstimatedBrlCents = sumRows((row) => row.releasedAfterBalance.estimatedBrlCents);
  const nextReleases = balanceRows.map((row) => row.pending.nextReleaseAt).filter((value) => value !== null).sort();

  for (const row of balanceRows) {
    const missingFx = [row.availableEstimatedBrlCents, row.pending.estimatedBrlCents, row.releasedAfterBalance.estimatedBrlCents]
      .some((value) => value === null);
    const storeWarning = (warning) => ({
      source: 'STORE', storeId: row.storeId, storeName: row.storeName, code: warning.code, text: warning.text,
    });
    if (missingFx) warnings.push(storeWarning(WARNINGS.FX_NOT_CONFIGURED));
    if (row.outdated) warnings.push(storeWarning(WARNINGS.BALANCE_MAYBE_OUTDATED));
  }

  const stock = estimateStockBrl(stockItems, usdBrlRate);
  if (stock.warning) {
    warnings.push({ source: 'STOCK', storeId: null, storeName: null, code: WARNINGS.FX_NOT_CONFIGURED.code, text: stock.warning });
  }
  const stockEstimatedBrlCents = stock.totalBrlCents;

  const parts = [platformBalanceEstimatedBrlCents, pendingBalanceEstimatedBrlCents, releasedAfterBalanceEstimatedBrlCents, stockEstimatedBrlCents];
  const realProfitBrlCents = parts.every((part) => part !== null) ? withdrawalsBrlCents + sumOf(parts) - depositsBrlCents : null;
  const realProfitUsdCentsApprox =
    realProfitBrlCents === null || !isValidFxRate(usdBrlRate) ? null : toUsdCents(realProfitBrlCents, 'BRL', usdBrlRate);

  return {
    depositsBrlCents,
    withdrawalsBrlCents,
    platformBalanceEstimatedBrlCents,
    pendingBalanceEstimatedBrlCents,
    releasedAfterBalanceEstimatedBrlCents,
    nextReleaseAt: nextReleases.length ? nextReleases[0] : null,
    stockEstimatedBrlCents,
    realProfitBrlCents,
    realProfitUsdCentsApprox,
    withdrawnVsDeposited: {
      withdrawnBrlCents: withdrawalsBrlCents,
      depositedBrlCents: depositsBrlCents,
      ratio: depositsBrlCents === 0 ? null : withdrawalsBrlCents / depositsBrlCents,
    },
    warnings,
  };
}

// Orquestração de GET /api/profit/summary (D205): total acumulado, sem filtro de período.
function getProfitSummary({ now = new Date() } = {}) {
  const settings = Setting.get();
  const items = Item.findAll();
  const withdrawals = Withdrawal.findAll();
  const deposits = Deposit.findAll();
  const balances = buildCurrentBalances({
    stores: Store.findAll(), latestBalances: StoreBalance.findLatestAll(), items, withdrawals, settings, now,
  });
  const stockItems = items.filter((item) => item.status === 'EM_ESTOQUE');
  const profit = computeRealProfit({ deposits, withdrawals, balances, stockItems, settings });
  const sumCount = (pick) => balances.stores.reduce((acc, row) => acc + pick(row), 0);
  return {
    ...profit,
    balancesByStore: balances.stores,
    counts: {
      deposits: deposits.length,
      withdrawals: withdrawals.length,
      legacyWithdrawals: withdrawals.filter((w) => w.storeId === null || w.storeId === undefined).length,
      stockItems: stockItems.length,
      pendingSales: sumCount((row) => row.pending.count),
      releasedAfterBalanceSales: sumCount((row) => row.releasedAfterBalance.count),
    },
    fx: {
      usdBrlRate: isValidFxRate(settings.usdBrlRate) ? settings.usdBrlRate : null,
      source: settings.usdBrlRateSource ?? null,
      updatedAt: settings.usdBrlRateUpdatedAt ?? null,
      quotedAt: settings.rateQuotedAt ?? null,
    },
    computedAt: now.toISOString(),
  };
}

module.exports = { computeSaleProfitUsdCents, buildSaleInfo, computeRealProfit, getProfitSummary };

'use strict';

// Lucro da venda (2.5) e lucro real (2.10).
const { toUsdCents } = require('./currencyService');
const { roundCents } = require('./fees/rounding');
const { estimateBalanceBrl } = require('./withdrawalService');

const WARNING_FX = 'cotação não configurada';

const validRate = (rate) => typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
const sumOf = (values) => values.reduce((acc, v) => acc + v, 0);
const addNullable = (a, b) => (a === null || b === null ? null : a + b);

// netReceived − custo, ambos em USD com a cotação gravada no item; null se não vendido.
function computeSaleProfitUsdCents(item) {
  if (item.status !== 'VENDIDO') return null;
  const net = toUsdCents(item.netReceivedCents, item.saleCurrency, item.fxRateAtSale);
  const cost = toUsdCents(item.purchasePriceCents, item.purchaseCurrency, item.fxRateAtPurchase);
  return net - cost;
}

// Estoque pelo custo (P1): BRL nominal; USD × cotação das configurações.
function estimateStockBrl(stockItems, usdBrlRate) {
  let total = 0;
  for (const item of stockItems.filter((i) => i.status === 'EM_ESTOQUE')) {
    if (item.purchaseCurrency === 'BRL') {
      total += item.purchasePriceCents;
    } else if (item.purchasePriceCents === 0) {
      continue;
    } else if (validRate(usdBrlRate)) {
      total += roundCents(item.purchasePriceCents * usdBrlRate, 'ROUND');
    } else {
      return { totalBrlCents: null, warning: WARNING_FX };
    }
  }
  return { totalBrlCents: total, warning: null };
}

function computeRealProfit({ deposits = [], withdrawals = [], platformBalances = [], stockItems = [], settings = {} }) {
  const usdBrlRate = settings ? settings.usdBrlRate : null;
  const warnings = [];

  const depositsBrlCents = sumOf(deposits.map((d) => d.amountBrlCents));
  const withdrawalsBrlCents = sumOf(withdrawals.map((w) => w.amountBrlCents));

  const balancesByStore = platformBalances.map(({ store, balance, recentWithdrawals }) => {
    const balanceCents = balance ? balance.balanceCents : 0;
    const est = estimateBalanceBrl({ balanceCents, store, settings, recentWithdrawals });
    if (est.warning) warnings.push(`${store.name}: ${est.warning}`);
    return {
      storeId: store.id,
      storeName: store.name,
      balanceCents,
      currency: store.currency,
      estimatedBrlCents: est.estimatedBrlCents,
      withdrawable: est.withdrawable,
      warning: est.warning,
    };
  });

  const sumBalances = (withdrawable) =>
    balancesByStore
      .filter((b) => b.withdrawable === withdrawable)
      .reduce((acc, b) => addNullable(acc, b.estimatedBrlCents), 0);
  const withdrawableBalanceBrlCents = sumBalances(true);
  const nonWithdrawableBalanceBrlCents = sumBalances(false);

  const stock = estimateStockBrl(stockItems, usdBrlRate);
  if (stock.warning) warnings.push(`Estoque: ${stock.warning}`);
  const stockEstimatedBrlCents = stock.totalBrlCents;

  const withdrawableRealProfitBrlCents =
    withdrawableBalanceBrlCents === null || stockEstimatedBrlCents === null
      ? null
      : withdrawalsBrlCents + withdrawableBalanceBrlCents + stockEstimatedBrlCents - depositsBrlCents;
  const realProfitBrlCents = addNullable(withdrawableRealProfitBrlCents, nonWithdrawableBalanceBrlCents);

  const toApproxUsd = (brl) => (brl === null || !validRate(usdBrlRate) ? null : toUsdCents(brl, 'BRL', usdBrlRate));

  return {
    depositsBrlCents,
    withdrawalsBrlCents,
    platformBalanceEstimatedBrlCents: addNullable(withdrawableBalanceBrlCents, nonWithdrawableBalanceBrlCents),
    withdrawableBalanceBrlCents,
    nonWithdrawableBalanceBrlCents,
    stockEstimatedBrlCents,
    realProfitBrlCents,
    withdrawableRealProfitBrlCents,
    realProfitUsdCentsApprox: toApproxUsd(realProfitBrlCents),
    withdrawableRealProfitUsdCentsApprox: toApproxUsd(withdrawableRealProfitBrlCents),
    balancesByStore,
    withdrawnVsDeposited: {
      withdrawnBrlCents: withdrawalsBrlCents,
      depositedBrlCents: depositsBrlCents,
      ratio: depositsBrlCents === 0 ? null : withdrawalsBrlCents / depositsBrlCents,
    },
    warnings,
  };
}

module.exports = { computeSaleProfitUsdCents, computeRealProfit };

'use strict';

// Lucro da venda (2.5) e lucro real em USD (2.10, D226).
const { toUsdCents, isValidFxRate, approxCounterpart, approxOf, fxFromSettings, displayCurrencyOf } = require('./currencyService');
const { WARNINGS } = require('./warnings');
const { depositBaseAmount } = require('./depositService');
const { withdrawalBaseAmount } = require('./withdrawalService');
const { buildCurrentBalances } = require('./storeBalanceService');
const { isOffSale } = require('./inventoryAgingService');
const { EMPTY_COST_INDEX } = require('./operations/costService');
const operationContext = require('./operations/operationContext');
const Setting = require('../models/Setting');
const Item = require('../models/Item');
const Store = require('../models/Store');
const Deposit = require('../models/Deposit');
const Withdrawal = require('../models/Withdrawal');
const StoreBalance = require('../models/StoreBalance');
const FxRate = require('../models/FxRate');

const addNullable = (a, b) => (a === null || b === null ? null : a + b);

// netReceived − custo, ambos em USD com a cotação gravada no item; null se não vendido. `inheritedUsdCents`: o que a unidade
// recebeu de componentes aplicados do estoque (custo efetivo, D362); 0 sem operações.
function computeSaleProfitUsdCents(item, { inheritedUsdCents = 0 } = {}) {
  if (item.status !== 'VENDIDO') return null;
  const net = toUsdCents(item.netReceivedCents, item.saleCurrency, item.fxRateAtSale);
  const cost = toUsdCents(item.purchasePriceCents, item.purchaseCurrency, item.fxRateAtPurchase);
  return net - cost - inheritedUsdCents;
}

// Valores da venda em USD (cotação gravada de cada lado, 2.9) e "≈" na moeda de conversão pela cotação atual (D125); null se não vendido.
// `fx`: contexto de conversão ({ displayCurrency, rates }) ou, no legado, a cotação do BRL.
function buildSaleInfo(item, fx = null, { inheritedUsdCents = 0 } = {}) {
  if (item.status !== 'VENDIDO') return null;
  const salePriceUsdCents = toUsdCents(item.salePriceCents, item.saleCurrency, item.fxRateAtSale);
  const netReceivedUsdCents = toUsdCents(item.netReceivedCents, item.saleCurrency, item.fxRateAtSale);
  const ownCostUsdCents = toUsdCents(item.purchasePriceCents, item.purchaseCurrency, item.fxRateAtPurchase);
  const purchaseCostUsdCents = ownCostUsdCents + inheritedUsdCents; // custo efetivo (D362)
  const fxUsed = {
    sale: item.saleCurrency !== 'USD' ? item.fxRateAtSale : null,
    purchase: item.purchaseCurrency !== 'USD' ? item.fxRateAtPurchase : null,
  };
  const approx = (cents) => {
    const r = approxCounterpart(cents, 'USD', fx);
    return r ? r.cents : null;
  };
  return {
    salePriceUsdCents,
    netReceivedUsdCents,
    purchaseCostUsdCents,
    ownCostUsdCents,
    inheritedCostUsdCents: inheritedUsdCents,
    fxUsed,
    usesRecordedFx: fxUsed.sale !== null || fxUsed.purchase !== null,
    approxCurrency: displayCurrencyOf(fx),
    approx: {
      salePrice: approx(salePriceUsdCents),
      netReceived: approx(netReceivedUsdCents),
      purchaseCost: approx(purchaseCostUsdCents),
      profit: approx(netReceivedUsdCents - purchaseCostUsdCents),
    },
  };
}

// Estoque pelo custo em USD (D225, D226): USD nominal; BRL pela cotação gravada no item (2.9, estimado); GANHEI 0.
// Total nulo só se um item em BRL não tiver cotação gravada (o CHECK da v3 impede, é só salvaguarda).
// Pelo custo efetivo (D362): o custo próprio mais o das unidades consumidas que a unidade recebeu (`costIndex`; sem operações = o próprio).
function estimateStockUsd(stockItems, { costIndex = EMPTY_COST_INDEX } = {}) {
  let totalUsdCents = 0;
  let estimated = false;
  for (const item of stockItems.filter((i) => i.status === 'EM_ESTOQUE')) {
    const cost = costIndex.effectiveOf(item);
    if (cost.estimated) estimated = true;
    totalUsdCents = cost.effectiveUsdCents === null || totalUsdCents === null ? null : totalUsdCents + cost.effectiveUsdCents;
  }
  return { totalUsdCents, estimated };
}

// Estoque pelo custo dividido em à venda e holding (8.9, D283), pela mesma regra de estimateStockUsd.
// O total continua sendo o de estimateStockUsd (o lucro real não muda).
function splitStockUsd(stockItems, { costIndex = EMPTY_COST_INDEX } = {}) {
  const inStock = stockItems.filter((i) => i.status === 'EM_ESTOQUE');
  const part = (items) => ({ ...estimateStockUsd(items, { costIndex }), count: items.length });
  return {
    forSale: part(inStock.filter((i) => !isOffSale(i))),
    offSale: part(inStock.filter((i) => isOffSale(i))),
  };
}

// Lucro real em USD (2.10, D226, D229).
// lucro = saques líquidos + saldo disponível calculado + pendente + estoque - aportes (Revisão 22, D245). Todos os aportes
// e saques contam, de qualquer data.
// `balances` é o resultado de `storeBalanceService.buildCurrentBalances` (uma linha por loja, já em USD, cada parcela com
// ROUND, T82). `stores` resolve a moeda dos aportes e saques. O valor em R$ informativo de aportes e saques não entra.
// Lojas não sacáveis entram como as demais; a soma "não sacável" é só informativa (D212).
// Avisos (T48): objetos { source, storeId, storeName, code, text }; o frontend traduz pelo código.
function computeRealProfit(input = {}) {
  const deposits = input.deposits ?? [];
  const withdrawals = input.withdrawals ?? [];
  const stores = input.stores ?? [];
  const balanceRows = (input.balances && input.balances.stores) || [];
  const stockItems = input.stockItems ?? [];
  const settings = input.settings ?? {};
  const costIndex = input.costIndex ?? EMPTY_COST_INDEX;
  const fx = fxFromSettings(settings);
  const storeById = new Map(stores.map((store) => [store.id, store]));
  const storeOf = (record) => (record.storeId === null || record.storeId === undefined ? null : storeById.get(record.storeId) ?? null);
  const warnings = [];

  const sumParts = (parts) => ({
    usdCents: parts.reduce((acc, part) => addNullable(acc, part.usdCents), 0),
    estimated: parts.some((part) => part.estimated),
  });
  const deposited = sumParts(deposits.map((d) => depositBaseAmount(d, storeOf(d), fx)));
  const withdrawn = sumParts(withdrawals.map((w) => withdrawalBaseAmount(w, storeOf(w), fx)));

  const sumRows = (pick) => balanceRows.reduce((acc, row) => addNullable(acc, pick(row)), 0);
  const platformBalanceUsdCents = sumRows((row) => row.availableUsdCents);
  const pendingBalanceUsdCents = sumRows((row) => row.pending.usdCents);
  // Os flags por parcela vêm de buildCurrentBalances (toUsdBase, D225): não se recalcula a regra aqui.
  const platformEstimated = balanceRows.some((row) => row.availableEstimated === true);
  const pendingEstimated = balanceRows.some((row) => row.pending.estimated === true);
  const nextReleases = balanceRows.map((row) => row.pending.nextReleaseAt).filter((value) => value !== null).sort();
  const lastReleases = balanceRows.map((row) => row.pending.lastReleaseAt).filter((value) => value !== null && value !== undefined).sort();

  for (const row of balanceRows) {
    const missingFx = [row.availableUsdCents, row.pending.usdCents].some((value) => value === null);
    const storeWarning = (warning) => ({
      source: 'STORE', storeId: row.storeId, storeName: row.storeName, code: warning.code, text: warning.text,
    });
    if (missingFx) warnings.push(storeWarning(WARNINGS.FX_NOT_CONFIGURED));
    if (row.negative) warnings.push(storeWarning(WARNINGS.COMPUTED_BALANCE_NEGATIVE));
    if (row.ignored && row.ignored.currencyMismatch > 0) warnings.push(storeWarning(WARNINGS.BALANCE_CURRENCY_MISMATCH));
  }
  const fxWarning = (source) => ({ source, storeId: null, storeName: null, code: WARNINGS.FX_NOT_CONFIGURED.code, text: WARNINGS.FX_NOT_CONFIGURED.text });
  if (deposited.usdCents === null) warnings.push(fxWarning('DEPOSITS'));
  if (withdrawn.usdCents === null) warnings.push(fxWarning('WITHDRAWALS'));

  const stock = estimateStockUsd(stockItems, { costIndex });
  const stockUsdCents = stock.totalUsdCents;
  const stockSplit = splitStockUsd(stockItems, { costIndex });

  const parts = [withdrawn.usdCents, platformBalanceUsdCents, pendingBalanceUsdCents, stockUsdCents, deposited.usdCents];
  const realProfitUsdCents = parts.every((part) => part !== null)
    ? withdrawn.usdCents + platformBalanceUsdCents + pendingBalanceUsdCents + stockUsdCents - deposited.usdCents
    : null;

  const estimatedParts = {
    deposits: deposited.estimated,
    withdrawals: withdrawn.estimated,
    platformBalance: platformEstimated,
    pendingBalance: pendingEstimated,
    stock: stock.estimated,
  };
  const approx = (usdCents) => approxOf(usdCents, fx);
  const ratio = deposited.usdCents === null || withdrawn.usdCents === null || deposited.usdCents === 0
    ? null
    : withdrawn.usdCents / deposited.usdCents;

  return {
    baseCurrency: 'USD',
    depositsUsdCents: deposited.usdCents,
    withdrawalsNetUsdCents: withdrawn.usdCents,
    platformBalanceUsdCents,
    pendingBalanceUsdCents,
    nextReleaseAt: nextReleases.length ? nextReleases[0] : null,
    // Quando todo o pendente estará liberado (aditivo, 12.12).
    lastReleaseAt: lastReleases.length ? lastReleases[lastReleases.length - 1] : null,
    stockUsdCents,
    // Estoque à venda e em holding (8.9, D283); a soma dos dois é `stockUsdCents`.
    stockBreakdown: {
      forSale: {
        usdCents: stockSplit.forSale.totalUsdCents,
        estimated: stockSplit.forSale.estimated,
        approx: approx(stockSplit.forSale.totalUsdCents),
        count: stockSplit.forSale.count,
      },
      offSale: {
        usdCents: stockSplit.offSale.totalUsdCents,
        estimated: stockSplit.offSale.estimated,
        approx: approx(stockSplit.offSale.totalUsdCents),
        count: stockSplit.offSale.count,
      },
    },
    realProfitUsdCents,
    estimated: Object.values(estimatedParts).some(Boolean),
    estimatedParts,
    approxCurrency: displayCurrencyOf(fx),
    approx: {
      deposits: approx(deposited.usdCents),
      withdrawals: approx(withdrawn.usdCents),
      platformBalance: approx(platformBalanceUsdCents),
      pendingBalance: approx(pendingBalanceUsdCents),
      stock: approx(stockUsdCents),
      realProfit: approx(realProfitUsdCents),
    },
    withdrawnVsDeposited: { withdrawnUsdCents: withdrawn.usdCents, depositedUsdCents: deposited.usdCents, ratio },
    warnings,
  };
}

// Cotação, fonte e datas da moeda de conversão (a linha dela em `fx_rates`). USD é a base e não tem cotação.
function displayRateInfo(currency) {
  const row = currency && currency !== 'USD' ? FxRate.find(currency) : null;
  return {
    currency,
    rate: row && isValidFxRate(row.rate) ? row.rate : null,
    source: row ? row.source ?? null : null,
    quotedAt: row ? row.quotedAt ?? null : null,
    updatedAt: row ? row.updatedAt ?? null : null,
  };
}

// Orquestração de GET /api/profit/summary (D205, D229): total acumulado, sem filtro de período.
function getProfitSummary({ now = new Date() } = {}) {
  const settings = Setting.get();
  const items = Item.findAll();
  const withdrawals = Withdrawal.findAll();
  const deposits = Deposit.findAll();
  const stores = Store.findAll();
  const balances = buildCurrentBalances({
    stores, entries: StoreBalance.findAllEntries(), deposits, withdrawals, items, settings, now,
  });
  const stockItems = items.filter((item) => item.status === 'EM_ESTOQUE');
  const costIndex = operationContext.loadCostIndex(items);
  const consumptionLosses = costIndex.lossSummary();
  const profit = computeRealProfit({ deposits, withdrawals, stores, balances, stockItems, settings, costIndex });
  const sumCount = (pick) => balances.stores.reduce((acc, row) => acc + pick(row), 0);
  const noStore = (record) => record.storeId === null || record.storeId === undefined;
  return {
    ...profit,
    // Perdas por consumo (D363, E-P2-Q34): informativo, fora da fórmula (o lucro real já caiu porque a unidade saiu do estoque).
    consumptionLosses: { ...consumptionLosses, approxCurrency: displayCurrencyOf(fxFromSettings(settings)), approx: approxOf(consumptionLosses.usdCents, fxFromSettings(settings)) },
    balancesByStore: balances.stores,
    counts: {
      deposits: deposits.length,
      legacyDeposits: deposits.filter((d) => d.amountStoreCents === null || d.amountStoreCents === undefined).length,
      withdrawals: withdrawals.length,
      legacyWithdrawals: withdrawals.filter(noStore).length,
      withdrawalsWithoutFee: withdrawals.filter((w) => !noStore(w) && (w.feeCents === null || w.feeCents === undefined)).length,
      stockItems: stockItems.length,
      pendingSales: sumCount((row) => row.pending.count),
    },
    fx: {
      usdBrlRate: isValidFxRate(settings.usdBrlRate) ? settings.usdBrlRate : null,
      source: settings.usdBrlRateSource ?? null,
      updatedAt: settings.usdBrlRateUpdatedAt ?? null,
      quotedAt: settings.rateQuotedAt ?? null,
      displayCurrency: displayCurrencyOf(fxFromSettings(settings)),
      // A cotação da MOEDA DE CONVERSÃO (aditivo, 12.12): a nota "Valores com ≈ são estimados pela cotação ..." usava os campos do BRL
      // acima (compatibilidade da API antiga) mesmo com outra moeda escolhida. Em USD não há "≈", então rate/source/datas ficam nulos.
      display: displayRateInfo(displayCurrencyOf(fxFromSettings(settings))),
    },
    computedAt: now.toISOString(),
  };
}

module.exports = { computeSaleProfitUsdCents, buildSaleInfo, estimateStockUsd, splitStockUsd, computeRealProfit, getProfitSummary };

'use strict';

// Índice de valor de mercado para as views de itens e grupos (D364 item 6). Uma leitura do cache por chamada (sem N+1).
// Fica separado do `marketValueService` (que fala com a rede e com a importação) para o `itemService` poder usá-lo sem ciclo.
const MarketPrice = require('../../models/MarketPrice');
const Integration = require('../../models/Integration');
const Store = require('../../models/Store');
const { approxBrlOf } = require('../currencyService');
const { ACTIVE_VALUATION_SOURCE } = require('./valuationSources');
const valuationService = require('./valuationService');

// Loja da integração (para o líquido da taxa de venda) ou null.
function loadSaleStore() {
  const row = Integration.get('CSFLOAT');
  return row && row.storeId ? Store.findById(row.storeId) : null;
}

function loadPriceRows(source = ACTIVE_VALUATION_SOURCE) {
  return new Map(MarketPrice.listBySource(source).map((row) => [row.priceKey, row]));
}

const withApprox = (valuation, usdBrlRate) => ({
  ...valuation,
  approxBrl: {
    marketValue: approxBrlOf(valuation.marketValueUsdCents, usdBrlRate),
    unrealized: approxBrlOf(valuation.unrealizedUsdCents, usdBrlRate),
    unrealizedNet: approxBrlOf(valuation.unrealizedNetUsdCents, usdBrlRate),
  },
});

// Map itemId -> valuation (com `approxBrl`), só das unidades em estoque.
function buildValuationIndex({ items, componentsByItemId = new Map(), catalogById = new Map(), costIndex, usdBrlRate = null, now = new Date(), rows, saleStore }) {
  const priceRows = rows ?? loadPriceRows();
  const store = saleStore === undefined ? loadSaleStore() : saleStore;
  const priceOf = (key) => priceRows.get(key) ?? null;
  const index = new Map();
  for (const item of items) {
    if (item.status !== 'EM_ESTOQUE') continue;
    const valuation = valuationService.valueUnit({
      item, components: componentsByItemId.get(item.id) ?? [], priceOf, catalogById, costIndex, saleStore: store, now,
    });
    if (valuation) index.set(item.id, withApprox(valuation, usdBrlRate));
  }
  return index;
}

// Soma do estoque inteiro do grupo (como os custos da Revisão 27). `units`: itens em estoque do grupo.
function groupValuation(units, index, usdBrlRate = null) {
  const valuations = units.map((u) => index.get(u.id)).filter(Boolean);
  const totals = valuationService.summarize(valuations);
  const isComplete = totals.unpricedUnits === 0 && totals.notPriceableUnits === 0 && valuations.every((v) => v.status !== 'OK' || v.isComplete);
  return {
    ...totals,
    isComplete,
    isEstimated: true,
    approxBrl: {
      marketValue: approxBrlOf(totals.marketValueUsdCents, usdBrlRate),
      unrealized: approxBrlOf(totals.unrealizedUsdCents, usdBrlRate),
      unrealizedNet: approxBrlOf(totals.unrealizedNetUsdCents, usdBrlRate),
    },
  };
}

module.exports = { loadSaleStore, loadPriceRows, withApprox, buildValuationIndex, groupValuation };

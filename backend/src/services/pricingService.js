'use strict';

// Preço mínimo sem prejuízo (2.5) e cálculo da venda com snapshot (2.4).
// Usa SOMENTE a taxa de venda: taxa de saque e cotação efetiva não entram aqui (2.8).
const { ValidationError } = require('../errors/AppError');
const { getSaleFeeStrategy, saleFeeParamsFromStore, assertSaleFeeParams, MAX_PRICE_SEARCH_ITERATIONS } = require('./fees');
const { convertCents } = require('./currencyService');

const WARNING_FEES = 'taxas não configuradas';
const WARNING_FX = 'cotação não configurada';

const validRate = (rate) => typeof rate === 'number' && Number.isFinite(rate) && rate > 0;

// Menor preço (centavos) cujo líquido >= custo; parte da estimativa e ajusta centavo a centavo. Mínimo 1.
function findMinSalePriceCents(costCents, params) {
  if (!Number.isInteger(costCents) || costCents < 0) {
    throw new ValidationError('Custo deve ser um inteiro de centavos maior ou igual a 0.');
  }
  assertSaleFeeParams(params);
  const strategy = getSaleFeeStrategy(params.feeType);
  let gross = Math.max(1, strategy.estimateGross(costCents, params));
  let steps = 0;
  const step = () => {
    steps += 1;
    if (steps > MAX_PRICE_SEARCH_ITERATIONS) {
      throw new ValidationError('Limite de iterações excedido ao calcular o preço mínimo.', 'PRICE_SEARCH_LIMIT');
    }
  };
  while (gross > 1 && strategy.net(gross - 1, params) >= costCents) { step(); gross -= 1; }
  while (strategy.net(gross, params) < costCents) { step(); gross += 1; }
  return gross;
}

function minPriceForStore({ costCents, costCurrency, costFxRate, store, settings }) {
  const base = { storeId: store.id, storeName: store.name, currency: store.currency };
  const params = saleFeeParamsFromStore(store);
  if (!params) return { ...base, minPriceCents: null, warning: WARNING_FEES };

  let costInStoreCurrency = costCents;
  if (costCurrency !== store.currency) {
    const usdBrlRate = settings ? settings.usdBrlRate : null;
    const needed = costCurrency === 'BRL' ? costFxRate : usdBrlRate;
    if (!validRate(needed)) return { ...base, minPriceCents: null, warning: WARNING_FX };
    costInStoreCurrency = convertCents(
      costCents, costCurrency, store.currency, { fromFxRate: costFxRate, toFxRate: usdBrlRate }, 'CEIL'
    );
  }
  return { ...base, minPriceCents: findMinSalePriceCents(costInStoreCurrency, params), warning: null };
}

function minPricesForItem({ item, stores, settings }) {
  return stores
    .filter((store) => store.isActive)
    .map((store) =>
      minPriceForStore({
        costCents: item.purchasePriceCents,
        costCurrency: item.purchaseCurrency,
        costFxRate: item.fxRateAtPurchase,
        store,
        settings,
      })
    );
}

function computeSale({ salePriceCents, store }) {
  if (!Number.isInteger(salePriceCents) || salePriceCents <= 0) {
    throw new ValidationError('Preço de venda deve ser um inteiro de centavos maior que 0.');
  }
  const params = saleFeeParamsFromStore(store);
  if (!params) {
    throw new ValidationError('Taxas não configuradas para esta loja.', 'FEES_NOT_CONFIGURED');
  }
  assertSaleFeeParams(params);
  const netReceivedCents = getSaleFeeStrategy(params.feeType).net(salePriceCents, params);
  if (netReceivedCents < 0) {
    throw new ValidationError('O preço de venda é menor que a taxa da loja (valor líquido negativo).', 'NET_RECEIVED_NEGATIVE');
  }
  return {
    netReceivedCents,
    feeCents: salePriceCents - netReceivedCents,
    snapshot: {
      saleFeeTypeApplied: params.feeType,
      saleFeeRateApplied: params.rate,
      saleFeeRoundingApplied: params.rounding,
      saleMinFeeCentsApplied: params.minFeeCents,
      saleFixedFeeCentsApplied: params.fixedFeeCents,
    },
  };
}

module.exports = { findMinSalePriceCents, minPriceForStore, minPricesForItem, computeSale };

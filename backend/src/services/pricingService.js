'use strict';

// Preço mínimo sem prejuízo (2.5) e cálculo da venda com snapshot (2.4).
// Usa SOMENTE a taxa de venda: taxa de saque e cotação efetiva não entram aqui (2.8).
const { ValidationError } = require('../errors/AppError');
const { getSaleFeeStrategy, saleFeeParamsFromStore, assertSaleFeeParams, MAX_PRICE_SEARCH_ITERATIONS } = require('./fees');
const { convertCents, isValidFxRate, approxCounterpart, fxFromSettings, rateOf } = require('./currencyService');
const { WARNINGS } = require('./warnings');

// Menor preço (centavos) cujo líquido >= custo; parte da estimativa e ajusta de unidade mínima em unidade mínima (1 centavo; 100 em
// JPY, KRW e CLP, D369 A3). Mínimo: uma unidade.
function findMinSalePriceCents(costCents, params) {
  if (!Number.isSafeInteger(costCents) || costCents < 0) {
    throw new ValidationError('Custo deve ser um inteiro de centavos maior ou igual a 0.', 'INVALID_AMOUNT');
  }
  assertSaleFeeParams(params);
  const strategy = getSaleFeeStrategy(params.feeType);
  const unit = params.unitCents ?? 1;
  let gross = Math.max(unit, Math.ceil(strategy.estimateGross(costCents, params) / unit) * unit);
  let steps = 0;
  const step = () => {
    steps += 1;
    if (steps > MAX_PRICE_SEARCH_ITERATIONS) {
      throw new ValidationError('Limite de iterações excedido ao calcular o preço mínimo.', 'PRICE_SEARCH_LIMIT');
    }
  };
  while (gross > unit && strategy.net(gross - unit, params) >= costCents) { step(); gross -= unit; }
  while (strategy.net(gross, params) < costCents) { step(); gross += unit; }
  return gross;
}

// `warning` (texto) + `warningCode` (D83); sem aviso, ambos null.
const noPrice = (base, w) => ({ ...base, minPriceCents: null, approx: null, warning: w.text, warningCode: w.code });

// Custo em partes nativas (D362): `costParts` = [{ cents, currency, fxRate }] (o custo próprio mais o das unidades consumidas). Cada
// parte é convertida para a moeda da loja com CEIL e as partes são somadas; uma parte só é o cálculo de sempre. Sem `costParts`,
// vale o custo único (`costCents`, `costCurrency`, `costFxRate`).
function minPriceForStore({ costCents, costCurrency, costFxRate, costParts, store, settings }) {
  const base = { storeId: store.id, storeName: store.name, currency: store.currency };
  const params = saleFeeParamsFromStore(store);
  if (!params) return noPrice(base, WARNINGS.FEES_NOT_CONFIGURED);
  const parts = costParts && costParts.length ? costParts : [{ cents: costCents ?? 0, currency: costCurrency ?? 'USD', fxRate: costFxRate ?? null }];

  // Leitura nunca falha por causa de um item: valor fora do suportado vira minPriceCents null + aviso.
  try {
    let costInStoreCurrency = 0;
    const fx = fxFromSettings(settings);
    // Cotação das configurações da moeda da loja (D369): serve ao destino da conversão; a de origem é a gravada no custo.
    const storeRate = store.currency === 'USD' ? 1 : rateOf(fx, store.currency);
    for (const part of parts) {
      if (part.currency === store.currency) {
        costInStoreCurrency += part.cents;
        continue;
      }
      const fromRate = part.currency === 'USD' ? 1 : part.fxRate;
      if (!isValidFxRate(fromRate) || !isValidFxRate(storeRate)) return noPrice(base, WARNINGS.FX_NOT_CONFIGURED);
      costInStoreCurrency += convertCents(
        part.cents, part.currency, store.currency, { fromFxRate: part.fxRate, toFxRate: storeRate }, 'CEIL'
      );
    }
    const minPriceCents = findMinSalePriceCents(costInStoreCurrency, params);
    const approx = approxCounterpart(minPriceCents, store.currency, fxFromSettings(settings));
    return { ...base, minPriceCents, approx, warning: null, warningCode: null };
  } catch (err) {
    if (err instanceof ValidationError && (err.code === 'INVALID_AMOUNT' || err.code === 'PRICE_SEARCH_LIMIT')) {
      return noPrice(base, WARNINGS.PRICE_OVERFLOW);
    }
    throw err;
  }
}

function minPricesForItem({ item, stores, settings, costParts }) {
  return stores
    .filter((store) => store.isActive)
    .map((store) =>
      minPriceForStore({
        costCents: item.purchasePriceCents,
        costCurrency: item.purchaseCurrency,
        costFxRate: item.fxRateAtPurchase,
        costParts,
        store,
        settings,
      })
    );
}

function computeSale({ salePriceCents, store }) {
  if (!Number.isSafeInteger(salePriceCents) || salePriceCents <= 0) {
    throw new ValidationError('Preço de venda deve ser um inteiro de centavos maior que 0.', 'INVALID_AMOUNT', { field: 'salePriceCents' });
  }
  const params = saleFeeParamsFromStore(store);
  if (!params) {
    throw new ValidationError('Taxas não configuradas para esta loja.', 'FEES_NOT_CONFIGURED');
  }
  assertSaleFeeParams(params);
  const netReceivedCents = getSaleFeeStrategy(params.feeType).net(salePriceCents, params);
  if (netReceivedCents < 0) {
    throw new ValidationError('O preço de venda é menor que a taxa da loja (valor líquido negativo).', 'NET_RECEIVED_NEGATIVE', { field: 'salePriceCents' });
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

const EMPTY_SNAPSHOT = Object.freeze({
  saleFeeTypeApplied: null,
  saleFeeRateApplied: null,
  saleFeeRoundingApplied: null,
  saleMinFeeCentsApplied: null,
  saleFixedFeeCentsApplied: null,
});

// Líquido da venda (D122). Informado (`netReceivedCents`) prevalece sobre o cálculo: 0 < líquido <= preço, em
// qualquer tipo de taxa. Snapshot = regras da loja se configuradas; senão todo nulo.
// Sem líquido informado: cálculo normal (loja sem taxa -> FEES_NOT_CONFIGURED no campo do líquido).
function resolveSaleNet({ salePriceCents, store, netReceivedCents = null }) {
  if (!Number.isSafeInteger(salePriceCents) || salePriceCents <= 0) {
    throw new ValidationError('Preço de venda deve ser um inteiro de centavos maior que 0.', 'INVALID_AMOUNT', { field: 'salePriceCents' });
  }
  const params = saleFeeParamsFromStore(store);
  const informed = netReceivedCents !== null && netReceivedCents !== undefined;
  if (!informed) {
    if (!params) {
      throw new ValidationError(
        'Taxas não configuradas para esta loja: informe o líquido recebido.',
        'FEES_NOT_CONFIGURED',
        { field: 'netReceivedCents' }
      );
    }
    return { ...computeSale({ salePriceCents, store }), netReceivedManual: false };
  }
  if (!Number.isSafeInteger(netReceivedCents) || netReceivedCents <= 0) {
    throw new ValidationError('O líquido recebido deve ser maior que zero.', 'INVALID_AMOUNT', { field: 'netReceivedCents' });
  }
  if (netReceivedCents > salePriceCents) {
    throw new ValidationError(
      'O líquido recebido não pode ser maior que o preço de venda.',
      'NET_RECEIVED_ABOVE_PRICE',
      { field: 'netReceivedCents' }
    );
  }
  let snapshot = { ...EMPTY_SNAPSHOT };
  if (params) {
    assertSaleFeeParams(params);
    snapshot = {
      saleFeeTypeApplied: params.feeType,
      saleFeeRateApplied: params.rate,
      saleFeeRoundingApplied: params.rounding,
      saleMinFeeCentsApplied: params.minFeeCents,
      saleFixedFeeCentsApplied: params.fixedFeeCents,
    };
  }
  return { netReceivedCents, feeCents: salePriceCents - netReceivedCents, snapshot, netReceivedManual: true };
}

module.exports = { findMinSalePriceCents, minPriceForStore, minPricesForItem, computeSale, resolveSaleNet };

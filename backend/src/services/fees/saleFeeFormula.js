'use strict';

const { applyRateRounding } = require('./rounding');

// Limite de segurança dos laços de ajuste centavo a centavo (preço mínimo e Strategy ADDED).
const MAX_PRICE_SEARCH_ITERATIONS = 100000;

// taxa = max(arredondar(base × rate), minFee ?? 0) + fixa (2.4). Fórmula única das Strategies. O arredondamento é na unidade mínima
// da moeda da loja (`params.unitCents`, padrão 1; D369 A3).
function computeSaleFee(baseCents, params) {
  const byRate = applyRateRounding(baseCents, params.rate, params.rounding, params.unitCents ?? 1);
  return Math.max(byRate, params.minFeeCents ?? 0) + params.fixedFeeCents;
}

module.exports = { computeSaleFee, MAX_PRICE_SEARCH_ITERATIONS };

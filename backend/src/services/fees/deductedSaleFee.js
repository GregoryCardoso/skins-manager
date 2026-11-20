'use strict';

// Strategy DEDUCTED: a taxa é descontada do preço de venda (base = preço).
const { computeSaleFee } = require('./saleFeeFormula');
const { assertSaleFeeParams } = require('./saleFeeParams');

const fee = (baseCents, params) => computeSaleFee(baseCents, params);

function net(grossCents, params) {
  assertSaleFeeParams(params);
  return grossCents - fee(grossCents, params);
}

// Estimativa por fórmula; o pricingService ajusta centavo a centavo.
function estimateGross(targetNetCents, params) {
  assertSaleFeeParams(params);
  const ppm = Math.round(params.rate * 1e6);
  const byRate = Math.ceil(((targetNetCents + params.fixedFeeCents) * 1e6) / (1e6 - ppm));
  const byMin = targetNetCents + (params.minFeeCents ?? 0) + params.fixedFeeCents;
  return Math.max(byRate, byMin);
}

module.exports = { type: 'DEDUCTED', fee, net, estimateGross };

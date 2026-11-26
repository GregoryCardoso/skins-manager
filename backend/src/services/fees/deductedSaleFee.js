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
  // BigInt: (valor × 1e6) passa do inteiro seguro com os tetos altos (VND, 11.11); divisão inteira para cima, sem ruído de ponto flutuante.
  const divisor = BigInt(1e6 - ppm);
  const byRate = Number((BigInt(targetNetCents + params.fixedFeeCents) * 1000000n + divisor - 1n) / divisor);
  const byMin = targetNetCents + (params.minFeeCents ?? 0) + params.fixedFeeCents;
  return Math.max(byRate, byMin);
}

module.exports = { type: 'DEDUCTED', fee, net, estimateGross };

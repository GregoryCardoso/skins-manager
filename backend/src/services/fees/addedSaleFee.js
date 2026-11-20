'use strict';

// Strategy ADDED: a taxa é somada ao valor recebido (base = valor recebido); o comprador paga recebido + taxa.
const { computeSaleFee, MAX_PRICE_SEARCH_ITERATIONS } = require('./saleFeeFormula');
const { assertSaleFeeParams } = require('./saleFeeParams');
const { ValidationError } = require('../../errors/AppError');

const fee = (baseCents, params) => computeSaleFee(baseCents, params);

const buyerPays = (receivedCents, params) => receivedCents + fee(receivedCents, params);

// Maior valor recebido r >= 0 tal que r + taxa(r) <= preço pago pelo comprador.
function net(grossCents, params) {
  assertSaleFeeParams(params);
  if (buyerPays(0, params) > grossCents) return grossCents - fee(0, params);
  const ppm = Math.round(params.rate * 1e6);
  let r = Math.max(0, Math.floor(((grossCents - params.fixedFeeCents) * 1e6) / (1e6 + ppm)));
  let steps = 0;
  const step = () => {
    steps += 1;
    if (steps > MAX_PRICE_SEARCH_ITERATIONS) {
      throw new ValidationError('Limite de iterações excedido ao calcular o valor líquido.', 'PRICE_SEARCH_LIMIT');
    }
  };
  while (buyerPays(r + 1, params) <= grossCents) { step(); r += 1; }
  while (r > 0 && buyerPays(r, params) > grossCents) { step(); r -= 1; }
  return r;
}

function estimateGross(targetNetCents, params) {
  assertSaleFeeParams(params);
  return buyerPays(targetNetCents, params);
}

module.exports = { type: 'ADDED', fee, net, estimateGross };

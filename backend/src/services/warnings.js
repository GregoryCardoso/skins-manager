'use strict';

// Textos de `warning` compartilhados pelos services de cálculo (T13).
const WARNING_FEES = 'taxas não configuradas';
const WARNING_FX = 'cotação não configurada';
const WARNING_BELOW_FEE = 'valor menor que a taxa';
const WARNING_PRICE_OVERFLOW = 'valor alto demais para calcular o preço mínimo';

module.exports = { WARNING_FEES, WARNING_FX, WARNING_BELOW_FEE, WARNING_PRICE_OVERFLOW };

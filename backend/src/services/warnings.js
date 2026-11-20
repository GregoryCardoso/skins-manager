'use strict';

// Avisos compartilhados pelos services de cálculo (T13, D83): texto em português + código estável
// (o frontend traduz pelo código). O texto continua na resposta (2.4 cita "taxas não configuradas").
const WARNINGS = Object.freeze({
  FEES_NOT_CONFIGURED: Object.freeze({ code: 'FEES_NOT_CONFIGURED', text: 'taxas não configuradas' }),
  FX_NOT_CONFIGURED: Object.freeze({ code: 'FX_NOT_CONFIGURED', text: 'cotação não configurada' }),
  BELOW_FEE: Object.freeze({ code: 'BELOW_FEE', text: 'valor menor que a taxa' }),
  PRICE_OVERFLOW: Object.freeze({ code: 'PRICE_OVERFLOW', text: 'valor alto demais para calcular o preço mínimo' }),
});

const WARNING_FEES = WARNINGS.FEES_NOT_CONFIGURED.text;
const WARNING_FX = WARNINGS.FX_NOT_CONFIGURED.text;
const WARNING_BELOW_FEE = WARNINGS.BELOW_FEE.text;
const WARNING_PRICE_OVERFLOW = WARNINGS.PRICE_OVERFLOW.text;

module.exports = { WARNINGS, WARNING_FEES, WARNING_FX, WARNING_BELOW_FEE, WARNING_PRICE_OVERFLOW };

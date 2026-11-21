'use strict';

// Avisos compartilhados pelos services de cálculo (T13, D83): texto em português + código estável
// (o frontend traduz pelo código). O texto continua na resposta (2.4 cita "taxas não configuradas").
const WARNINGS = Object.freeze({
  FEES_NOT_CONFIGURED: Object.freeze({ code: 'FEES_NOT_CONFIGURED', text: 'taxas não configuradas' }),
  FX_NOT_CONFIGURED: Object.freeze({ code: 'FX_NOT_CONFIGURED', text: 'cotação não configurada' }),
  BALANCE_MAYBE_OUTDATED: Object.freeze({ code: 'BALANCE_MAYBE_OUTDATED', text: 'saldo possivelmente desatualizado' }),
  PRICE_OVERFLOW: Object.freeze({ code: 'PRICE_OVERFLOW', text: 'valor alto demais para calcular o preço mínimo' }),
});

const WARNING_FEES = WARNINGS.FEES_NOT_CONFIGURED.text;
const WARNING_FX = WARNINGS.FX_NOT_CONFIGURED.text;
const WARNING_PRICE_OVERFLOW = WARNINGS.PRICE_OVERFLOW.text;

module.exports = { WARNINGS, WARNING_FEES, WARNING_FX, WARNING_PRICE_OVERFLOW };

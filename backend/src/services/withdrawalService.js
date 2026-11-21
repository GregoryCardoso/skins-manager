'use strict';

// Saldo estimado em BRL (2.8, 2.10, D163, D165): saldo bruto × cotação das configurações.
// A taxa de saque pertence ao saque e só é registrada quando ele acontece; não entra na estimativa.
// Usado somente no lucro real; nunca no preço mínimo por item.
const { ValidationError } = require('../errors/AppError');
const { roundCents } = require('./fees/rounding');
const { isValidFxRate } = require('./currencyService');
const { WARNING_FX } = require('./warnings');

// `estimated`: true quando o valor em BRL é uma conversão pela cotação; loja em BRL é exata.
function estimateBalanceBrl({ balanceCents, store, settings }) {
  if (!Number.isSafeInteger(balanceCents) || balanceCents < 0) {
    throw new ValidationError('Saldo deve ser um inteiro de centavos maior ou igual a 0.', 'INVALID_AMOUNT');
  }
  const withdrawable = Boolean(store.allowsWithdrawal);
  if (balanceCents === 0) return { estimatedBrlCents: 0, withdrawable, estimated: false, warning: null };
  if (store.currency === 'BRL') return { estimatedBrlCents: balanceCents, withdrawable, estimated: false, warning: null };
  const usdBrlRate = settings ? settings.usdBrlRate : null;
  if (!isValidFxRate(usdBrlRate)) return { estimatedBrlCents: null, withdrawable, estimated: true, warning: WARNING_FX };
  return { estimatedBrlCents: roundCents(balanceCents * usdBrlRate, 'FLOOR'), withdrawable, estimated: true, warning: null };
}

module.exports = { estimateBalanceBrl };

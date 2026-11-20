'use strict';

// Taxa de saque, cotação efetiva, simulação e saldo estimado em BRL (2.8).
// Usado somente em saques e no lucro real; nunca no preço mínimo por item.
const { ValidationError } = require('../errors/AppError');
const { applyRateRounding, roundCents } = require('./fees/rounding');

const EFFECTIVE_RATE_SAMPLE = 5;
const WARNING_FEES = 'taxas não configuradas';
const WARNING_FX = 'cotação não configurada';
const WARNING_BELOW_FEE = 'valor menor que a taxa';

const validRate = (rate) => typeof rate === 'number' && Number.isFinite(rate) && rate > 0;

function computeWithdrawalFee(amountStoreCents, store) {
  if (store.withdrawalFeeRate == null) return null;
  return applyRateRounding(amountStoreCents, store.withdrawalFeeRate, 'CEIL') + (store.withdrawalFixedFeeCents ?? 0);
}

// Média simples de amountBrl/amountStore dos 5 saques mais recentes (da loja, se storeId dado).
function effectiveRate(recentWithdrawals, storeId) {
  const sorted = (recentWithdrawals || [])
    .filter((w) => w && Number.isFinite(w.amountStoreCents) && w.amountStoreCents > 0)
    .filter((w) => storeId === undefined || storeId === null || w.storeId === storeId)
    .sort((a, b) => {
      if (a.withdrawnAt !== b.withdrawnAt) return a.withdrawnAt < b.withdrawnAt ? 1 : -1;
      return (b.id ?? 0) - (a.id ?? 0);
    })
    .slice(0, EFFECTIVE_RATE_SAMPLE);
  if (sorted.length === 0) return null;
  const sum = sorted.reduce((acc, w) => acc + w.amountBrlCents / w.amountStoreCents, 0);
  return sum / sorted.length;
}

// Estimativa de BRL para um valor na loja que permite saque (sem validações de entrada).
function estimateWithdrawable(amountStoreCents, store, settings, recentWithdrawals) {
  const rate = effectiveRate(recentWithdrawals, store.id);
  if (rate !== null) {
    return {
      method: 'EFFECTIVE_RATE',
      effectiveRate: rate,
      feeCents: null,
      netStoreCents: null,
      estimatedBrlCents: roundCents(amountStoreCents * rate, 'FLOOR'),
      warning: null,
    };
  }
  const result = {
    method: 'FEE_AND_SETTINGS_RATE',
    effectiveRate: null,
    feeCents: null,
    netStoreCents: null,
    estimatedBrlCents: null,
    warning: null,
  };
  const fee = computeWithdrawalFee(amountStoreCents, store);
  if (fee === null) return { ...result, warning: WARNING_FEES };
  result.feeCents = fee;
  if (amountStoreCents < fee) {
    return { ...result, netStoreCents: 0, estimatedBrlCents: 0, warning: WARNING_BELOW_FEE };
  }
  result.netStoreCents = amountStoreCents - fee;
  if (store.currency === 'BRL') {
    result.estimatedBrlCents = result.netStoreCents;
    return result;
  }
  const usdBrlRate = settings ? settings.usdBrlRate : null;
  if (!validRate(usdBrlRate)) return { ...result, warning: WARNING_FX };
  result.estimatedBrlCents = roundCents(result.netStoreCents * usdBrlRate, 'FLOOR');
  return result;
}

function simulateWithdrawal({ amountStoreCents, store, settings, recentWithdrawals }) {
  if (!Number.isInteger(amountStoreCents) || amountStoreCents <= 0) {
    throw new ValidationError('Valor do saque deve ser um inteiro de centavos maior que 0.');
  }
  if (!store.allowsWithdrawal) {
    throw new ValidationError('Esta loja não permite saque.', 'WITHDRAWAL_NOT_ALLOWED');
  }
  return { storeId: store.id, amountStoreCents, ...estimateWithdrawable(amountStoreCents, store, settings, recentWithdrawals) };
}

function estimateBalanceBrl({ balanceCents, store, settings, recentWithdrawals }) {
  if (!Number.isInteger(balanceCents) || balanceCents < 0) {
    throw new ValidationError('Saldo deve ser um inteiro de centavos maior ou igual a 0.');
  }
  const withdrawable = Boolean(store.allowsWithdrawal);
  if (balanceCents === 0) return { estimatedBrlCents: 0, withdrawable, warning: null };
  if (withdrawable) {
    const est = estimateWithdrawable(balanceCents, store, settings, recentWithdrawals);
    return { estimatedBrlCents: est.estimatedBrlCents, withdrawable, warning: est.warning };
  }
  if (store.currency === 'BRL') return { estimatedBrlCents: balanceCents, withdrawable, warning: null };
  const usdBrlRate = settings ? settings.usdBrlRate : null;
  if (!validRate(usdBrlRate)) return { estimatedBrlCents: null, withdrawable, warning: WARNING_FX };
  return { estimatedBrlCents: roundCents(balanceCents * usdBrlRate, 'FLOOR'), withdrawable, warning: null };
}

module.exports = { computeWithdrawalFee, effectiveRate, simulateWithdrawal, estimateBalanceBrl };

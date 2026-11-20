'use strict';

// Taxa de saque, cotação efetiva, simulação e saldo estimado em BRL (2.8).
// Usado somente em saques e no lucro real; nunca no preço mínimo por item.
const { ValidationError } = require('../errors/AppError');
const { applyRateRounding, roundCents } = require('./fees/rounding');
const { isValidFxRate } = require('./currencyService');
const { WARNING_FEES, WARNING_FX, WARNING_BELOW_FEE } = require('./warnings');

const EFFECTIVE_RATE_SAMPLE = 5;

function computeWithdrawalFee(amountStoreCents, store) {
  if (store.withdrawalFeeRate == null) return null;
  return applyRateRounding(amountStoreCents, store.withdrawalFeeRate, 'CEIL') + (store.withdrawalFixedFeeCents ?? 0);
}

// Média simples de amountBrl/amountStore dos 5 saques mais recentes (da loja, se storeId dado).
function effectiveRate(recentWithdrawals, storeId) {
  const sorted = (recentWithdrawals || [])
    .filter((w) => w && Number.isFinite(w.amountStoreCents) && w.amountStoreCents > 0)
    .filter((w) => Number.isFinite(w.amountBrlCents) && w.amountBrlCents > 0)
    .filter((w) => storeId === undefined || storeId === null || w.storeId === storeId)
    .map((w) => ({ w, time: Date.parse(w.withdrawnAt) }))
    .sort((a, b) => {
      // Datas inválidas (NaN) vão para o fim da lista.
      const ta = Number.isNaN(a.time) ? -Infinity : a.time;
      const tb = Number.isNaN(b.time) ? -Infinity : b.time;
      if (ta !== tb) return tb > ta ? 1 : -1;
      return (b.w.id ?? 0) - (a.w.id ?? 0);
    })
    .map(({ w }) => w)
    .slice(0, EFFECTIVE_RATE_SAMPLE);
  if (sorted.length === 0) return null;
  const sum = sorted.reduce((acc, w) => acc + w.amountBrlCents / w.amountStoreCents, 0);
  return sum / sorted.length;
}

// Estimativa de BRL para um valor na loja que permite saque (sem validações de entrada).
function estimateWithdrawable(amountStoreCents, store, settings, recentWithdrawals) {
  // Sem store.id não dá para isolar os saques da loja: lista vazia (cai em taxa + cotação) (T17).
  const rate = store.id == null ? null : effectiveRate(recentWithdrawals, store.id);
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
  if (!isValidFxRate(usdBrlRate)) return { ...result, warning: WARNING_FX };
  result.estimatedBrlCents = roundCents(result.netStoreCents * usdBrlRate, 'FLOOR');
  return result;
}

function simulateWithdrawal({ amountStoreCents, store, settings, recentWithdrawals }) {
  if (!Number.isSafeInteger(amountStoreCents) || amountStoreCents <= 0) {
    throw new ValidationError('Valor do saque deve ser um inteiro de centavos maior que 0.', 'INVALID_AMOUNT');
  }
  if (!store.allowsWithdrawal) {
    throw new ValidationError('Esta loja não permite saque.', 'WITHDRAWAL_NOT_ALLOWED');
  }
  return { storeId: store.id, amountStoreCents, ...estimateWithdrawable(amountStoreCents, store, settings, recentWithdrawals) };
}

function estimateBalanceBrl({ balanceCents, store, settings, recentWithdrawals }) {
  if (!Number.isSafeInteger(balanceCents) || balanceCents < 0) {
    throw new ValidationError('Saldo deve ser um inteiro de centavos maior ou igual a 0.', 'INVALID_AMOUNT');
  }
  const withdrawable = Boolean(store.allowsWithdrawal);
  if (balanceCents === 0) return { estimatedBrlCents: 0, withdrawable, warning: null };
  if (withdrawable) {
    const est = estimateWithdrawable(balanceCents, store, settings, recentWithdrawals);
    return { estimatedBrlCents: est.estimatedBrlCents, withdrawable, warning: est.warning };
  }
  if (store.currency === 'BRL') return { estimatedBrlCents: balanceCents, withdrawable, warning: null };
  const usdBrlRate = settings ? settings.usdBrlRate : null;
  if (!isValidFxRate(usdBrlRate)) return { estimatedBrlCents: null, withdrawable, warning: WARNING_FX };
  return { estimatedBrlCents: roundCents(balanceCents * usdBrlRate, 'FLOOR'), withdrawable, warning: null };
}

module.exports = { computeWithdrawalFee, effectiveRate, simulateWithdrawal, estimateBalanceBrl };

'use strict';

// Conversões USD <-> BRL com cotação informada ("BRL por 1 USD"). Nunca armazena valores convertidos.
const { ValidationError } = require('../errors/AppError');
const { roundCents } = require('./fees/rounding');

const CURRENCIES = ['USD', 'BRL'];

function assertCurrency(currency) {
  if (!CURRENCIES.includes(currency)) {
    throw new ValidationError(`Moeda inválida: ${currency}`, 'INVALID_CURRENCY');
  }
}

// Cotação válida: número finito > 0 ("BRL por 1 USD").
function isValidFxRate(fxRate) {
  return typeof fxRate === 'number' && Number.isFinite(fxRate) && fxRate > 0;
}

function assertRate(fxRate) {
  if (!isValidFxRate(fxRate)) {
    throw new ValidationError('Cotação USD→BRL ausente ou inválida.', 'FX_RATE_REQUIRED');
  }
}

function toUsdCents(amountCents, currency, fxRate, mode = 'ROUND') {
  assertCurrency(currency);
  if (currency === 'USD') return amountCents;
  assertRate(fxRate);
  return roundCents(amountCents / fxRate, mode);
}

function fromUsdCents(usdCents, currency, fxRate, mode = 'ROUND') {
  assertCurrency(currency);
  if (currency === 'USD') return usdCents;
  assertRate(fxRate);
  return roundCents(usdCents * fxRate, mode);
}

function convertCents(amountCents, fromCurrency, toCurrency, { fromFxRate, toFxRate } = {}, mode = 'ROUND') {
  assertCurrency(fromCurrency);
  assertCurrency(toCurrency);
  if (fromCurrency === toCurrency) return amountCents;
  const usd = toUsdCents(amountCents, fromCurrency, fromFxRate, mode);
  return fromUsdCents(usd, toCurrency, toFxRate, mode);
}

// Valor aproximado na outra moeda, só para exibição (2.11, D101). Nunca é gravado. null sem valor ou sem cotação válida.
function approxCounterpart(cents, currency, usdBrlRate) {
  if (!Number.isSafeInteger(cents) || !isValidFxRate(usdBrlRate)) return null;
  if (currency === 'USD') return { currency: 'BRL', cents: fromUsdCents(cents, 'BRL', usdBrlRate, 'ROUND') };
  if (currency === 'BRL') return { currency: 'USD', cents: toUsdCents(cents, 'BRL', usdBrlRate, 'ROUND') };
  return null;
}

// Valor na moeda base (USD) para o lucro real e os totais (D225). `usdCents` nulo = BRL sem cotação.
// `estimated`: true quando houve conversão BRL -> USD. `approxBrlCents`: "≈ R$" pela cotação (nulo sem cotação em USD).
function toUsdBase(cents, currency, usdBrlRate) {
  if (cents === 0) return { usdCents: 0, approxBrlCents: 0, estimated: false };
  const hasRate = isValidFxRate(usdBrlRate);
  if (currency === 'USD') {
    return { usdCents: cents, approxBrlCents: hasRate ? roundCents(cents * usdBrlRate, 'ROUND') : null, estimated: false };
  }
  assertCurrency(currency);
  return { usdCents: hasRate ? roundCents(cents / usdBrlRate, 'ROUND') : null, approxBrlCents: cents, estimated: true };
}

// "≈ R$" de um total em USD já somado (D225). Nulo sem valor ou sem cotação; nunca devolve -0.
function approxBrlOf(usdCents, usdBrlRate) {
  if (!Number.isSafeInteger(usdCents) || !isValidFxRate(usdBrlRate)) return null;
  const value = roundCents(usdCents * usdBrlRate, 'ROUND');
  return value === 0 ? 0 : value;
}

module.exports = { CURRENCIES, toUsdBase, approxBrlOf, approxCounterpart, isValidFxRate, toUsdCents, fromUsdCents, convertCents };

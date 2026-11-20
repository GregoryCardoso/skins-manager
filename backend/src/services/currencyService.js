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

module.exports = { CURRENCIES, isValidFxRate, toUsdCents, fromUsdCents, convertCents };

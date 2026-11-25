'use strict';

// Conversões entre as moedas do app com cotação informada ("unidades da moeda por 1 US$"). A moeda base é sempre USD.
// Nunca armazena valores convertidos. Contexto de conversão (`fx`): `{ displayCurrency, rates }`, onde `rates` mapeia moeda -> cotação
// (D369, Adendo 1). Por compatibilidade, onde se espera `fx` um número é lido como a cotação do BRL com a moeda de conversão BRL
// (o comportamento anterior à v024); `null`/ausente = BRL sem cotação.
const { ValidationError } = require('../errors/AppError');
const { roundCents, roundToUnit } = require('./fees/rounding');
const { CURRENCIES, ZERO_DECIMAL_CURRENCIES } = require('../config/constants');

function assertCurrency(currency) {
  if (!CURRENCIES.includes(currency)) {
    throw new ValidationError(`Moeda inválida: ${currency}`, 'INVALID_CURRENCY');
  }
}

// Unidade mínima em "centavos" (1/100 da unidade): 1 nas moedas com 2 casas; 100 em JPY, KRW e CLP (sem casas decimais).
function minorUnitCents(currency) {
  assertCurrency(currency);
  return ZERO_DECIMAL_CURRENCIES.includes(currency) ? 100 : 1;
}

// Valor digitado na unidade mínima da moeda (D369 A3): nas moedas sem casas (JPY, KRW e CLP) todo valor gravado é múltiplo de 100
// "centavos". Valor fora da unidade -> AMOUNT_PRECISION_INVALID. Valores nulos/indefinidos e não inteiros ficam para a validação
// de cada campo (INVALID_AMOUNT); aqui só se confere a unidade.
function assertAmountPrecision(cents, currency, field) {
  if (typeof cents !== 'number' || !Number.isSafeInteger(cents)) return;
  const unit = minorUnitCents(currency);
  if (cents % unit !== 0) {
    throw new ValidationError(
      `O valor em ${currency} deve ser um número inteiro, sem casas decimais.`, 'AMOUNT_PRECISION_INVALID',
      { ...(field ? { field } : {}), params: { currency, unitCents: unit } }
    );
  }
}

// Cotação válida: número finito > 0 ("unidades da moeda por 1 US$").
function isValidFxRate(fxRate) {
  return typeof fxRate === 'number' && Number.isFinite(fxRate) && fxRate > 0;
}

function assertRate(fxRate, currency = 'BRL') {
  if (!isValidFxRate(fxRate)) {
    throw new ValidationError(`Cotação USD→${currency} ausente ou inválida.`, 'FX_RATE_REQUIRED');
  }
}

function toUsdCents(amountCents, currency, fxRate, mode = 'ROUND') {
  assertCurrency(currency);
  if (currency === 'USD') return amountCents;
  assertRate(fxRate, currency);
  return roundCents(amountCents / fxRate, mode);
}

// USD -> moeda, arredondando na unidade mínima da moeda de destino.
function fromUsdCents(usdCents, currency, fxRate, mode = 'ROUND') {
  assertCurrency(currency);
  if (currency === 'USD') return usdCents;
  assertRate(fxRate, currency);
  return roundToUnit(usdCents * fxRate, minorUnitCents(currency), mode);
}

function convertCents(amountCents, fromCurrency, toCurrency, { fromFxRate, toFxRate } = {}, mode = 'ROUND') {
  assertCurrency(fromCurrency);
  assertCurrency(toCurrency);
  if (fromCurrency === toCurrency) return amountCents;
  const usd = toUsdCents(amountCents, fromCurrency, fromFxRate, mode);
  return fromUsdCents(usd, toCurrency, toFxRate, mode);
}

// --- Contexto de conversão (moeda de conversão e cotações) ---------------------------------------

// `fx` -> { displayCurrency, rates }. Número = cotação do BRL com a moeda de conversão BRL (legado); objeto = como está.
function normalizeFx(fx) {
  if (fx !== null && typeof fx === 'object') {
    return { displayCurrency: fx.displayCurrency ?? 'USD', rates: fx.rates ?? {} };
  }
  return { displayCurrency: 'BRL', rates: isValidFxRate(fx) ? { BRL: fx } : {} };
}

// Contexto a partir de `Setting.get()` (ou de um objeto parecido). Sem `rates`, usa só `usdBrlRate` (BRL) e a moeda de conversão BRL.
function fxFromSettings(settings) {
  if (!settings) return normalizeFx(null);
  if (settings.rates && typeof settings.rates === 'object') {
    return { displayCurrency: settings.displayCurrency ?? 'USD', rates: settings.rates };
  }
  return {
    displayCurrency: settings.displayCurrency ?? 'BRL',
    rates: isValidFxRate(settings.usdBrlRate) ? { BRL: settings.usdBrlRate } : {},
  };
}

// Cotação da moeda no contexto (USD = 1); `null` se faltar ou for inválida.
function rateOf(fx, currency) {
  if (currency === 'USD') return 1;
  const rate = normalizeFx(fx).rates[currency];
  return isValidFxRate(rate) ? rate : null;
}

const displayCurrencyOf = (fx) => normalizeFx(fx).displayCurrency;
const noNegativeZero = (value) => (value === 0 ? 0 : value);

// Conversão direta entre duas moedas pelo USD, com UM arredondamento na unidade mínima do destino. Nulo sem cotação.
function convertViaUsd(cents, fromCurrency, toCurrency, fx) {
  if (!Number.isSafeInteger(cents)) return null;
  if (fromCurrency === toCurrency) return cents;
  const fromRate = rateOf(fx, fromCurrency);
  const toRate = rateOf(fx, toCurrency);
  if (fromRate === null || toRate === null) return null;
  const raw = (cents / fromRate) * toRate;
  // Cotação manual absurda (sem teto, D143): o "≈" some em vez de derrubar a resposta inteira (INVALID_AMOUNT) ou sair como número gigante.
  if (!Number.isFinite(raw) || Math.abs(raw) > Number.MAX_SAFE_INTEGER) return null;
  return noNegativeZero(roundToUnit(raw, minorUnitCents(toCurrency), 'ROUND'));
}

// "≈" de um total em USD já somado (D225), na moeda de conversão. Nulo sem valor, sem cotação ou com USD como moeda de conversão;
// nunca devolve -0.
function approxOf(usdCents, fx) {
  const display = displayCurrencyOf(fx);
  if (display === 'USD') return null;
  return convertViaUsd(usdCents, 'USD', display, fx);
}

// "≈" de um valor nativo na moeda C (2.11, D369 4.2), só para exibição (nunca é gravado). Com moeda de conversão D:
// C ≠ D mostra "≈ D"; C = D (≠ USD) mostra "≈ US$"; C = D = USD não mostra nada. Devolve { currency, cents } ou null
// (sem valor, sem cotação ou sem "≈"). O resultado é arredondado na unidade mínima da moeda de destino.
function approxCounterpart(cents, currency, fx) {
  const display = displayCurrencyOf(fx);
  const target = currency === display ? 'USD' : display;
  if (target === currency) return null;
  const converted = convertViaUsd(cents, currency, target, fx);
  return converted === null ? null : { currency: target, cents: converted };
}

// Valor na moeda base (USD) para o lucro real e os totais (D225), mais o "≈" desse valor na moeda de conversão.
// `usdCents` nulo = moeda sem cotação. `estimated`: true quando houve conversão para USD. `approxCents`/`approxCurrency`: a moeda
// de conversão (nulo com USD como moeda de conversão ou sem cotação). Se a moeda do valor é a de conversão, o "≈" é o próprio valor.
function toUsdBase(cents, currency, fx) {
  const display = displayCurrencyOf(fx);
  if (cents === 0) return { usdCents: 0, approxCents: display === 'USD' ? null : 0, approxCurrency: display, estimated: false };
  assertCurrency(currency);
  if (currency === 'USD') {
    return { usdCents: cents, approxCents: approxOf(cents, fx), approxCurrency: display, estimated: false };
  }
  const rate = rateOf(fx, currency);
  const usdCents = rate === null ? null : roundCents(cents / rate, 'ROUND');
  let approxCents = null;
  if (display !== 'USD') approxCents = currency === display ? cents : convertViaUsd(cents, currency, display, fx);
  return { usdCents, approxCents, approxCurrency: display, estimated: true };
}

module.exports = {
  CURRENCIES,
  assertCurrency,
  minorUnitCents,
  assertAmountPrecision,
  normalizeFx,
  fxFromSettings,
  rateOf,
  displayCurrencyOf,
  toUsdBase,
  approxOf,
  approxCounterpart,
  isValidFxRate,
  toUsdCents,
  fromUsdCents,
  convertCents,
};

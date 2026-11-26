'use strict';

// Cotações por moeda (D369, 11.2): "unidades da moeda por 1 US$", uma linha por moeda que não é USD (tabela `fx_rates`).
// Edição manual para qualquer moeda; "atualizar cotação" pela AwesomeAPI nos pares verificados (AWESOMEAPI_PAIRS) e pela PTAX só para
// o BRL. Moeda sem par automático fica só manual (FX_SOURCE_NOT_SUPPORTED). Uma atualização por vez (trava única).
const Setting = require('../models/Setting');
const FxRate = require('../models/FxRate');
const Store = require('../models/Store');
const Deposit = require('../models/Deposit');
const Withdrawal = require('../models/Withdrawal');
const { ValidationError, ConflictError } = require('../errors/AppError');
const { CURRENCIES, AWESOMEAPI_PAIRS, FX_REFRESH_SOURCES, FX_MANUAL_RATE_BOUNDS } = require('../config/constants');
const { isValidFxRate } = require('./currencyService');
const { getProvider } = require('./fxRates');

const isNil = (v) => v === null || v === undefined;

// A moeda precisa ser uma das 42 e diferente de USD (a base não tem cotação).
function assertQuotableCurrency(currency) {
  if (typeof currency !== 'string' || !CURRENCIES.includes(currency) || currency === 'USD') {
    throw new ValidationError('Moeda inválida para cotação: informe uma das moedas disponíveis, exceto USD.', 'INVALID_CURRENCY', {
      field: 'currency',
    });
  }
}

const toView = (row) => ({
  currency: row.currency,
  rate: row.rate,
  source: row.source,
  refreshSource: row.refreshSource,
  quotedAt: row.quotedAt,
  updatedAt: row.updatedAt,
});

// Cotações gravadas (as moedas que nunca tiveram cotação não têm linha).
function listRates() {
  return FxRate.findAll().map(toView);
}

function getRate(currency) {
  assertQuotableCurrency(currency);
  const row = FxRate.find(currency);
  return row ? toView(row) : null;
}

// Moedas que precisam de cotação (D369 4.3): a moeda de conversão, as das lojas e o BRL quando há aporte legado ou saque sem loja
// (que guardam só o valor em R$). Sem USD, em ordem alfabética.
function requiredCurrencies() {
  const set = new Set();
  const settings = Setting.get();
  if (settings && settings.displayCurrency) set.add(settings.displayCurrency);
  for (const store of Store.findAll()) set.add(store.currency);
  if (Deposit.findAll().some((d) => isNil(d.amountStoreCents)) || Withdrawal.findAll().some((w) => isNil(w.storeId))) set.add('BRL');
  set.delete('USD');
  return [...set].sort();
}

let refreshInProgress = false;
const isRefreshInProgress = () => refreshInProgress;

// Edição manual: origem MANUAL e sem data de cotação (D143, D162). Além de > 0, o valor precisa estar na faixa larga da moeda
// (FX_MANUAL_RATE_BOUNDS, 11.3), que só barra erro absurdo de digitação; a faixa estreita (FX_RATE_BOUNDS) vale para as fontes automáticas.
function setManualRate(currency, rate, { now = new Date() } = {}) {
  assertQuotableCurrency(currency);
  if (!isValidFxRate(rate)) {
    throw new ValidationError(`Cotação USD→${currency} inválida: informe um número maior que zero.`, 'INVALID_FX_RATE', {
      field: 'rate', params: { currency },
    });
  }
  const bounds = FX_MANUAL_RATE_BOUNDS[currency];
  if (bounds && (rate < bounds.min || rate > bounds.max)) {
    throw new ValidationError(
      `Cotação USD→${currency} fora da faixa aceita (${bounds.min} a ${bounds.max}). Confira o valor digitado.`,
      'FX_RATE_OUT_OF_RANGE',
      { field: 'rate', params: { currency, min: bounds.min, max: bounds.max } }
    );
  }
  if (refreshInProgress) {
    throw new ConflictError('Uma atualização da cotação está em andamento. Aguarde terminar.', 'FX_REFRESH_IN_PROGRESS', {
      params: { source: sourceFor(currency) },
    });
  }
  const saved = FxRate.upsert(currency, { rate, source: 'MANUAL', quotedAt: null, updatedAt: now.toISOString() }, { now });
  Setting.update({}, { now }); // as configurações mudaram: carimba `settings.updated_at`
  return toView(saved);
}

// Fonte do "atualizar cotação" de uma moeda: a salva no BRL (AwesomeAPI ou PTAX); as demais só têm a AwesomeAPI.
function sourceFor(currency) {
  if (currency !== 'BRL') return 'AWESOMEAPI';
  const row = FxRate.find('BRL');
  return row ? row.refreshSource : 'AWESOMEAPI';
}

// A fonte atende a moeda? PTAX só para o BRL; AwesomeAPI nos pares verificados.
function supportsSource(currency, source) {
  if (source === 'PTAX') return currency === 'BRL';
  if (source === 'AWESOMEAPI') return AWESOMEAPI_PAIRS.includes(currency);
  return false;
}

function assertSupported(currency, source) {
  if (!FX_REFRESH_SOURCES.includes(source) || !supportsSource(currency, source)) {
    throw new ValidationError(
      `A moeda ${currency} não tem atualização automática pela fonte ${source}. Informe a cotação manualmente.`,
      'FX_SOURCE_NOT_SUPPORTED',
      { field: 'source', params: { currency, source } }
    );
  }
}

// Atualização ao abrir o app (D338): no máximo uma por moeda por processo do backend (um F5 não repete). Pula em silêncio, sem chamar a
// fonte, quando a cotação gravada foi digitada à mão (origem MANUAL: nunca é sobrescrita), quando a moeda não tem atualização
// automática ou quando já há uma atualização em andamento. Erro de rede ou da fonte: nada é gravado (fica a cotação anterior).
const autoAttempted = new Set();
const resetAutoForTests = () => autoAttempted.clear();

function autoSkipReason(currency, source) {
  if (autoAttempted.has(currency)) return 'ALREADY_RAN';
  const row = FxRate.find(currency);
  if (row && row.source === 'MANUAL') return 'MANUAL_RATE';
  if (!supportsSource(currency, source)) return 'NOT_SUPPORTED';
  if (refreshInProgress) return 'BUSY';
  return null;
}

// Atualiza uma cotação pela fonte (`source` explícita, só desta chamada, ou a salva da moeda). Na falha nada é gravado e o erro
// sai com `params.source`. Devolve `{ currency, quote }` ou `{ currency, quote: null, skipped }` (só no AUTO).
async function refreshRate(currency, { source, fetchFn = globalThis.fetch, now = new Date(), timeouts, trigger = 'MANUAL' } = {}) {
  assertQuotableCurrency(currency);
  const chosen = source ?? sourceFor(currency);
  if (trigger === 'AUTO') {
    const skipped = autoSkipReason(currency, chosen);
    if (skipped) return { currency, quote: null, skipped };
    autoAttempted.add(currency); // conta como "a" automática da moeda no processo, mesmo que falhe
  }
  assertSupported(currency, chosen);
  if (refreshInProgress) {
    throw new ConflictError('Já existe uma atualização da cotação em andamento.', 'FX_REFRESH_IN_PROGRESS', { params: { source: chosen } });
  }
  refreshInProgress = true;
  try {
    const quote = await getProvider(chosen).fetchLatestRate({ currency, fetchFn, now, ...timeouts });
    FxRate.upsert(currency, { rate: quote.rate, source: quote.source, quotedAt: quote.quotedAt, updatedAt: now.toISOString() }, { now });
    Setting.update({}, { now }); // as configurações mudaram: carimba `settings.updated_at`
    return {
      currency,
      quote: { source: quote.source, rate: quote.rate, buyRate: quote.buyRate, sellRate: quote.sellRate, quotedAt: quote.quotedAt },
    };
  } finally {
    refreshInProgress = false;
  }
}

module.exports = {
  listRates,
  getRate,
  requiredCurrencies,
  setManualRate,
  refreshRate,
  isRefreshInProgress,
  resetAutoForTests,
  assertQuotableCurrency,
};

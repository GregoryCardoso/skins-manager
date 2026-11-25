'use strict';

const env = require('../config/env');
const Setting = require('../models/Setting');
const Store = require('../models/Store');
const { ValidationError } = require('../errors/AppError');
const fxRateService = require('./fxRateService');
const storeService = require('./storeService');
const { resolveAgingThresholds } = require('./inventoryAgingService');
const {
  THEMES,
  LANGUAGES,
  INVENTORY_VIEWS,
  FX_REFRESH_SOURCES,
  CURRENCIES,
  AWESOMEAPI_PAIRS,
  DEFAULT_FAST_TURNOVER_DAYS,
  MIN_FAST_TURNOVER_DAYS,
  MAX_FAST_TURNOVER_DAYS,
  MIN_SLOW_ITEM_DAYS,
  MAX_SLOW_ITEM_DAYS,
} = require('../config/constants');

// Limites efetivos de giro (D159): salvo ?? padrão; combinação incoerente usa rápido = agarrado − 1 e avisa no console.
let lastAdjustedWarning = null;
function effectiveThresholds(raw) {
  const result = resolveAgingThresholds({
    fastSaved: raw.fastTurnoverDays,
    slowSaved: raw.slowItemDays,
    envSlowItemDays: env.slowItemDays,
  });
  if (result.adjusted) {
    const key = `${raw.fastTurnoverDays}|${raw.slowItemDays}|${env.slowItemDays}`;
    if (lastAdjustedWarning !== key) {
      lastAdjustedWarning = key;
      console.warn(
        `Aviso: limites de giro incoerentes (rápido salvo ${raw.fastTurnoverDays ?? DEFAULT_FAST_TURNOVER_DAYS}, ` +
          `agarrado ${result.slowItemDays}); usando rápido = ${result.fastTurnoverDays}.`
      );
    }
  }
  return result;
}

// Limites efetivos { fastTurnoverDays, slowItemDays } usados na classificação de giro.
function getAgingThresholds() {
  const { fastTurnoverDays, slowItemDays } = effectiveThresholds(Setting.get());
  return { fastTurnoverDays, slowItemDays };
}

// Visão pública (D159): valores salvos (`*Custom`, nulo = padrão), efetivos, padrões e o sinal de ajuste.
function toSettingsView(raw) {
  const { fastTurnoverDays, slowItemDays, adjusted } = effectiveThresholds(raw);
  const { fastTurnoverDays: savedFast, slowItemDays: savedSlow, rates, ...rest } = raw;
  return {
    ...rest,
    // Cotações por moeda (D369): `usdBrlRate*`, `rateQuotedAt` e `fxRefreshSource` continuam, derivados do BRL, até o fim da 11.3.
    fxRates: fxRateService.listRates(),
    requiredFxCurrencies: fxRateService.requiredCurrencies(),
    fastTurnoverDaysCustom: savedFast,
    slowItemDaysCustom: savedSlow,
    fastTurnoverDays,
    slowItemDays,
    fastTurnoverDaysDefault: DEFAULT_FAST_TURNOVER_DAYS,
    slowItemDaysDefault: env.slowItemDays,
    agingThresholdsAdjusted: adjusted,
  };
}

function getSettings() {
  return toSettingsView(Setting.get());
}

// Cotação do BRL digitada à mão (compatibilidade da API antiga `PUT /fx-rate { usdBrlRate }`, D369): delega ao serviço por moeda.
function updateFxRate(usdBrlRate, { now = new Date() } = {}) {
  setFxRate('BRL', usdBrlRate, { now });
  return getSettings();
}

// Cotação digitada à mão de qualquer moeda (D369). Devolve as configurações.
function setFxRate(currency, rate, { now = new Date() } = {}) {
  fxRateService.setManualRate(currency, rate, { now });
  return getSettings();
}

const isFxRefreshInProgress = () => fxRateService.isRefreshInProgress();
const resetAutoFxForTests = () => fxRateService.resetAutoForTests();

// Atualização da cotação de uma moeda (D162, D338, D369). `source` explícita vale só desta chamada; sem ela, a fonte salva da moeda.
// Devolve `{ currency, settings, quote }` (e `skipped` quando o AUTO pula).
async function refreshFxRate({ currency = 'BRL', source, fetchFn = globalThis.fetch, now = new Date(), timeouts, trigger = 'MANUAL' } = {}) {
  const result = await fxRateService.refreshRate(currency, { source, fetchFn, now, timeouts, trigger });
  return { currency: result.currency, settings: getSettings(), quote: result.quote, ...(result.skipped ? { skipped: result.skipped } : {}) };
}

function fieldError(code, field, message) {
  return new ValidationError(message, code, { field });
}

function checkDays(value, { min, max, code, field, label }) {
  if (value === null) return;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw fieldError(code, field, `${label} deve ser um número inteiro de ${min} a ${max} (ou vazio para o padrão).`);
  }
}

// Preferências pessoais (D83, D159, D162): tema, idioma, os dois limites de giro e a fonte do "atualizar cotação".
function updatePreferences(partial, { now = new Date() } = {}) {
  if (partial.theme !== undefined && !THEMES.includes(partial.theme)) {
    throw new ValidationError(`Tema inválido. Use ${THEMES.join(', ')}.`, 'INVALID_THEME');
  }
  if (partial.language !== undefined && !LANGUAGES.includes(partial.language)) {
    throw new ValidationError(`Idioma inválido. Use ${LANGUAGES.join(', ')}.`, 'INVALID_LANGUAGE');
  }
  if (partial.displayCurrency !== undefined) assertDisplayCurrency(partial.displayCurrency);
  if (partial.steamStore !== undefined) assertSteamStoreChoice(partial.steamStore, partial.displayCurrency);
  if (partial.inventoryView !== undefined && !INVENTORY_VIEWS.includes(partial.inventoryView)) {
    throw new ValidationError(`Visão do inventário inválida. Use ${INVENTORY_VIEWS.join(', ')}.`, 'INVALID_INVENTORY_VIEW', {
      field: 'inventoryView',
    });
  }
  if (partial.fxRefreshSource !== undefined && !FX_REFRESH_SOURCES.includes(partial.fxRefreshSource)) {
    throw new ValidationError(
      `Fonte de cotação inválida. Use ${FX_REFRESH_SOURCES.join(', ')}.`,
      'INVALID_FX_SOURCE',
      { field: 'fxRefreshSource' }
    );
  }
  const hasFast = partial.fastTurnoverDays !== undefined;
  const hasSlow = partial.slowItemDays !== undefined;
  if (hasFast) {
    checkDays(partial.fastTurnoverDays, {
      min: MIN_FAST_TURNOVER_DAYS,
      max: MAX_FAST_TURNOVER_DAYS,
      code: 'INVALID_FAST_TURNOVER_DAYS',
      field: 'fastTurnoverDays',
      label: 'O giro rápido',
    });
  }
  if (hasSlow) {
    checkDays(partial.slowItemDays, {
      min: MIN_SLOW_ITEM_DAYS,
      max: MAX_SLOW_ITEM_DAYS,
      code: 'INVALID_SLOW_ITEM_DAYS',
      field: 'slowItemDays',
      label: 'O limite de agarrado',
    });
  }
  if (hasFast || hasSlow) {
    // Regra cruzada sobre os valores efetivos resultantes (D159): o campo omitido vale o salvo (ou o padrão).
    const saved = Setting.get();
    const fast = (hasFast ? partial.fastTurnoverDays : saved.fastTurnoverDays) ?? DEFAULT_FAST_TURNOVER_DAYS;
    const slow = (hasSlow ? partial.slowItemDays : saved.slowItemDays) ?? env.slowItemDays;
    if (!(fast >= MIN_FAST_TURNOVER_DAYS && fast < slow && slow <= MAX_SLOW_ITEM_DAYS)) {
      throw new ValidationError(
        `O giro rápido (${fast} dias) deve ser menor que o limite de agarrado (${slow} dias).`,
        'AGING_THRESHOLDS_ORDER',
        { field: hasFast ? 'fastTurnoverDays' : 'slowItemDays', params: { fastTurnoverDays: fast, slowItemDays: slow } }
      );
    }
  }
  const changes = {};
  for (const key of ['theme', 'language', 'inventoryView', 'fxRefreshSource', 'fastTurnoverDays', 'slowItemDays', 'displayCurrency']) {
    if (partial[key] !== undefined) changes[key] = partial[key];
  }
  Setting.update(changes, { now });
  if (partial.displayCurrency !== undefined) {
    // Com `displayCurrency` a resposta é `{ settings, steamStore }` (D369 A5). Até a 11.4 a loja Steam nunca muda (só 'KEEP').
    const steam = getSteamStore();
    return { settings: getSettings(), steamStore: steam ? { id: steam.id, currency: steam.currency, created: false } : null };
  }
  return getSettings();
}

// Moeda de conversão (D369 A1): uma das 17 moedas.
function assertDisplayCurrency(currency) {
  if (typeof currency !== 'string' || !CURRENCIES.includes(currency)) {
    throw new ValidationError(`Moeda inválida. Use ${CURRENCIES.join(', ')}.`, 'INVALID_CURRENCY', { field: 'displayCurrency' });
  }
}

// `steamStore` (A5): só 'KEEP' (ou ausente) até a 11.4; 'FOLLOW' e 'NEW_STORE' ainda não existem. Exige `displayCurrency` junto.
function assertSteamStoreChoice(choice, displayCurrency) {
  const invalid = (message) => new ValidationError(message, 'INVALID_FIELD', { field: 'steamStore' });
  if (!['KEEP', 'FOLLOW', 'NEW_STORE'].includes(choice)) throw invalid('steamStore deve ser KEEP, FOLLOW ou NEW_STORE.');
  if (displayCurrency === undefined) throw invalid('steamStore só vale junto com displayCurrency.');
  if (choice !== 'KEEP') throw invalid('A opção da loja Steam ainda não está disponível: use KEEP.');
}

// Prévia da troca da moeda de conversão (D369 A5): só leitura, nada é gravado. O modal usa isto para montar as linhas.
function getCurrencyChangePreview(currency) {
  assertDisplayCurrency(currency);
  const steam = getSteamStore();
  const rate = currency === 'USD' ? null : fxRateService.getRate(currency);
  return {
    currency,
    steamStore: steam ? { id: steam.id, name: steam.name, currency: steam.currency, hasEntries: storeService.storeHasEntries(steam.id) } : null,
    // USD não tem cotação (é a base): o "≈" simplesmente some.
    fxRateAvailable: currency === 'USD' ? true : rate !== null && rate.rate !== null,
    automaticSource: currency !== 'USD' && AWESOMEAPI_PAIRS.includes(currency),
  };
}

// Loja Steam do app (D363, E-P2-Q45): a loja onde o item comprado no terminal é registrado. Devolve a loja ou `null` (sem escolha, ou a
// loja foi excluída e a referência foi limpa).
function getSteamStore() {
  const { steamStoreId } = Setting.get();
  if (steamStoreId === null || steamStoreId === undefined) return null;
  return Store.findById(steamStoreId);
}

// Escolhe (ou limpa, com `null`) a loja Steam do app. Aceita qualquer loja existente, ativa ou inativa, em qualquer moeda.
function setSteamStore(storeId, { now = new Date() } = {}) {
  if (storeId !== null && (!Number.isSafeInteger(storeId) || !Store.findById(storeId))) {
    throw new ValidationError('Loja não encontrada.', 'STORE_NOT_FOUND', { field: 'storeId' });
  }
  Setting.update({ steamStoreId: storeId }, { now });
  return getSettings();
}

module.exports = {
  getSteamStore,
  setSteamStore,
  resetAutoFxForTests,
  getSettings,
  getCurrencyChangePreview,
  setFxRate,
  getAgingThresholds,
  updateFxRate,
  updatePreferences,
  refreshFxRate,
  isFxRefreshInProgress,
};

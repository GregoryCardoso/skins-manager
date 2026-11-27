'use strict';

const env = require('../config/env');
const Setting = require('../models/Setting');
const Store = require('../models/Store');
const { ValidationError, ConflictError } = require('../errors/AppError');
const { runInTransaction } = require('../models/modelHelpers');
const fxRateService = require('./fxRateService');
const storeService = require('./storeService');
const { resolveAgingThresholds } = require('./inventoryAgingService');
const {
  THEMES,
  LANGUAGES,
  INVENTORY_VIEWS,
  INVENTORY_DENSITIES,
  FX_REFRESH_SOURCES,
  CURRENCIES,
  AWESOMEAPI_PAIRS,
  DEFAULT_FAST_TURNOVER_DAYS,
  MIN_FAST_TURNOVER_DAYS,
  MAX_FAST_TURNOVER_DAYS,
  MIN_SLOW_ITEM_DAYS,
  MAX_SLOW_ITEM_DAYS,
  FX_MANUAL_RATE_BOUNDS,
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
    // Cotações por moeda (D369): `usdBrlRate*`, `rateQuotedAt` e `fxRefreshSource` continuam, derivados do BRL, como campos de compatibilidade da API antiga.
    // DÉBITO (11.11, B3): remover esses campos quando nenhum cliente/teste os usar (hoje só o BRL em `fxRates` é a fonte da verdade).
    fxRates: fxRateService.listRates(),
    requiredFxCurrencies: fxRateService.requiredCurrencies(),
    // Faixa aceita para a cotação digitada à mão, por moeda (12.8): só para a tela mostrar e avisar; a validação é do fxRateService.
    fxManualRateBounds: Object.fromEntries(Object.entries(FX_MANUAL_RATE_BOUNDS).map(([code, { min, max }]) => [code, { min, max }])),
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
  if (partial.inventoryDensity !== undefined && !INVENTORY_DENSITIES.includes(partial.inventoryDensity)) {
    throw new ValidationError(`Densidade inválida. Use ${INVENTORY_DENSITIES.join(', ')}.`, 'INVALID_FIELD', { field: 'inventoryDensity' });
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
  for (const key of ['theme', 'language', 'inventoryView', 'inventoryDensity', 'fxRefreshSource', 'fastTurnoverDays', 'slowItemDays', 'displayCurrency']) {
    if (partial[key] !== undefined) changes[key] = partial[key];
  }
  // Tudo na mesma transação (D369 A5): a moeda de conversão e a decisão da loja Steam são gravadas juntas ou nada é gravado.
  let steamStore = null;
  runInTransaction(() => {
    Setting.update(changes, { now });
    if (partial.displayCurrency !== undefined) steamStore = applySteamStoreChoice(partial.displayCurrency, partial.steamStore ?? 'KEEP', { now });
  });
  // Contrato (D159 + D369 A5; B2, 11.11): o PATCH devolve `Settings` (contrato antigo, de tema, idioma, limites e fonte da cotação) e,
  // só quando o corpo traz `displayCurrency`, `{ settings, steamStore }`, com `steamStore` = `{ id, currency, created, previousStoreId? }`
  // ou `null` sem loja Steam. Padronizar a forma quebraria o contrato documentado e dezenas de testes; por isso ele fica documentado no
  // tipo do cliente (`frontend/src/services/api.ts`).
  if (partial.displayCurrency !== undefined) return { settings: getSettings(), steamStore };
  return getSettings();
}

// Moeda de conversão (D369 A1): uma das 42 moedas (17 da D369 e 25 da 11.11).
function assertDisplayCurrency(currency) {
  if (typeof currency !== 'string' || !CURRENCIES.includes(currency)) {
    throw new ValidationError(`Moeda inválida. Use ${CURRENCIES.join(', ')}.`, 'INVALID_CURRENCY', { field: 'displayCurrency' });
  }
}

// `steamStore` (A5): 'KEEP', 'FOLLOW' ou 'NEW_STORE'. Exige `displayCurrency` junto. A coerência com os lançamentos da loja é conferida
// em `applySteamStoreChoice` (dentro da transação).
function assertSteamStoreChoice(choice, displayCurrency) {
  const invalid = (message) => new ValidationError(message, 'INVALID_FIELD', { field: 'steamStore' });
  if (!['KEEP', 'FOLLOW', 'NEW_STORE'].includes(choice)) throw invalid('steamStore deve ser KEEP, FOLLOW ou NEW_STORE.');
  if (displayCurrency === undefined) throw invalid('steamStore só vale junto com displayCurrency.');
}

// Decisão da loja Steam ao trocar a moeda de conversão (D369 A4 e A5). Regra de ouro: nenhum valor gravado muda de moeda.
// - 'KEEP' (ou ausente): não mexe na Steam.
// - 'FOLLOW': só com a Steam sem lançamentos (senão STORE_CURRENCY_LOCKED); ela passa para a moeda nova.
// - 'NEW_STORE': só com a Steam com lançamentos e em outra moeda (senão INVALID_FIELD); cria a nova loja Steam na moeda nova, desativa e
//   renomeia a antiga, e `steam_store_id` passa a apontar para a nova.
// Devolve `{ id, currency, created, previousStoreId? }`, ou `null` sem loja Steam configurada (e 'KEEP'/'FOLLOW' sem loja).
function applySteamStoreChoice(currency, choice, { now = new Date() } = {}) {
  const steam = getSteamStore();
  const invalid = (message) => new ValidationError(message, 'INVALID_FIELD', { field: 'steamStore' });
  if (!steam) {
    if (choice === 'KEEP') return null;
    throw invalid('Não há loja Steam configurada.');
  }
  if (choice === 'KEEP') return { id: steam.id, currency: steam.currency, created: false };
  const hasEntries = storeService.storeHasEntries(steam.id);
  if (choice === 'FOLLOW') {
    if (hasEntries) {
      throw new ConflictError(
        'A loja Steam já tem lançamentos e não pode mudar de moeda. Crie uma nova loja Steam.', 'STORE_CURRENCY_LOCKED', { field: 'steamStore' }
      );
    }
    const updated = steam.currency === currency ? steam : storeService.changeStoreCurrency(steam.id, currency, { now });
    return { id: updated.id, currency: updated.currency, created: false };
  }
  // NEW_STORE
  if (!hasEntries) throw invalid('A loja Steam ainda não tem lançamentos: use FOLLOW para ela acompanhar a moeda.');
  if (steam.currency === currency) throw invalid('A loja Steam já usa esta moeda.');
  const { store, previousStoreId } = storeService.cloneSteamStoreInCurrency(steam.id, currency, { now });
  Setting.update({ steamStoreId: store.id }, { now });
  return { id: store.id, currency: store.currency, created: true, previousStoreId };
}

// Prévia da troca da moeda de conversão (D369 A5): só leitura, nada é gravado. O modal usa isto para montar as linhas.
// `feesWillReset` (M2, 11.11): a Steam mudaria de moeda (FOLLOW ou NEW_STORE) e tem taxa fixa/mínima, mas falta a cotação da moeda de
// origem (a atual da Steam) ou da de destino, que `carryFeeAmount` precisa para converter: então as taxas ficam zeradas. `missingRateCurrency`
// é a moeda sem cotação (a nova tem prioridade), para o aviso citá-la. USD é a base e nunca precisa de cotação.
function getCurrencyChangePreview(currency) {
  assertDisplayCurrency(currency);
  const steam = getSteamStore();
  const hasRate = (code) => code === 'USD' || fxRateService.getRate(code)?.rate != null;
  const hasFixedFees = steam
    ? [steam.saleFixedFeeCents, steam.saleMinFeeCents, steam.withdrawalFixedFeeCents].some((value) => Number(value) > 0)
    : false;
  let missingRateCurrency = null;
  if (steam && hasFixedFees && steam.currency !== currency) {
    if (!hasRate(currency)) missingRateCurrency = currency;
    else if (!hasRate(steam.currency)) missingRateCurrency = steam.currency;
  }
  return {
    currency,
    steamStore: steam ? {
      id: steam.id, name: steam.name, currency: steam.currency, hasEntries: storeService.storeHasEntries(steam.id),
      // Taxa fixa ou mínima diferente de zero.
      hasFixedFees,
      feesWillReset: missingRateCurrency !== null,
      missingRateCurrency,
    } : null,
    // USD não tem cotação (é a base): o "≈" simplesmente some.
    fxRateAvailable: hasRate(currency),
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

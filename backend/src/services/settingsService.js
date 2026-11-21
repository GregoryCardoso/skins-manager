'use strict';

const env = require('../config/env');
const Setting = require('../models/Setting');
const { ValidationError, ConflictError } = require('../errors/AppError');
const { isValidFxRate } = require('./currencyService');
const { resolveAgingThresholds } = require('./inventoryAgingService');
const { fetchLatestPtax } = require('./ptax/bcbPtaxAdapter');
const {
  THEMES,
  LANGUAGES,
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
  const { fastTurnoverDays: savedFast, slowItemDays: savedSlow, ...rest } = raw;
  return {
    ...rest,
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

function updateFxRate(usdBrlRate, { now = new Date() } = {}) {
  if (!isValidFxRate(usdBrlRate)) {
    throw new ValidationError('Cotação USD→BRL inválida: informe um número maior que zero.', 'INVALID_FX_RATE');
  }
  // Edição manual: origem MANUAL e sem data de PTAX (D143, D147).
  Setting.update(
    { usdBrlRate, usdBrlRateUpdatedAt: now.toISOString(), usdBrlRateSource: 'MANUAL', ptaxQuotedAt: null },
    { now }
  );
  return getSettings();
}

// Atualização da cotação pela PTAX de venda do Banco Central (D147). Salva direto; uma por vez.
let ptaxRefreshInProgress = false;

function isPtaxRefreshInProgress() {
  return ptaxRefreshInProgress;
}

async function refreshFxRateFromPtax({ fetchFn = globalThis.fetch, now = new Date(), timeouts } = {}) {
  if (ptaxRefreshInProgress) {
    throw new ConflictError('Já existe uma atualização da PTAX em andamento.', 'PTAX_REFRESH_IN_PROGRESS');
  }
  ptaxRefreshInProgress = true;
  try {
    const quote = await fetchLatestPtax({ fetchFn, now, ...timeouts });
    Setting.update(
      {
        usdBrlRate: quote.sellRate,
        usdBrlRateUpdatedAt: now.toISOString(),
        usdBrlRateSource: 'PTAX',
        ptaxQuotedAt: quote.quotedAt,
      },
      { now }
    );
    return {
      settings: getSettings(),
      ptax: {
        rate: quote.sellRate,
        buyRate: quote.buyRate,
        sellRate: quote.sellRate,
        quotedAt: quote.quotedAt,
        quoteDate: quote.quoteDate,
      },
    };
  } finally {
    ptaxRefreshInProgress = false;
  }
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

// Preferências pessoais (D83, D159): tema, idioma e os dois limites de giro.
function updatePreferences(partial, { now = new Date() } = {}) {
  if (partial.theme !== undefined && !THEMES.includes(partial.theme)) {
    throw new ValidationError(`Tema inválido. Use ${THEMES.join(', ')}.`, 'INVALID_THEME');
  }
  if (partial.language !== undefined && !LANGUAGES.includes(partial.language)) {
    throw new ValidationError(`Idioma inválido. Use ${LANGUAGES.join(', ')}.`, 'INVALID_LANGUAGE');
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
  for (const key of ['theme', 'language', 'fastTurnoverDays', 'slowItemDays']) {
    if (partial[key] !== undefined) changes[key] = partial[key];
  }
  Setting.update(changes, { now });
  return getSettings();
}

module.exports = {
  getSettings,
  getAgingThresholds,
  updateFxRate,
  updatePreferences,
  refreshFxRateFromPtax,
  isPtaxRefreshInProgress,
};

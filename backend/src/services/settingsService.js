'use strict';

const env = require('../config/env');
const Setting = require('../models/Setting');
const { ValidationError, ConflictError } = require('../errors/AppError');
const { isValidFxRate } = require('./currencyService');
const { resolveAgingThresholds } = require('./inventoryAgingService');
const { getProvider } = require('./fxRates');
const {
  THEMES,
  LANGUAGES,
  INVENTORY_VIEWS,
  FX_REFRESH_SOURCES,
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
  if (fxRefreshInProgress) {
    throw new ConflictError('Uma atualização da cotação está em andamento. Aguarde terminar.', 'FX_REFRESH_IN_PROGRESS', {
      params: { source: Setting.get().fxRefreshSource },
    });
  }
  // Edição manual: origem MANUAL e sem data de cotação (D143, D162).
  Setting.update(
    { usdBrlRate, usdBrlRateUpdatedAt: now.toISOString(), usdBrlRateSource: 'MANUAL', rateQuotedAt: null },
    { now }
  );
  return getSettings();
}

// Atualização da cotação pela fonte salva em `fxRefreshSource` (D162): AWESOMEAPI ou PTAX. Uma por vez (trava única).
// Na falha nada é gravado e o erro sai com `params.source`.
let fxRefreshInProgress = false;

function isFxRefreshInProgress() {
  return fxRefreshInProgress;
}

// Atualização ao abrir o app (D338): no máximo uma por processo do backend (um F5 não repete; vale no desktop e no
// start-app.bat). Pula em silêncio, sem chamar a fonte, quando a cotação gravada foi digitada à mão (origem MANUAL: nunca é
// sobrescrita) ou quando já há uma atualização em andamento. Erro de rede ou da fonte: nada é gravado (fica a cotação anterior).
let autoFxAttempted = false;
const resetAutoFxForTests = () => {
  autoFxAttempted = false;
};

function autoFxSkipReason() {
  if (autoFxAttempted) return 'ALREADY_RAN';
  if (Setting.get().usdBrlRateSource === 'MANUAL') return 'MANUAL_RATE';
  if (fxRefreshInProgress) return 'BUSY';
  return null;
}

async function refreshFxRate({ fetchFn = globalThis.fetch, now = new Date(), timeouts, trigger = 'MANUAL' } = {}) {
  if (trigger === 'AUTO') {
    const skipped = autoFxSkipReason();
    if (skipped) return { settings: getSettings(), quote: null, skipped };
    autoFxAttempted = true; // conta como "a" automática do processo, mesmo que falhe
  }
  const source = Setting.get().fxRefreshSource;
  if (fxRefreshInProgress) {
    throw new ConflictError('Já existe uma atualização da cotação em andamento.', 'FX_REFRESH_IN_PROGRESS', {
      params: { source },
    });
  }
  fxRefreshInProgress = true;
  try {
    const quote = await getProvider(source).fetchLatestRate({ fetchFn, now, ...timeouts });
    Setting.update(
      {
        usdBrlRate: quote.rate,
        usdBrlRateUpdatedAt: now.toISOString(),
        usdBrlRateSource: quote.source,
        rateQuotedAt: quote.quotedAt,
      },
      { now }
    );
    return {
      settings: getSettings(),
      quote: {
        source: quote.source,
        rate: quote.rate,
        buyRate: quote.buyRate,
        sellRate: quote.sellRate,
        quotedAt: quote.quotedAt,
      },
    };
  } finally {
    fxRefreshInProgress = false;
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

// Preferências pessoais (D83, D159, D162): tema, idioma, os dois limites de giro e a fonte do "atualizar cotação".
function updatePreferences(partial, { now = new Date() } = {}) {
  if (partial.theme !== undefined && !THEMES.includes(partial.theme)) {
    throw new ValidationError(`Tema inválido. Use ${THEMES.join(', ')}.`, 'INVALID_THEME');
  }
  if (partial.language !== undefined && !LANGUAGES.includes(partial.language)) {
    throw new ValidationError(`Idioma inválido. Use ${LANGUAGES.join(', ')}.`, 'INVALID_LANGUAGE');
  }
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
  for (const key of ['theme', 'language', 'inventoryView', 'fxRefreshSource', 'fastTurnoverDays', 'slowItemDays']) {
    if (partial[key] !== undefined) changes[key] = partial[key];
  }
  Setting.update(changes, { now });
  return getSettings();
}

module.exports = {
  resetAutoFxForTests,
  getSettings,
  getAgingThresholds,
  updateFxRate,
  updatePreferences,
  refreshFxRate,
  isFxRefreshInProgress,
};

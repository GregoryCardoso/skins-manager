'use strict';

const Setting = require('../models/Setting');
const { ValidationError } = require('../errors/AppError');
const { isValidFxRate } = require('./currencyService');
const { THEMES, LANGUAGES } = require('../config/constants');

function getSettings() {
  return Setting.get();
}

function updateFxRate(usdBrlRate, { now = new Date() } = {}) {
  if (!isValidFxRate(usdBrlRate)) {
    throw new ValidationError('Cotação USD→BRL inválida: informe um número maior que zero.', 'INVALID_FX_RATE');
  }
  Setting.update({ usdBrlRate, usdBrlRateUpdatedAt: now.toISOString() }, { now });
  return getSettings();
}

// Preferências pessoais (D83): tema e idioma. A Etapa 7 estende a lista branca.
function updatePreferences(partial, { now = new Date() } = {}) {
  if (partial.theme !== undefined && !THEMES.includes(partial.theme)) {
    throw new ValidationError(`Tema inválido. Use ${THEMES.join(', ')}.`, 'INVALID_THEME');
  }
  if (partial.language !== undefined && !LANGUAGES.includes(partial.language)) {
    throw new ValidationError(`Idioma inválido. Use ${LANGUAGES.join(', ')}.`, 'INVALID_LANGUAGE');
  }
  const changes = {};
  if (partial.theme !== undefined) changes.theme = partial.theme;
  if (partial.language !== undefined) changes.language = partial.language;
  Setting.update(changes, { now });
  return getSettings();
}

module.exports = { getSettings, updateFxRate, updatePreferences };

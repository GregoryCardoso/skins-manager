'use strict';

const Setting = require('../models/Setting');
const { ValidationError } = require('../errors/AppError');
const { isValidFxRate } = require('./currencyService');

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

module.exports = { getSettings, updateFxRate };

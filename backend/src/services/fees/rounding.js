'use strict';

const { ValidationError } = require('../../errors/AppError');

const MODES = ['CEIL', 'ROUND', 'FLOOR'];
const PPM = 1e6;

function assertMode(mode) {
  if (!MODES.includes(mode)) {
    throw new ValidationError(`Modo de arredondamento inválido: ${mode}`, 'INVALID_ROUNDING');
  }
}

// base × taxa com aritmética inteira (taxa em partes por milhão), sem ruído de ponto flutuante (D34).
function applyRateRounding(baseCents, rate, mode) {
  assertMode(mode);
  if (!Number.isInteger(baseCents) || baseCents < 0) {
    throw new ValidationError('Base de cálculo da taxa deve ser um inteiro de centavos maior ou igual a 0.');
  }
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) {
    throw new ValidationError('Taxa inválida.');
  }
  const ppm = Math.round(rate * PPM);
  const product = baseCents * ppm;
  const remainder = product % PPM;
  const quotient = (product - remainder) / PPM;
  if (mode === 'FLOOR') return quotient;
  if (mode === 'CEIL') return quotient + (remainder > 0 ? 1 : 0);
  return quotient + (2 * remainder >= PPM ? 1 : 0);
}

// Arredonda resultados REAL (ex.: valor × cotação). ROUND = meio afastando de zero.
function roundCents(value, mode) {
  assertMode(mode);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError('Valor inválido para arredondamento.');
  }
  const snap = Math.round(value * 1e4) / 1e4;
  let result;
  if (mode === 'CEIL') result = Math.ceil(snap);
  else if (mode === 'FLOOR') result = Math.floor(snap);
  else result = Math.sign(snap) * Math.round(Math.abs(snap));
  return result + 0; // evita -0
}

module.exports = { applyRateRounding, roundCents, MODES };

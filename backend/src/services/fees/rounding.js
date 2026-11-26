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
// `unitCents` (D369 A3): o resultado é arredondado para um múltiplo da unidade mínima da moeda (1 nas moedas com 2 casas; 100 em
// JPY, KRW e CLP). Com unidade 1 é o cálculo de sempre.
function applyRateRounding(baseCents, rate, mode, unitCents = 1) {
  assertMode(mode);
  if (!Number.isSafeInteger(baseCents) || baseCents < 0) {
    throw new ValidationError(
      'Base de cálculo da taxa deve ser um inteiro seguro de centavos maior ou igual a 0.',
      'INVALID_AMOUNT'
    );
  }
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0) {
    throw new ValidationError('Taxa inválida.', 'INVALID_RATE');
  }
  if (!Number.isSafeInteger(unitCents) || unitCents < 1) {
    throw new ValidationError('Unidade mínima inválida para arredondamento.', 'INVALID_AMOUNT');
  }
  // BigInt: base × ppm chega a 5e13 × 1e6 com o teto de VND (11.11); em Number passaria do inteiro seguro. O resultado final nunca
  // passa de base + unidade, então volta a Number sem perda.
  const ppm = BigInt(Math.round(rate * PPM));
  const product = BigInt(baseCents) * ppm;
  const divisor = BigInt(PPM) * BigInt(unitCents);
  const remainder = product % divisor;
  const quotient = product / divisor;
  let units;
  if (mode === 'FLOOR') units = quotient;
  else if (mode === 'CEIL') units = quotient + (remainder > 0n ? 1n : 0n);
  else units = quotient + (2n * remainder >= divisor ? 1n : 0n);
  const result = units * BigInt(unitCents);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ValidationError('Valor grande demais para calcular a taxa.', 'INVALID_AMOUNT');
  }
  return Number(result);
}

// Arredonda resultados REAL (ex.: valor × cotação). ROUND = meio afastando de zero.
function roundCents(value, mode) {
  assertMode(mode);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError('Valor inválido para arredondamento.', 'INVALID_AMOUNT');
  }
  const snap = Math.round(value * 1e4) / 1e4;
  let result;
  if (mode === 'CEIL') result = Math.ceil(snap);
  else if (mode === 'FLOOR') result = Math.floor(snap);
  else result = Math.sign(snap) * Math.round(Math.abs(snap));
  return result + 0; // evita -0
}

// Arredonda para um múltiplo da unidade mínima da moeda (`unitCents`: 1 nas moedas com 2 casas; 100 em JPY, KRW e CLP, D369 A3).
// Com unidade 1 é igual a `roundCents`.
function roundToUnit(valueCents, unitCents, mode) {
  if (!Number.isSafeInteger(unitCents) || unitCents < 1) {
    throw new ValidationError('Unidade mínima inválida para arredondamento.', 'INVALID_AMOUNT');
  }
  if (unitCents === 1) return roundCents(valueCents, mode);
  return roundCents(valueCents / unitCents, mode) * unitCents + 0; // evita -0
}

module.exports = { applyRateRounding, roundCents, roundToUnit, MODES };

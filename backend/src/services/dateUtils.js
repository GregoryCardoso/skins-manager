'use strict';

// Helpers únicos de data (T15). Datas inválidas viram ValidationError INVALID_DATE.
const { ValidationError } = require('../errors/AppError');

// Aceita Date ou string/número parseável; nulo, indefinido ou inválido -> INVALID_DATE.
function parseDate(value, label = 'Data') {
  const date = value instanceof Date ? value : new Date(value);
  if (value === null || value === undefined || Number.isNaN(date.getTime())) {
    throw new ValidationError(`${label} inválida.`, 'INVALID_DATE');
  }
  return date;
}

// ISO 8601 em UTC (D7).
function toIso(value, label = 'Data') {
  return parseDate(value, label).toISOString();
}

const SP_DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// "dd/mm/aaaa HH:mm" em America/Sao_Paulo.
function formatDateTimeBr(value, label = 'Data') {
  const parts = Object.fromEntries(SP_DATE_TIME.formatToParts(parseDate(value, label)).map((p) => [p.type, p.value]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

module.exports = { parseDate, toIso, formatDateTimeBr };

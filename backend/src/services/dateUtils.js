'use strict';

// Helpers únicos de data (T15). Datas inválidas viram ValidationError INVALID_DATE.
const { ValidationError } = require('../errors/AppError');

// ISO 8601 com fuso explícito (Z ou ±HH:MM). Segundos e fração são opcionais (fração só com segundos).
const ISO_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

function parseIsoString(value) {
  const m = ISO_WITH_ZONE.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1, 6).map(Number);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const offH = m[8] === undefined ? 0 : Number(m[8]);
  const offM = m[9] === undefined ? 0 : Number(m[9]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 || offH > 23 || offM > 59) return null;
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day); // Date.UTC trata anos 0-99 como 1900+
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
    return null; // data impossível (ex.: 2026-02-30)
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Aceita Date ou string ISO 8601 com Z/offset; qualquer outra coisa -> INVALID_DATE.
function parseDate(value, label = 'Data', extra) {
  let date = null;
  if (value instanceof Date) date = value;
  else if (typeof value === 'string') date = parseIsoString(value);
  if (!date || Number.isNaN(date.getTime())) {
    throw new ValidationError(`${label} inválida.`, 'INVALID_DATE', extra);
  }
  return date;
}

// ISO 8601 em UTC (D7).
function toIso(value, label = 'Data', extra) {
  return parseDate(value, label, extra).toISOString();
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

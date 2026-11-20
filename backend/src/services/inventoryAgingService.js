'use strict';

// Tempo no inventário (2.6): dias inteiros, faixas, ordenação e filtro de parados.
const env = require('../config/env');
const { ValidationError } = require('../errors/AppError');

const DAY_MS = 86400000;
const FAST_DAYS = 7;
const MIN_SLOW_ITEM_DAYS = 8;

const SP_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function toDate(value, label = 'Data') {
  const date = value instanceof Date ? value : new Date(value);
  if (value === null || value === undefined || Number.isNaN(date.getTime())) {
    throw new ValidationError(`${label} inválida.`, 'INVALID_DATE');
  }
  return date;
}

function assertSlowItemDays(slowItemDays) {
  if (!Number.isInteger(slowItemDays) || slowItemDays < MIN_SLOW_ITEM_DAYS) {
    throw new Error(`Configuração inválida: SLOW_ITEM_DAYS deve ser um inteiro maior ou igual a ${MIN_SLOW_ITEM_DAYS}.`);
  }
}

function daysBetween(start, end) {
  const ms = toDate(end, 'Data final').getTime() - toDate(start, 'Data inicial').getTime();
  return Math.max(0, Math.floor(ms / DAY_MS));
}

function classifyStock(days, slowItemDays = env.slowItemDays) {
  assertSlowItemDays(slowItemDays);
  if (days <= FAST_DAYS) return 'RECENTE';
  if (days <= slowItemDays) return 'EM_GIRO';
  return 'AGARRADO';
}

function classifyTurnaround(days, slowItemDays = env.slowItemDays) {
  assertSlowItemDays(slowItemDays);
  if (days <= FAST_DAYS) return 'GIRO_RAPIDO';
  if (days <= slowItemDays) return 'GIRO_NORMAL';
  return 'DEMOROU_VENDER';
}

// "YYYY-MM-DD" do instante em America/Sao_Paulo.
function toSaoPauloDate(dateOrIso) {
  return SP_FORMAT.format(toDate(dateOrIso));
}

function assertAcquiredAtNotFuture(acquiredAt, now = new Date()) {
  if (toSaoPauloDate(acquiredAt) > toSaoPauloDate(now)) {
    throw new ValidationError('A data de aquisição não pode ser futura.', 'ACQUIRED_AT_IN_FUTURE');
  }
}

function getAging(item, { slowItemDays = env.slowItemDays, now = new Date() } = {}) {
  if (item.status === 'VENDIDO') {
    const turnaroundDays = daysBetween(item.acquiredAt, item.soldAt);
    return { turnaroundDays, turnaroundBucket: classifyTurnaround(turnaroundDays, slowItemDays) };
  }
  const daysInInventory = daysBetween(item.acquiredAt, now);
  return { daysInInventory, agingBucket: classifyStock(daysInInventory, slowItemDays) };
}

// Ordenação estável, valor por direção e desempate por id ASC; não muta a entrada.
function sortBy(items, valueOf, order) {
  const sign = order === 'asc' ? 1 : -1;
  return items
    .map((item) => ({ item, value: valueOf(item) }))
    .sort((a, b) => {
      if (a.value !== b.value) return (a.value - b.value) * sign;
      return (a.item.id ?? 0) - (b.item.id ?? 0);
    })
    .map((entry) => entry.item);
}

function sortByAge(items, order = 'desc', now = new Date()) {
  return sortBy(items, (item) => daysBetween(item.acquiredAt, now), order);
}

// Itens sem soldAt (em estoque) vão sempre para o fim.
function sortByTurnaround(items, order = 'asc') {
  const sold = items.filter((item) => item.soldAt);
  const unsold = items.filter((item) => !item.soldAt);
  return [...sortBy(sold, (item) => daysBetween(item.acquiredAt, item.soldAt), order), ...sortBy(unsold, () => 0, 'asc')];
}

function filterStagnant(items, slowItemDays = env.slowItemDays, now = new Date()) {
  return items.filter(
    (item) =>
      item.status === 'EM_ESTOQUE' && classifyStock(daysBetween(item.acquiredAt, now), slowItemDays) === 'AGARRADO'
  );
}

module.exports = {
  daysBetween,
  classifyStock,
  classifyTurnaround,
  toSaoPauloDate,
  assertAcquiredAtNotFuture,
  getAging,
  sortByAge,
  sortByTurnaround,
  filterStagnant,
};

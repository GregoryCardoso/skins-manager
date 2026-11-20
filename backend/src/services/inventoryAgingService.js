'use strict';

// Tempo no inventário (2.6): dias inteiros, faixas, ordenação e filtro de parados.
const env = require('../config/env');
const { MIN_SLOW_ITEM_DAYS } = require('../config/constants');
const { ValidationError } = require('../errors/AppError');
const { parseDate } = require('./dateUtils');

const DAY_MS = 86400000;
const FAST_DAYS = 7;

const SP_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// Erro de programação (como D46): dias inválidos nunca devem virar uma faixa por acidente (T18).
function assertDays(days) {
  if (!Number.isInteger(days) || days < 0) {
    throw new Error(`Quantidade de dias inválida: deve ser um inteiro maior ou igual a 0 (recebido ${days}).`);
  }
}

function assertSlowItemDays(slowItemDays) {
  if (!Number.isInteger(slowItemDays) || slowItemDays < MIN_SLOW_ITEM_DAYS) {
    throw new Error(`Configuração inválida: SLOW_ITEM_DAYS deve ser um inteiro maior ou igual a ${MIN_SLOW_ITEM_DAYS}.`);
  }
}

function daysBetween(start, end) {
  const ms = parseDate(end, 'Data final').getTime() - parseDate(start, 'Data inicial').getTime();
  return Math.max(0, Math.floor(ms / DAY_MS));
}

function classifyStock(days, slowItemDays = env.slowItemDays) {
  assertSlowItemDays(slowItemDays);
  assertDays(days);
  if (days <= FAST_DAYS) return 'RECENTE';
  if (days <= slowItemDays) return 'EM_GIRO';
  return 'AGARRADO';
}

function classifyTurnaround(days, slowItemDays = env.slowItemDays) {
  assertSlowItemDays(slowItemDays);
  assertDays(days);
  if (days <= FAST_DAYS) return 'GIRO_RAPIDO';
  if (days <= slowItemDays) return 'GIRO_NORMAL';
  return 'DEMOROU_VENDER';
}

// "YYYY-MM-DD" do instante em America/Sao_Paulo.
function toSaoPauloDate(dateOrIso) {
  return SP_FORMAT.format(parseDate(dateOrIso));
}

// Recusa datas em dia posterior ao de `now` em America/Sao_Paulo (D53, P8).
function assertNotFutureDay(date, now = new Date(), { code, message }) {
  if (toSaoPauloDate(date) > toSaoPauloDate(now)) {
    throw new ValidationError(message, code);
  }
}

function assertAcquiredAtNotFuture(acquiredAt, now = new Date()) {
  assertNotFutureDay(acquiredAt, now, {
    code: 'ACQUIRED_AT_IN_FUTURE',
    message: 'A data de aquisição não pode ser futura.',
  });
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

// Mais antigo = maior idade; ordena pelo instante exato de aquisição (T21), não por dias inteiros.
function sortByAge(items, order = 'desc', now = new Date()) {
  const nowMs = parseDate(now, 'Data atual').getTime();
  return sortBy(items, (item) => nowMs - parseDate(item.acquiredAt, 'Data de aquisição').getTime(), order);
}

// Itens sem soldAt (em estoque) vão sempre para o fim.
function sortByTurnaround(items, order = 'asc') {
  const sold = items.filter((item) => item.status === 'VENDIDO');
  const unsold = items.filter((item) => item.status !== 'VENDIDO');
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
  assertNotFutureDay,
  assertAcquiredAtNotFuture,
  getAging,
  sortByAge,
  sortByTurnaround,
  filterStagnant,
};

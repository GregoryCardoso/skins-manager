'use strict';

// Tempo no inventário (2.6): dias inteiros, faixas, ordenação e filtro de parados.
const env = require('../config/env');
const { DEFAULT_FAST_TURNOVER_DAYS, MAX_SLOW_ITEM_DAYS } = require('../config/constants');
const { ValidationError } = require('../errors/AppError');
const { parseDate } = require('./dateUtils');

const DAY_MS = 86400000;

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

// Limites efetivos (D159): salvo ?? padrão. Combinação incoerente (só ao trocar o .env) usa rápido = agarrado − 1.
// Pura. `adjusted: true` quando a salvaguarda foi aplicada.
function resolveAgingThresholds({ fastSaved = null, slowSaved = null, envSlowItemDays = env.slowItemDays } = {}) {
  const slowItemDays = slowSaved ?? envSlowItemDays;
  const fastTurnoverDays = fastSaved ?? DEFAULT_FAST_TURNOVER_DAYS;
  if (fastTurnoverDays >= 1 && fastTurnoverDays < slowItemDays) return { fastTurnoverDays, slowItemDays, adjusted: false };
  return { fastTurnoverDays: slowItemDays - 1, slowItemDays, adjusted: true };
}

function defaultThresholds() {
  const { fastTurnoverDays, slowItemDays } = resolveAgingThresholds();
  return { fastTurnoverDays, slowItemDays };
}

// Erro de programação: os limites chegam validados (1 <= F < S <= 365).
function assertThresholds(thresholds) {
  const { fastTurnoverDays: f, slowItemDays: s } = thresholds ?? {};
  if (!Number.isInteger(f) || !Number.isInteger(s) || f < 1 || f >= s || s > MAX_SLOW_ITEM_DAYS) {
    throw new Error(
      `Configuração inválida: os limites de giro devem ser inteiros com 1 <= rápido < agarrado <= ${MAX_SLOW_ITEM_DAYS}.`
    );
  }
}

function daysBetween(start, end) {
  const ms = parseDate(end, 'Data final').getTime() - parseDate(start, 'Data inicial').getTime();
  return Math.max(0, Math.floor(ms / DAY_MS));
}

function classifyStock(days, thresholds = defaultThresholds()) {
  assertThresholds(thresholds);
  assertDays(days);
  if (days <= thresholds.fastTurnoverDays) return 'RECENTE';
  if (days <= thresholds.slowItemDays) return 'EM_GIRO';
  return 'AGARRADO';
}

function classifyTurnaround(days, thresholds = defaultThresholds()) {
  assertThresholds(thresholds);
  assertDays(days);
  if (days <= thresholds.fastTurnoverDays) return 'GIRO_RAPIDO';
  if (days <= thresholds.slowItemDays) return 'GIRO_NORMAL';
  return 'DEMOROU_VENDER';
}

// Início da contagem do giro (D160): `tradeUnlockAt` se existir e for posterior a `acquiredAt`; senão `acquiredAt`.
function listingStart(item) {
  if (item.tradeUnlockAt === null || item.tradeUnlockAt === undefined) return item.acquiredAt;
  const unlockMs = parseDate(item.tradeUnlockAt, 'Fim do trade lock').getTime();
  return unlockMs > parseDate(item.acquiredAt, 'Data de aquisição').getTime() ? item.tradeUnlockAt : item.acquiredAt;
}

// Item em estoque ainda bloqueado (`now < tradeUnlockAt`; igualdade = liberado, como 2.3).
function isInTradeLock(item, now = new Date()) {
  if (item.status === 'VENDIDO' || item.tradeUnlockAt === null || item.tradeUnlockAt === undefined) return false;
  return parseDate(now, 'Data atual').getTime() < parseDate(item.tradeUnlockAt, 'Fim do trade lock').getTime();
}

// Dias da liberação (ou aquisição) até a venda, mínimo 0 (D160).
function turnaroundDaysOf(item) {
  return daysBetween(listingStart(item), item.soldAt);
}

// Dia civil { year, month, day } (números) do instante em America/Sao_Paulo.
function toSaoPauloDay(dateOrIso) {
  const parts = Object.fromEntries(SP_FORMAT.formatToParts(parseDate(dateOrIso)).map((p) => [p.type, Number(p.value)]));
  return { year: parts.year, month: parts.month, day: parts.day };
}

// Comparação numérica de dias civis (ano, mês, dia): negativo, 0 ou positivo.
function compareDays(a, b) {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

// "YYYY-MM-DD" (ano com 4 dígitos) do instante em America/Sao_Paulo; só para exibição, nunca para comparar.
function toSaoPauloDate(dateOrIso) {
  const { year, month, day } = toSaoPauloDay(dateOrIso);
  const pad = (n, size) => String(n).padStart(size, '0');
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

// Recusa datas em dia posterior ao de `now` em America/Sao_Paulo (D53, P8).
function assertNotFutureDay(date, now = new Date(), { code, message, field }) {
  if (compareDays(toSaoPauloDay(date), toSaoPauloDay(now)) > 0) {
    throw new ValidationError(message, code, field ? { field } : undefined);
  }
}

function assertAcquiredAtNotFuture(acquiredAt, now = new Date()) {
  assertNotFutureDay(acquiredAt, now, {
    code: 'ACQUIRED_AT_IN_FUTURE',
    message: 'A data de aquisição não pode ser futura.',
    field: 'acquiredAt',
  });
}

function getAging(item, { thresholds = defaultThresholds(), now = new Date() } = {}) {
  if (item.status === 'VENDIDO') {
    const turnaroundDays = turnaroundDaysOf(item);
    return {
      turnaroundDays,
      turnaroundBucket: classifyTurnaround(turnaroundDays, thresholds),
      daysHeld: daysBetween(item.acquiredAt, item.soldAt),
    };
  }
  const daysInInventory = daysBetween(item.acquiredAt, now);
  if (isInTradeLock(item, now)) return { daysInInventory, daysForSale: null, agingBucket: 'EM_TRADE_LOCK' };
  const daysForSale = daysBetween(listingStart(item), now);
  return { daysInInventory, daysForSale, agingBucket: classifyStock(daysForSale, thresholds) };
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

// Mais antigo à venda primeiro em `desc`, pelo instante exato da liberação (T21, D160). Itens em trade lock vão
// sempre para o fim (nas duas direções), por `tradeUnlockAt` crescente e depois id.
function sortByAge(items, order = 'desc', now = new Date()) {
  const nowMs = parseDate(now, 'Data atual').getTime();
  const nowDate = new Date(nowMs);
  const locked = items.filter((item) => isInTradeLock(item, nowDate));
  const free = items.filter((item) => !isInTradeLock(item, nowDate));
  return [
    ...sortBy(free, (item) => nowMs - parseDate(listingStart(item), 'Data de liberação').getTime(), order),
    ...sortBy(locked, (item) => parseDate(item.tradeUnlockAt, 'Fim do trade lock').getTime(), 'asc'),
  ];
}

// Itens sem soldAt (em estoque) vão sempre para o fim.
function sortByTurnaround(items, order = 'asc') {
  const sold = items.filter((item) => item.status === 'VENDIDO');
  const unsold = items.filter((item) => item.status !== 'VENDIDO');
  return [...sortBy(sold, turnaroundDaysOf, order), ...sortBy(unsold, () => 0, 'asc')];
}

// "YYYY-MM-DD" -> { year, month, day } numéricos; undefined/null -> null.
function parseDayString(value) {
  if (value === undefined || value === null) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  return { year, month, day };
}

// O dia civil (America/Sao_Paulo) do instante está dentro de [from, to] (inclusivos; cada lado opcional).
function isWithinSaoPauloDays(dateIso, { from, to } = {}) {
  const day = toSaoPauloDay(dateIso);
  const f = parseDayString(from);
  const t = parseDayString(to);
  if (f && compareDays(day, f) < 0) return false;
  if (t && compareDays(day, t) > 0) return false;
  return true;
}

function filterSoldInPeriod(items, { soldFrom, soldTo } = {}) {
  return items.filter(
    (item) => item.status === 'VENDIDO' && isWithinSaoPauloDays(item.soldAt, { from: soldFrom, to: soldTo })
  );
}

// Instante exato da venda; desempate por id ASC; itens sem soldAt vão ao fim; não muta.
function sortBySoldAt(items, order = 'desc') {
  const sold = items.filter((item) => item.status === 'VENDIDO');
  const unsold = items.filter((item) => item.status !== 'VENDIDO');
  return [
    ...sortBy(sold, (item) => parseDate(item.soldAt, 'Data de venda').getTime(), order),
    ...sortBy(unsold, () => 0, 'asc'),
  ];
}

// Só em estoque, liberado e `AGARRADO` pelos dias à venda; item em trade lock nunca entra (D160).
function filterStagnant(items, thresholds = defaultThresholds(), now = new Date()) {
  return items.filter(
    (item) =>
      item.status === 'EM_ESTOQUE' &&
      !isInTradeLock(item, now) &&
      classifyStock(daysBetween(listingStart(item), now), thresholds) === 'AGARRADO'
  );
}

module.exports = {
  resolveAgingThresholds,
  listingStart,
  isInTradeLock,
  turnaroundDaysOf,
  daysBetween,
  classifyStock,
  classifyTurnaround,
  toSaoPauloDate,
  assertNotFutureDay,
  assertAcquiredAtNotFuture,
  getAging,
  sortByAge,
  sortByTurnaround,
  sortBySoldAt,
  isWithinSaoPauloDays,
  filterSoldInPeriod,
  filterStagnant,
};

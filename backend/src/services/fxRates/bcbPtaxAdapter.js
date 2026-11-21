'use strict';

// Adapter da PTAX do Banco Central (D147): recurso CotacaoDolarDia do Olinda, cotação de VENDA.
// Funções puras (`buildPtaxUrl`, `parsePtaxResponse`, `candidateDays`) e a rede injetável (`fetchFn`).
// Nunca chama a rede por conta própria: quem decide é o botão da tela.
const {
  PTAX_BASE_URL,
  PTAX_CALL_TIMEOUT_MS,
  PTAX_TOTAL_TIMEOUT_MS,
  PTAX_MAX_LOOKBACK_DAYS,
  FX_MIN_RATE,
  FX_MAX_RATE,
} = require('../../config/constants');
const { UpstreamError } = require('../../errors/AppError');
const { fetchJson, fetchFailed: buildFetchFailed, invalidResponse: buildInvalidResponse } = require('./fxHttp');

const SOURCE = 'PTAX';

const DAY_MS = 86400000;
const SP_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const fetchFailed = () => buildFetchFailed(SOURCE);
const invalidResponse = (detail) => buildInvalidResponse(SOURCE, detail);

const pad = (n, size = 2) => String(n).padStart(size, '0');

// Dia civil { year, month, day } do instante em America/Sao_Paulo.
function toSaoPauloDayParts(date) {
  const parts = Object.fromEntries(SP_FORMAT.formatToParts(date).map((p) => [p.type, Number(p.value)]));
  return { year: parts.year, month: parts.month, day: parts.day };
}

// Dias candidatos: hoje (fuso de São Paulo) e até 7 dias para trás, sem sábados e domingos. "YYYY-MM-DD".
function candidateDays(now, lookbackDays = PTAX_MAX_LOOKBACK_DAYS) {
  const today = toSaoPauloDayParts(now);
  const base = Date.UTC(today.year, today.month - 1, today.day);
  const days = [];
  for (let back = 0; back <= lookbackDays; back += 1) {
    const d = new Date(base - back * DAY_MS);
    const weekday = d.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    days.push(`${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
  }
  return days;
}

// `day`: "YYYY-MM-DD" -> URL do BCB com a data no formato MM-DD-AAAA.
function buildPtaxUrl(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new Error(`Data inválida para a PTAX: ${day}`);
  return (
    `${PTAX_BASE_URL}?@dataCotacao='${m[2]}-${m[3]}-${m[1]}'` +
    '&$top=1&$format=json&$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao'
  );
}

// "2026-11-19 13:04:28.123" (hora de Brasília) -> ISO UTC.
function parseQuotedAt(text) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,9})?$/.exec(typeof text === 'string' ? text.trim() : '');
  if (!m) throw invalidResponse('data da cotação');
  const millis = m[3] ? m[3].slice(1, 4).padEnd(3, '0') : '000';
  const date = new Date(`${m[1]}T${m[2]}.${millis}-03:00`);
  if (Number.isNaN(date.getTime())) throw invalidResponse('data da cotação');
  return date.toISOString();
}

function validRate(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= FX_MIN_RATE && value <= FX_MAX_RATE;
}

// JSON do BCB -> null (sem cotação nesse dia) ou { buyRate, sellRate, quotedAt }; formato inesperado lança.
function parsePtaxResponse(json) {
  if (json === null || typeof json !== 'object' || !Array.isArray(json.value)) throw invalidResponse('formato');
  if (json.value.length === 0) return null;
  const row = json.value[0];
  if (row === null || typeof row !== 'object') throw invalidResponse('formato');
  if (!validRate(row.cotacaoVenda)) throw invalidResponse('cotação de venda');
  const buyRate = validRate(row.cotacaoCompra) ? row.cotacaoCompra : null;
  return { buyRate, sellRate: row.cotacaoVenda, quotedAt: parseQuotedAt(row.dataHoraCotacao) };
}

// Consulta um dia: null (sem cotação) ou { buyRate, sellRate, quotedAt }.
async function fetchPtaxForDate(day, { fetchFn, callTimeoutMs = PTAX_CALL_TIMEOUT_MS, totalSignal }) {
  const json = await fetchJson(buildPtaxUrl(day), { fetchFn, source: SOURCE, callTimeoutMs, totalSignal });
  return parsePtaxResponse(json);
}

// Última PTAX de venda disponível: hoje (São Paulo) e recuo dia a dia, pulando fins de semana, por até 7 dias.
// Retorna { buyRate, sellRate, quotedAt, quoteDate }; sem cotação em nenhum dia -> PTAX_NOT_FOUND.
async function fetchLatestPtax({
  fetchFn = globalThis.fetch,
  now = new Date(),
  callTimeoutMs = PTAX_CALL_TIMEOUT_MS,
  totalTimeoutMs = PTAX_TOTAL_TIMEOUT_MS,
} = {}) {
  if (typeof fetchFn !== 'function') throw fetchFailed();
  const total = new AbortController();
  const totalTimer = setTimeout(() => total.abort(), totalTimeoutMs);
  try {
    for (const day of candidateDays(now)) {
      const quote = await fetchPtaxForDate(day, { fetchFn, callTimeoutMs, totalSignal: total.signal });
      if (quote) return { ...quote, quoteDate: day };
    }
  } finally {
    clearTimeout(totalTimer);
  }
  throw new UpstreamError(
    'O Banco Central não publicou a PTAX nos últimos dias. Tente novamente mais tarde ou informe a cotação manualmente.',
    'PTAX_NOT_FOUND',
    { params: { source: SOURCE } }
  );
}

// Contrato comum das fontes (D162): { source, rate, buyRate, sellRate, quotedAt } com a PTAX de venda.
async function fetchLatestRate(options = {}) {
  const quote = await fetchLatestPtax(options);
  return { source: SOURCE, rate: quote.sellRate, buyRate: quote.buyRate, sellRate: quote.sellRate, quotedAt: quote.quotedAt };
}

module.exports = { SOURCE, buildPtaxUrl, parsePtaxResponse, candidateDays, fetchPtaxForDate, fetchLatestPtax, fetchLatestRate };

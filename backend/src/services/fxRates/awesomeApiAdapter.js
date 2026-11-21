'use strict';

// Adapter da AwesomeAPI (D162): cotação comercial USD→BRL em tempo real, venda = `ask`. Sem chave.
// Funções puras (`parseAwesomeApiResponse`) e a rede injetável (`fetchFn`); nunca chama a rede por conta própria.
const { AWESOMEAPI_URL, AWESOMEAPI_TIMEOUT_MS, FX_MIN_RATE, FX_MAX_RATE } = require('../../config/constants');
const { fetchJson, invalidResponse } = require('./fxHttp');

const SOURCE = 'AWESOMEAPI';
const DECIMAL = /^\d+(\.\d+)?$/;

// Número em texto decimal ("5.1254") dentro de FX_MIN_RATE..FX_MAX_RATE; senão null.
function parseRate(value) {
  if (typeof value !== 'string' || !DECIMAL.test(value.trim())) return null;
  const rate = Number(value.trim());
  return Number.isFinite(rate) && rate >= FX_MIN_RATE && rate <= FX_MAX_RATE ? rate : null;
}

// `timestamp` (segundos Unix, UTC) em texto ou número -> ISO; senão null.
function quotedAtFromTimestamp(value) {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^\d{1,12}$/.test(text.trim())) return null;
  const seconds = Number(text.trim());
  if (seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// `create_date` ("2026-11-20 12:00:00", horário de Brasília) -> ISO UTC; senão null.
function quotedAtFromCreateDate(value) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(typeof value === 'string' ? value.trim() : '');
  if (!m) return null;
  const date = new Date(`${m[1]}T${m[2]}.000-03:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// JSON da AwesomeAPI -> { buyRate, sellRate, quotedAt }; formato inesperado lança FX_INVALID_RESPONSE.
function parseAwesomeApiResponse(json) {
  const row = json !== null && typeof json === 'object' ? json.USDBRL : null;
  if (row === null || row === undefined || typeof row !== 'object') throw invalidResponse(SOURCE, 'formato');
  if (row.code !== 'USD' || row.codein !== 'BRL') throw invalidResponse(SOURCE, 'par de moedas');
  const sellRate = parseRate(row.ask);
  if (sellRate === null) throw invalidResponse(SOURCE, 'cotação de venda');
  const buyRate = parseRate(row.bid);
  const quotedAt = quotedAtFromTimestamp(row.timestamp) || quotedAtFromCreateDate(row.create_date);
  if (!quotedAt) throw invalidResponse(SOURCE, 'data da cotação');
  return { buyRate, sellRate, quotedAt };
}

// Contrato comum das fontes: { source, rate, buyRate, sellRate, quotedAt }. `now` não é usado (cotação em tempo real).
async function fetchLatestRate({ fetchFn = globalThis.fetch, now = new Date(), callTimeoutMs = AWESOMEAPI_TIMEOUT_MS } = {}) {
  const json = await fetchJson(AWESOMEAPI_URL, { fetchFn, source: SOURCE, callTimeoutMs });
  const quote = parseAwesomeApiResponse(json);
  return { source: SOURCE, rate: quote.sellRate, buyRate: quote.buyRate, sellRate: quote.sellRate, quotedAt: quote.quotedAt };
}

module.exports = { SOURCE, parseAwesomeApiResponse, fetchLatestRate };

'use strict';

// Adapter da AwesomeAPI (D162, D369): cotação comercial USD→<moeda> em tempo real, venda = `ask`. Sem chave. O par `USD-<moeda>` e a
// faixa de sanidade (FX_RATE_BOUNDS) vêm da moeda pedida (padrão BRL).
// Funções puras (`parseAwesomeApiResponse`) e a rede injetável (`fetchFn`); nunca chama a rede por conta própria.
const { AWESOMEAPI_LAST_URL_PREFIX, AWESOMEAPI_TIMEOUT_MS, AWESOMEAPI_PAIRS, FX_RATE_BOUNDS } = require('../../config/constants');
const { ValidationError } = require('../../errors/AppError');
const { fetchJson, invalidResponse } = require('./fxHttp');

const SOURCE = 'AWESOMEAPI';
const DECIMAL = /^\d+(\.\d+)?$/;

// Número em texto decimal ("5.1254") dentro da faixa da moeda (FX_RATE_BOUNDS); senão null.
function parseRate(value, currency) {
  const bounds = FX_RATE_BOUNDS[currency];
  if (!bounds || typeof value !== 'string' || !DECIMAL.test(value.trim())) return null;
  const rate = Number(value.trim());
  return Number.isFinite(rate) && rate >= bounds.min && rate <= bounds.max ? rate : null;
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
function parseAwesomeApiResponse(json, currency = 'BRL') {
  const row = json !== null && typeof json === 'object' ? json[`USD${currency}`] : null;
  if (row === null || row === undefined || typeof row !== 'object') throw invalidResponse(SOURCE, 'formato');
  if (row.code !== 'USD' || row.codein !== currency) throw invalidResponse(SOURCE, 'par de moedas');
  const sellRate = parseRate(row.ask, currency);
  if (sellRate === null) throw invalidResponse(SOURCE, 'cotação de venda');
  const buyRate = parseRate(row.bid, currency);
  const quotedAt = quotedAtFromTimestamp(row.timestamp) || quotedAtFromCreateDate(row.create_date);
  if (!quotedAt) throw invalidResponse(SOURCE, 'data da cotação');
  return { buyRate, sellRate, quotedAt };
}

// Contrato comum das fontes: { source, rate, buyRate, sellRate, quotedAt }. `now` não é usado (cotação em tempo real).
async function fetchLatestRate({ currency = 'BRL', fetchFn = globalThis.fetch, now = new Date(), callTimeoutMs = AWESOMEAPI_TIMEOUT_MS } = {}) {
  if (!AWESOMEAPI_PAIRS.includes(currency)) {
    throw new ValidationError(`A moeda ${currency} não tem par na AwesomeAPI.`, 'FX_SOURCE_NOT_SUPPORTED', {
      field: 'source', params: { currency, source: SOURCE },
    });
  }
  const json = await fetchJson(`${AWESOMEAPI_LAST_URL_PREFIX}${currency}`, { fetchFn, source: SOURCE, callTimeoutMs });
  const quote = parseAwesomeApiResponse(json, currency);
  return { source: SOURCE, rate: quote.sellRate, buyRate: quote.buyRate, sellRate: quote.sellRate, quotedAt: quote.quotedAt };
}

module.exports = { SOURCE, parseAwesomeApiResponse, fetchLatestRate };

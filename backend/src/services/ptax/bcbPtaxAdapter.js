'use strict';

// Adapter da PTAX do Banco Central (D147): recurso CotacaoDolarDia do Olinda, cotação de VENDA.
// Funções puras (`buildPtaxUrl`, `parsePtaxResponse`, `candidateDays`) e a rede injetável (`fetchFn`).
// Nunca chama a rede por conta própria: quem decide é o botão da tela.
const {
  PTAX_BASE_URL,
  PTAX_CALL_TIMEOUT_MS,
  PTAX_TOTAL_TIMEOUT_MS,
  PTAX_MAX_RESPONSE_BYTES,
  PTAX_MAX_LOOKBACK_DAYS,
  PTAX_MIN_RATE,
  PTAX_MAX_RATE,
} = require('../../config/constants');
const { UpstreamError } = require('../../errors/AppError');

const DAY_MS = 86400000;
const SP_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const fetchFailed = () =>
  new UpstreamError(
    'Não foi possível consultar a PTAX do Banco Central. Verifique a conexão com a internet.',
    'PTAX_FETCH_FAILED'
  );
const invalidResponse = (detail) =>
  new UpstreamError(`A resposta da PTAX do Banco Central é inválida (${detail}).`, 'PTAX_INVALID_RESPONSE');

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
  return typeof value === 'number' && Number.isFinite(value) && value >= PTAX_MIN_RATE && value <= PTAX_MAX_RATE;
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

// Lê o corpo respeitando o teto de bytes; aceita respostas com stream, `text()` ou só `json()`.
async function readBodyText(response) {
  const header =
    response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-length') : null;
  if (header !== null && header !== undefined && Number(header) > PTAX_MAX_RESPONSE_BYTES) {
    throw invalidResponse('resposta grande demais');
  }
  let text;
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > PTAX_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw invalidResponse('resposta grande demais');
      }
      chunks.push(Buffer.from(value));
    }
    text = Buffer.concat(chunks).toString('utf8');
  } else if (typeof response.text === 'function') {
    text = await response.text();
  } else if (typeof response.json === 'function') {
    text = JSON.stringify(await response.json());
  } else {
    throw fetchFailed();
  }
  if (Buffer.byteLength(text, 'utf8') > PTAX_MAX_RESPONSE_BYTES) throw invalidResponse('resposta grande demais');
  return text;
}

// Executa `task(signal)` com prazo próprio e o prazo total; a primeira expiração aborta e vira PTAX_FETCH_FAILED.
function runWithDeadline(task, { callTimeoutMs, totalSignal }) {
  const controller = new AbortController();
  let timer;
  let onTotalAbort;
  const cleanup = () => {
    clearTimeout(timer);
    if (onTotalAbort) totalSignal.removeEventListener('abort', onTotalAbort);
  };
  const expired = new Promise((_, reject) => {
    const abort = () => {
      controller.abort();
      reject(fetchFailed());
    };
    timer = setTimeout(abort, callTimeoutMs);
    if (totalSignal.aborted) abort();
    else {
      onTotalAbort = abort;
      totalSignal.addEventListener('abort', onTotalAbort, { once: true });
    }
  });
  expired.catch(() => {}); // a rejeição é tratada pelo race; evita aviso quando a tarefa termina antes
  const running = Promise.resolve().then(() => task(controller.signal));
  running.catch(() => {});
  return Promise.race([running, expired]).finally(cleanup);
}

// Consulta um dia: null (sem cotação) ou { buyRate, sellRate, quotedAt }.
async function fetchPtaxForDate(day, { fetchFn, callTimeoutMs = PTAX_CALL_TIMEOUT_MS, totalSignal }) {
  const text = await runWithDeadline(
    async (signal) => {
      let response;
      try {
        response = await fetchFn(buildPtaxUrl(day), { signal });
      } catch (err) {
        throw fetchFailed();
      }
      if (!response || response.ok === false || (response.status !== undefined && response.status !== 200)) {
        throw fetchFailed();
      }
      try {
        return await readBodyText(response);
      } catch (err) {
        if (err instanceof UpstreamError) throw err;
        throw fetchFailed();
      }
    },
    { callTimeoutMs, totalSignal }
  );
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw invalidResponse('JSON inválido');
  }
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
    'PTAX_NOT_FOUND'
  );
}

module.exports = { buildPtaxUrl, parsePtaxResponse, candidateDays, fetchPtaxForDate, fetchLatestPtax };

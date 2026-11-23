'use strict';

// Acesso HTTP ao CSFloat (D288, D289). É o ÚNICO lugar que monta o header `Authorization` com a chave da API: nada aqui
// devolve nem registra headers, URL completa, corpo de resposta ou `cause`. Todos os erros são `UpstreamError` (502) com
// `params.source = 'CSFLOAT'` e mensagem fixa. A rede (`fetchFn`) é sempre injetável; chamadas em série, nunca em paralelo.
const {
  CSFLOAT_API_BASE_URL,
  CSFLOAT_CALL_TIMEOUT_MS,
  CSFLOAT_MAX_RESPONSE_BYTES,
  CSFLOAT_RATE_LIMIT_MAX_WAIT_MS,
} = require('../../../config/constants');
const { UpstreamError } = require('../../../errors/AppError');
const { runWithDeadline, readLimitedText } = require('../../fxRates/fxHttp');

const SOURCE = 'CSFLOAT';
const AUTH_CODE_NOT_SET = 27; // corpo de erro `{ code: 27 }` = "authorization not set"

const fail = (code, message, params = {}) => new UpstreamError(message, code, { params: { source: SOURCE, ...params } });

const unreachable = () => fail('IMPORT_SOURCE_UNREACHABLE', 'Não foi possível falar com o CSFloat. Verifique a conexão com a internet.');
const authFailed = () => fail('CSFLOAT_AUTH_FAILED', 'O CSFloat recusou a chave (inválida, expirada ou sem permissão).');
const unavailable = () => fail('IMPORT_SOURCE_UNAVAILABLE', 'O CSFloat está fora do ar. Tente mais tarde.');
const formatChanged = () =>
  fail('IMPORT_SOURCE_FORMAT_CHANGED', 'O CSFloat mudou o formato dos dados. Nada foi alterado; o app precisa de uma atualização.');
const rateLimited = (retryAt) =>
  fail('IMPORT_RATE_LIMITED', 'O limite de consultas do CSFloat foi atingido. Tente de novo mais tarde.', retryAt ? { retryAt } : {});

const intHeader = (headers, name) => {
  const raw = headers && typeof headers.get === 'function' ? headers.get(name) : null;
  if (raw === null || raw === undefined || !/^\d{1,16}$/.test(String(raw).trim())) return null;
  return Number(String(raw).trim());
};

// `X-RateLimit-Reset`: instante de reinício. Aceita segundos Unix, milissegundos Unix ou segundos restantes. -> ms Unix ou null.
function resetAtMs(rawReset, nowMs) {
  if (rawReset === null) return null;
  if (rawReset > 1e11) return rawReset; // milissegundos Unix
  if (rawReset > 1e9) return rawReset * 1000; // segundos Unix
  return nowMs + rawReset * 1000; // segundos restantes
}

// Lê os headers de limite (`limit`, `remaining`, `resetAt` em ISO). Sem os headers, tudo nulo.
function readRateLimit(headers, nowMs) {
  const limit = intHeader(headers, 'x-ratelimit-limit');
  const remaining = intHeader(headers, 'x-ratelimit-remaining');
  const resetMs = resetAtMs(intHeader(headers, 'x-ratelimit-reset'), nowMs);
  return { limit, remaining, resetAt: resetMs === null ? null : new Date(resetMs).toISOString() };
}

function buildUrl(pathName, query) {
  const url = new URL(`${CSFLOAT_API_BASE_URL}${pathName}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

const defaultSleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(unreachable());
      return;
    }
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      reject(unreachable());
    };
    timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });

// Quanto esperar (ms) até o reinício do limite; null se não há como saber ou se não cabe (> 30 s ou além do prazo total).
function computeWait(resetAt, { nowMs, totalDeadlineAt }) {
  if (!resetAt) return null;
  const wait = Math.max(0, new Date(resetAt).getTime() - nowMs) + 50;
  if (wait > CSFLOAT_RATE_LIMIT_MAX_WAIT_MS) return null;
  if (Number.isFinite(totalDeadlineAt) && nowMs + wait >= totalDeadlineAt) return null;
  return wait;
}

// Uma tentativa: devolve { status, headers, text } já lido. Falha de rede/prazo vira IMPORT_SOURCE_UNREACHABLE.
async function attempt(url, { apiKey, fetchFn, callTimeoutMs, totalSignal }) {
  return runWithDeadline(
    async (signal) => {
      let response;
      try {
        response = await fetchFn(url, { method: 'GET', headers: { Authorization: apiKey, Accept: 'application/json' }, signal });
      } catch (err) {
        throw unreachable(); // nunca repassa `err` (pode citar a URL)
      }
      if (!response || typeof response.status !== 'number') throw formatChanged();
      const status = response.status;
      if (status === 401 || status === 403) throw authFailed();
      if (status >= 500) throw unavailable();
      if (status === 429) return { status, headers: response.headers, text: null };
      let text;
      try {
        text = await readLimitedText(response, CSFLOAT_MAX_RESPONSE_BYTES, formatChanged);
        if (text === null) text = typeof response.json === 'function' ? JSON.stringify(await response.json()) : null;
      } catch (err) {
        if (err instanceof UpstreamError) throw err;
        throw unreachable();
      }
      if (text === null || Buffer.byteLength(text, 'utf8') > CSFLOAT_MAX_RESPONSE_BYTES) throw formatChanged();
      return { status, headers: response.headers, text };
    },
    { source: SOURCE, callTimeoutMs, totalSignal, timeoutError: unreachable }
  );
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw formatChanged();
  }
}

// GET `pathName` (ex.: '/me') e devolve { json, rateLimit: { limit, remaining, resetAt } }.
// 429: espera até o reinício e repete UMA vez, se couber (<= 30 s e dentro do prazo total); senão IMPORT_RATE_LIMITED.
// `Remaining = 0` numa resposta 200 não espera aqui (a resposta já veio): quem pagina usa `waitForRateLimit`.
async function requestJson(
  pathName,
  { apiKey, query, fetchFn = globalThis.fetch, callTimeoutMs = CSFLOAT_CALL_TIMEOUT_MS, totalSignal, totalDeadlineAt, nowFn = Date.now, sleepFn = defaultSleep } = {}
) {
  if (typeof fetchFn !== 'function') throw unreachable();
  const url = buildUrl(pathName, query);
  for (let tries = 0; ; tries += 1) {
    const result = await attempt(url, { apiKey, fetchFn, callTimeoutMs, totalSignal });
    const rateLimit = readRateLimit(result.headers, nowFn());
    if (result.status === 429) {
      const wait = tries === 0 ? computeWait(rateLimit.resetAt, { nowMs: nowFn(), totalDeadlineAt }) : null;
      if (wait === null) throw rateLimited(rateLimit.resetAt);
      await sleepFn(wait, totalSignal);
      continue;
    }
    if (result.status < 200 || result.status >= 300) {
      let body = null;
      try {
        body = JSON.parse(result.text);
      } catch (err) {
        body = null;
      }
      if (body && typeof body === 'object' && Number(body.code) === AUTH_CODE_NOT_SET) throw authFailed();
      throw formatChanged();
    }
    const json = parseJson(result.text);
    if (json && typeof json === 'object' && !Array.isArray(json) && Number(json.code) === AUTH_CODE_NOT_SET && !('user' in json)) {
      throw authFailed();
    }
    return { json, rateLimit };
  }
}

// Para quem pagina (9.2): com `remaining = 0` espera até o reinício se couber; senão IMPORT_RATE_LIMITED.
async function waitForRateLimit(rateLimit, { totalSignal, totalDeadlineAt, nowFn = Date.now, sleepFn = defaultSleep } = {}) {
  if (!rateLimit || rateLimit.remaining !== 0) return;
  const wait = computeWait(rateLimit.resetAt, { nowMs: nowFn(), totalDeadlineAt });
  if (wait === null) throw rateLimited(rateLimit.resetAt);
  await sleepFn(wait, totalSignal);
}

module.exports = { SOURCE, requestJson, waitForRateLimit, readRateLimit, formatChanged, unreachable, authFailed, rateLimited };

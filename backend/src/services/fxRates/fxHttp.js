'use strict';

// Acesso HTTP comum às fontes de cotação (D162): prazo por chamada e total, teto de bytes e JSON.
// Todos os erros saem como UpstreamError (502) com `params.source`. A rede (`fetchFn`) é sempre injetada.
const { FX_MAX_RESPONSE_BYTES } = require('../../config/constants');
const { UpstreamError } = require('../../errors/AppError');

const SOURCE_LABELS = Object.freeze({ PTAX: 'PTAX do Banco Central', AWESOMEAPI: 'AwesomeAPI' });
const labelOf = (source) => SOURCE_LABELS[source] || source;

function fetchFailed(source) {
  return new UpstreamError(
    `Não foi possível consultar a cotação (${labelOf(source)}). Verifique a conexão com a internet.`,
    'FX_FETCH_FAILED',
    { params: { source } }
  );
}

function rateLimited(source) {
  return new UpstreamError(
    `O limite de consultas da fonte (${labelOf(source)}) foi atingido. Tente mais tarde ou use outra fonte.`,
    'FX_RATE_LIMITED',
    { params: { source } }
  );
}

function invalidResponse(source, detail) {
  return new UpstreamError(`A resposta da cotação (${labelOf(source)}) é inválida (${detail}).`, 'FX_INVALID_RESPONSE', {
    params: { source },
  });
}

// Lê o corpo respeitando o teto de bytes; aceita respostas com stream, `text()` ou só `json()`.
async function readBodyText(response, source, maxBytes = FX_MAX_RESPONSE_BYTES) {
  const header =
    response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-length') : null;
  if (header !== null && header !== undefined && Number(header) > maxBytes) {
    throw invalidResponse(source, 'resposta grande demais');
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
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw invalidResponse(source, 'resposta grande demais');
      }
      chunks.push(Buffer.from(value));
    }
    text = Buffer.concat(chunks).toString('utf8');
  } else if (typeof response.text === 'function') {
    text = await response.text();
  } else if (typeof response.json === 'function') {
    text = JSON.stringify(await response.json());
  } else {
    throw fetchFailed(source);
  }
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw invalidResponse(source, 'resposta grande demais');
  return text;
}

// Executa `task(signal)` com prazo próprio e o prazo total; a primeira expiração aborta e vira FX_FETCH_FAILED.
function runWithDeadline(task, { source, callTimeoutMs, totalSignal }) {
  const controller = new AbortController();
  let timer;
  let onTotalAbort;
  const cleanup = () => {
    clearTimeout(timer);
    if (onTotalAbort && totalSignal) totalSignal.removeEventListener('abort', onTotalAbort);
  };
  const expired = new Promise((_, reject) => {
    const abort = () => {
      controller.abort();
      reject(fetchFailed(source));
    };
    timer = setTimeout(abort, callTimeoutMs);
    if (totalSignal && totalSignal.aborted) abort();
    else if (totalSignal) {
      onTotalAbort = abort;
      totalSignal.addEventListener('abort', onTotalAbort, { once: true });
    }
  });
  expired.catch(() => {}); // a rejeição é tratada pelo race; evita aviso quando a tarefa termina antes
  const running = Promise.resolve().then(() => task(controller.signal));
  running.catch(() => {});
  return Promise.race([running, expired]).finally(cleanup);
}

// GET `url` e devolve o JSON. Falha de rede, timeout ou HTTP diferente de 200 -> FX_FETCH_FAILED; 429 -> FX_RATE_LIMITED;
// corpo grande demais ou JSON inválido -> FX_INVALID_RESPONSE.
async function fetchJson(url, { fetchFn, source, callTimeoutMs, totalSignal }) {
  if (typeof fetchFn !== 'function') throw fetchFailed(source);
  const text = await runWithDeadline(
    async (signal) => {
      let response;
      try {
        response = await fetchFn(url, { signal });
      } catch (err) {
        throw fetchFailed(source);
      }
      if (response && response.status === 429) throw rateLimited(source);
      if (!response || response.ok === false || (response.status !== undefined && response.status !== 200)) {
        throw fetchFailed(source);
      }
      try {
        return await readBodyText(response, source);
      } catch (err) {
        if (err instanceof UpstreamError) throw err;
        throw fetchFailed(source);
      }
    },
    { source, callTimeoutMs, totalSignal }
  );
  try {
    return JSON.parse(text);
  } catch (err) {
    throw invalidResponse(source, 'JSON inválido');
  }
}

module.exports = { fetchJson, fetchFailed, rateLimited, invalidResponse, readBodyText, runWithDeadline };

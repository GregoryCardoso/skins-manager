'use strict';

// QA 9.1 (D288, D289): csfloatHttp com fetchFn falso. Nenhuma chamada de rede real.
const { requestJson, waitForRateLimit, readRateLimit } = require('../../src/services/imports/adapters/csfloatHttp');
const csfloatAdapter = require('../../src/services/imports/adapters/csfloatAdapter');
const { CSFLOAT_MAX_RESPONSE_BYTES } = require('../../src/config/constants');
const { KEY, PII, meBody, fakeResponse, fakeFetch } = require('../helpers/csfloatFixtures');

const NOW_MS = 1_700_000_000_000; // relógio fixo
const nowFn = () => NOW_MS;
const run = (fetchFn, extra = {}) => requestJson('/me', { apiKey: KEY, fetchFn, nowFn, sleepFn: jest.fn(async () => {}), ...extra });
const rejectsWith = async (promise, code) => {
  const err = await promise.then(() => null, (e) => e);
  expect(err).not.toBeNull();
  expect(err.code).toBe(code);
  expect(err.status).toBe(502);
  expect(err.params).toMatchObject({ source: 'CSFLOAT' });
  expect(err.cause).toBeUndefined();
  expect(`${err.message} ${JSON.stringify(err.params)}`).not.toContain(KEY);
  return err;
};

describe('requisição e header', () => {
  test('Authorization leva a chave pura (sem Bearer), GET, URL base fixa e sem a chave na URL', async () => {
    const fetchFn = fakeFetch(fakeResponse(200, meBody()));
    const { json, rateLimit } = await run(fetchFn);
    expect(json.user.steam_id).toBe(PII.steamId);
    expect(rateLimit).toEqual({ limit: null, remaining: null, resetAt: null });
    const { url, init } = fetchFn.calls[0];
    expect(url).toBe('https://csfloat.com/api/v1/me');
    expect(url).not.toContain(KEY);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe(KEY);
    expect(init.headers.Authorization).not.toMatch(/bearer/i);
    expect(init.signal).toBeDefined();
  });

  test('query é montada com valores nulos ignorados', async () => {
    const fetchFn = fakeFetch(fakeResponse(200, {}));
    await run(fetchFn, { query: { page: 2, limit: 10, skip: undefined, none: null } });
    expect(fetchFn.calls[0].url).toBe('https://csfloat.com/api/v1/me?page=2&limit=10');
  });

  test('lê os headers de limite (limit, remaining, reset em segundos restantes)', async () => {
    const fetchFn = fakeFetch(fakeResponse(200, {}, { 'X-RateLimit-Limit': 100, 'X-RateLimit-Remaining': 7, 'X-RateLimit-Reset': 30 }));
    const { rateLimit } = await run(fetchFn);
    expect(rateLimit).toEqual({ limit: 100, remaining: 7, resetAt: new Date(NOW_MS + 30000).toISOString() });
  });

  test('Reset em segundos Unix, milissegundos Unix e segundos restantes dão o mesmo instante', () => {
    const at = new Date(NOW_MS + 5000).toISOString();
    const headersOf = (reset) => fakeResponse(200, {}, { 'X-RateLimit-Reset': reset }).headers;
    expect(readRateLimit(headersOf(NOW_MS / 1000 + 5), NOW_MS).resetAt).toBe(at);
    expect(readRateLimit(headersOf(NOW_MS + 5000), NOW_MS).resetAt).toBe(at);
    expect(readRateLimit(headersOf(5), NOW_MS).resetAt).toBe(at);
    expect(readRateLimit(headersOf('abc'), NOW_MS).resetAt).toBeNull();
    expect(readRateLimit(null, NOW_MS)).toEqual({ limit: null, remaining: null, resetAt: null });
  });

  test('sem fetchFn função -> IMPORT_SOURCE_UNREACHABLE', async () => {
    await rejectsWith(requestJson('/me', { apiKey: KEY, fetchFn: 'x' }), 'IMPORT_SOURCE_UNREACHABLE');
  });

  test('o Adapter getAccount mapeia o /me e descarta os campos pessoais', async () => {
    const fetchFn = fakeFetch(fakeResponse(200, meBody()));
    const account = await csfloatAdapter.getAccount({ apiKey: KEY, fetchFn, nowFn });
    expect(account.steamId).toBe(PII.steamId);
    expect(JSON.stringify(account)).not.toContain(PII.email);
    expect(JSON.stringify(account)).not.toContain(PII.tradeToken);
  });
});

describe('erros HTTP (D288)', () => {
  test.each([[401], [403]])('%i -> CSFLOAT_AUTH_FAILED', async (status) => {
    await rejectsWith(run(fakeFetch(fakeResponse(status, { message: 'nope' }))), 'CSFLOAT_AUTH_FAILED');
  });
  test('corpo {code: 27} (200) -> CSFLOAT_AUTH_FAILED', async () => {
    await rejectsWith(run(fakeFetch(fakeResponse(200, { code: 27, message: 'authorization not set' }))), 'CSFLOAT_AUTH_FAILED');
  });
  test('corpo {code: 27} em status 400 -> CSFLOAT_AUTH_FAILED', async () => {
    await rejectsWith(run(fakeFetch(fakeResponse(400, { code: 27 }))), 'CSFLOAT_AUTH_FAILED');
  });
  test('{code: 27} com user presente não é falha de autenticação', async () => {
    const { json } = await run(fakeFetch(fakeResponse(200, { ...meBody(), code: 27 })));
    expect(json.user).toBeDefined();
  });
  test.each([[500], [502], [503], [599]])('%i -> IMPORT_SOURCE_UNAVAILABLE', async (status) => {
    await rejectsWith(run(fakeFetch(fakeResponse(status, 'erro interno com detalhes'))), 'IMPORT_SOURCE_UNAVAILABLE');
  });
  test.each([[404], [400], [418], [301]])('%i sem {code: 27} -> IMPORT_SOURCE_FORMAT_CHANGED', async (status) => {
    await rejectsWith(run(fakeFetch(fakeResponse(status, { x: 1 }))), 'IMPORT_SOURCE_FORMAT_CHANGED');
  });
  test('resposta sem status numérico -> IMPORT_SOURCE_FORMAT_CHANGED', async () => {
    await rejectsWith(run(fakeFetch({})), 'IMPORT_SOURCE_FORMAT_CHANGED');
  });
  test('erro de rede -> IMPORT_SOURCE_UNREACHABLE sem repassar a mensagem original (que cita URL e chave)', async () => {
    const boom = new Error(`getaddrinfo ENOTFOUND csfloat.com ${KEY}`);
    const err = await rejectsWith(run(fakeFetch(() => { throw boom; })), 'IMPORT_SOURCE_UNREACHABLE');
    expect(err.message).not.toMatch(/ENOTFOUND|csfloat\.com\/api/);
  });
  test('rejeição assíncrona do fetch -> IMPORT_SOURCE_UNREACHABLE', async () => {
    await rejectsWith(run(fakeFetch(() => Promise.reject(new Error('socket hang up')))), 'IMPORT_SOURCE_UNREACHABLE');
  });
  test('JSON quebrado -> IMPORT_SOURCE_FORMAT_CHANGED', async () => {
    await rejectsWith(run(fakeFetch(fakeResponse(200, '{"user": {'))), 'IMPORT_SOURCE_FORMAT_CHANGED');
    await rejectsWith(run(fakeFetch(fakeResponse(200, '<html>manutenção</html>'))), 'IMPORT_SOURCE_FORMAT_CHANGED');
  });
  test('corpo acima do teto: por content-length e por texto -> IMPORT_SOURCE_FORMAT_CHANGED', async () => {
    await rejectsWith(
      run(fakeFetch(fakeResponse(200, '{}', { 'content-length': CSFLOAT_MAX_RESPONSE_BYTES + 1 }))),
      'IMPORT_SOURCE_FORMAT_CHANGED',
    );
    const big = fakeResponse(200, 'x'.repeat(CSFLOAT_MAX_RESPONSE_BYTES + 1));
    await rejectsWith(run(fakeFetch(big)), 'IMPORT_SOURCE_FORMAT_CHANGED');
  });
  test('corpo exatamente no teto não estoura (vira erro de JSON, não de tamanho)', async () => {
    const edge = fakeResponse(200, JSON.stringify({ pad: 'x'.repeat(CSFLOAT_MAX_RESPONSE_BYTES - 20) }));
    const { json } = await run(fakeFetch(edge));
    expect(json.pad.length).toBeGreaterThan(1000);
  });
  test('falha ao ler o corpo (text lança) -> IMPORT_SOURCE_UNREACHABLE', async () => {
    const res = { status: 200, headers: { get: () => null }, text: async () => { throw new Error('reset'); } };
    await rejectsWith(run(fakeFetch(res)), 'IMPORT_SOURCE_UNREACHABLE');
  });
  test('resposta só com json() (sem text) é aceita', async () => {
    const res = { status: 200, headers: { get: () => null }, json: async () => meBody() };
    const { json } = await run(fakeFetch(res));
    expect(json.user.steam_id).toBe(PII.steamId);
  });
});

describe('prazos', () => {
  test('prazo da chamada estourado -> IMPORT_SOURCE_UNREACHABLE (nunca FX_FETCH_FAILED) e aborta o fetch', async () => {
    let aborted = false;
    const fetchFn = fakeFetch((url, init) => new Promise(() => { init.signal.addEventListener('abort', () => { aborted = true; }); }));
    await rejectsWith(run(fetchFn, { callTimeoutMs: 25 }), 'IMPORT_SOURCE_UNREACHABLE');
    expect(aborted).toBe(true);
  });
  test('prazo total (signal) já abortado -> IMPORT_SOURCE_UNREACHABLE', async () => {
    const controller = new AbortController();
    controller.abort();
    await rejectsWith(run(fakeFetch(() => new Promise(() => {})), { totalSignal: controller.signal }), 'IMPORT_SOURCE_UNREACHABLE');
  });
  test('prazo total estourando durante a chamada -> IMPORT_SOURCE_UNREACHABLE', async () => {
    const controller = new AbortController();
    const promise = run(fakeFetch(() => new Promise(() => {})), { totalSignal: controller.signal, callTimeoutMs: 5000 });
    setTimeout(() => controller.abort(), 20);
    await rejectsWith(promise, 'IMPORT_SOURCE_UNREACHABLE');
  });
});

describe('429 e limite de consultas', () => {
  const tooMany = (reset) => fakeResponse(429, { message: 'slow down' }, reset === undefined ? {} : { 'X-RateLimit-Reset': reset });

  test('Reset curto (segundos restantes): espera até o Reset (+50 ms) e repete UMA vez com sucesso', async () => {
    const sleepFn = jest.fn(async () => {});
    const fetchFn = fakeFetch(tooMany(5), fakeResponse(200, meBody()));
    const { json } = await requestJson('/me', { apiKey: KEY, fetchFn, nowFn, sleepFn });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledTimes(1);
    expect(sleepFn.mock.calls[0][0]).toBe(5050);
    expect(json.user.steam_id).toBe(PII.steamId);
  });
  test.each([
    ['segundos Unix', NOW_MS / 1000 + 3],
    ['milissegundos Unix', NOW_MS + 3000],
    ['segundos restantes', 3],
  ])('Reset em %s é entendido (espera 3050 ms)', async (_n, reset) => {
    const sleepFn = jest.fn(async () => {});
    await requestJson('/me', { apiKey: KEY, fetchFn: fakeFetch(tooMany(reset), fakeResponse(200, {})), nowFn, sleepFn });
    expect(sleepFn.mock.calls[0][0]).toBe(3050);
  });
  test('Reset no passado: espera só a folga de 50 ms', async () => {
    const sleepFn = jest.fn(async () => {});
    await requestJson('/me', { apiKey: KEY, fetchFn: fakeFetch(tooMany(NOW_MS / 1000 - 10), fakeResponse(200, {})), nowFn, sleepFn });
    expect(sleepFn.mock.calls[0][0]).toBe(50);
  });
  test('Reset exatamente em 30 s (limite): ainda espera; 31 s: recusa com retryAt', async () => {
    const sleepFn = jest.fn(async () => {});
    await requestJson('/me', { apiKey: KEY, fetchFn: fakeFetch(tooMany(29), fakeResponse(200, {})), nowFn, sleepFn });
    expect(sleepFn).toHaveBeenCalledTimes(1); // 29 s + 50 ms = 29,05 s <= 30 s
    const sleep2 = jest.fn(async () => {});
    const err = await rejectsWith(requestJson('/me', { apiKey: KEY, fetchFn: fakeFetch(tooMany(30), fakeResponse(200, {})), nowFn, sleepFn: sleep2 }), 'IMPORT_RATE_LIMITED');
    expect(sleep2).not.toHaveBeenCalled();
    expect(err.params.retryAt).toBe(new Date(NOW_MS + 30000).toISOString());
  });
  test('Reset longo: IMPORT_RATE_LIMITED com params.retryAt, sem esperar nem repetir', async () => {
    const sleepFn = jest.fn(async () => {});
    const fetchFn = fakeFetch(tooMany(3600), fakeResponse(200, {}));
    const err = await rejectsWith(requestJson('/me', { apiKey: KEY, fetchFn, nowFn, sleepFn }), 'IMPORT_RATE_LIMITED');
    expect(err.params).toEqual({ source: 'CSFLOAT', retryAt: new Date(NOW_MS + 3600 * 1000).toISOString() });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleepFn).not.toHaveBeenCalled();
  });
  test('429 sem header Reset: IMPORT_RATE_LIMITED sem retryAt', async () => {
    const err = await rejectsWith(run(fakeFetch(tooMany())), 'IMPORT_RATE_LIMITED');
    expect(err.params).toEqual({ source: 'CSFLOAT' });
  });
  test('Reset curto, mas além do prazo total -> IMPORT_RATE_LIMITED sem esperar', async () => {
    const sleepFn = jest.fn(async () => {});
    await rejectsWith(
      requestJson('/me', { apiKey: KEY, fetchFn: fakeFetch(tooMany(10), fakeResponse(200, {})), nowFn, sleepFn, totalDeadlineAt: NOW_MS + 5000 }),
      'IMPORT_RATE_LIMITED',
    );
    expect(sleepFn).not.toHaveBeenCalled();
  });
  test('segundo 429 depois de esperar -> IMPORT_RATE_LIMITED (só repete uma vez)', async () => {
    const sleepFn = jest.fn(async () => {});
    const fetchFn = fakeFetch(tooMany(2));
    await rejectsWith(requestJson('/me', { apiKey: KEY, fetchFn, nowFn, sleepFn }), 'IMPORT_RATE_LIMITED');
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleepFn).toHaveBeenCalledTimes(1);
  });
  test('o sono é interrompido pelo prazo total -> IMPORT_SOURCE_UNREACHABLE (sleep padrão)', async () => {
    const controller = new AbortController();
    const fetchFn = fakeFetch(tooMany(5), fakeResponse(200, {}));
    const promise = requestJson('/me', { apiKey: KEY, fetchFn, nowFn, totalSignal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await rejectsWith(promise, 'IMPORT_SOURCE_UNREACHABLE');
  });
  test('Remaining = 0 num 200: requestJson devolve; waitForRateLimit espera se couber', async () => {
    const res = fakeResponse(200, {}, { 'X-RateLimit-Remaining': 0, 'X-RateLimit-Reset': 4 });
    const { rateLimit } = await run(fakeFetch(res));
    expect(rateLimit.remaining).toBe(0);
    const sleepFn = jest.fn(async () => {});
    await waitForRateLimit(rateLimit, { nowFn, sleepFn });
    expect(sleepFn.mock.calls[0][0]).toBe(4050);
  });
  test('waitForRateLimit: remaining > 0 ou nulo não espera; Reset longo -> IMPORT_RATE_LIMITED com retryAt', async () => {
    const sleepFn = jest.fn(async () => {});
    await waitForRateLimit({ remaining: 3, resetAt: null }, { nowFn, sleepFn });
    await waitForRateLimit(null, { nowFn, sleepFn });
    expect(sleepFn).not.toHaveBeenCalled();
    const resetAt = new Date(NOW_MS + 120000).toISOString();
    const err = await rejectsWith(waitForRateLimit({ remaining: 0, resetAt }, { nowFn, sleepFn }), 'IMPORT_RATE_LIMITED');
    expect(err.params.retryAt).toBe(resetAt);
  });
});

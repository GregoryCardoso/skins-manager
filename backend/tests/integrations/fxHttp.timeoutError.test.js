'use strict';

// QA 9.1 (D316): a opção `timeoutError` do fxHttp é opcional e o comportamento padrão (FX_FETCH_FAILED) não muda.
const { runWithDeadline, fetchJson } = require('../../src/services/fxRates/fxHttp');
const { UpstreamError } = require('../../src/errors/AppError');

const never = () => new Promise(() => {});

describe('runWithDeadline', () => {
  test('sem timeoutError: prazo da chamada -> FX_FETCH_FAILED com params.source (comportamento anterior)', async () => {
    const err = await runWithDeadline(never, { source: 'PTAX', callTimeoutMs: 15 }).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.code).toBe('FX_FETCH_FAILED');
    expect(err.params).toEqual({ source: 'PTAX' });
  });
  test('sem timeoutError: prazo total já abortado -> FX_FETCH_FAILED', async () => {
    const controller = new AbortController();
    controller.abort();
    const err = await runWithDeadline(never, { source: 'AWESOMEAPI', callTimeoutMs: 5000, totalSignal: controller.signal }).catch((e) => e);
    expect(err.code).toBe('FX_FETCH_FAILED');
  });
  test('com timeoutError: o erro customizado é usado no prazo da chamada e no prazo total', async () => {
    const custom = () => new UpstreamError('x', 'IMPORT_SOURCE_UNREACHABLE', { params: { source: 'CSFLOAT' } });
    const a = await runWithDeadline(never, { source: 'CSFLOAT', callTimeoutMs: 15, timeoutError: custom }).catch((e) => e);
    expect(a.code).toBe('IMPORT_SOURCE_UNREACHABLE');
    const controller = new AbortController();
    controller.abort();
    const b = await runWithDeadline(never, { source: 'CSFLOAT', callTimeoutMs: 5000, totalSignal: controller.signal, timeoutError: custom }).catch((e) => e);
    expect(b.code).toBe('IMPORT_SOURCE_UNREACHABLE');
  });
  test('o aborto chega ao signal da tarefa nos dois modos', async () => {
    let signal;
    await runWithDeadline((s) => { signal = s; return never(); }, { source: 'PTAX', callTimeoutMs: 10 }).catch(() => {});
    expect(signal.aborted).toBe(true);
  });
  test('tarefa que termina a tempo devolve o valor e não dispara o erro', async () => {
    await expect(runWithDeadline(async () => 'ok', { source: 'PTAX', callTimeoutMs: 1000 })).resolves.toBe('ok');
  });
});

describe('fetchJson', () => {
  test('sem timeoutError (padrão): demora -> FX_FETCH_FAILED', async () => {
    const err = await fetchJson('https://x.invalid/a', { fetchFn: never, source: 'PTAX', callTimeoutMs: 15 }).catch((e) => e);
    expect(err.code).toBe('FX_FETCH_FAILED');
  });
  test('com timeoutError: demora -> o erro informado; HTTP 200 com JSON segue funcionando', async () => {
    const custom = () => new UpstreamError('x', 'IMPORT_SOURCE_UNREACHABLE', { params: { source: 'CSFLOAT' } });
    const err = await fetchJson('https://x.invalid/a', { fetchFn: never, source: 'CSFLOAT', callTimeoutMs: 15, timeoutError: custom }).catch((e) => e);
    expect(err.code).toBe('IMPORT_SOURCE_UNREACHABLE');
    const ok = { status: 200, ok: true, headers: { get: () => null }, text: async () => '{"a":1}' };
    await expect(fetchJson('https://x.invalid/a', { fetchFn: async () => ok, source: 'PTAX', callTimeoutMs: 1000 })).resolves.toEqual({ a: 1 });
  });
  test('erros que não são de prazo continuam FX_* (HTTP 500 e 429)', async () => {
    const res = (status) => ({ status, ok: false, headers: { get: () => null }, text: async () => '' });
    const e500 = await fetchJson('https://x.invalid/a', { fetchFn: async () => res(500), source: 'PTAX', callTimeoutMs: 1000 }).catch((e) => e);
    expect(e500.code).toBe('FX_SOURCE_UNAVAILABLE');
    const e429 = await fetchJson('https://x.invalid/a', { fetchFn: async () => res(429), source: 'PTAX', callTimeoutMs: 1000 }).catch((e) => e);
    expect(e429.code).toBe('FX_RATE_LIMITED');
  });
});

import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  ApiRequestError, getCsfloatIntegration, removeCsfloatApiKey, saveCsfloatApiKey, switchCsfloatAccount, testCsfloatConnection,
} from './api';

// QA 9.1: cliente da API de integrações com fetch falso (nenhuma rede real). Dados inventados.
const KEY = 'SENTINEL-KEY-zq7r5k3m9x-a1b2';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const lastCall = (fn: ReturnType<typeof mockFetch>) => {
  const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
  return { url, init };
};
afterEach(() => vi.unstubAllGlobals());

describe('api.ts de integrações', () => {
  test('getCsfloatIntegration: GET sem corpo', async () => {
    const fn = mockFetch(200, { success: true, data: { source: 'CSFLOAT' } });
    await expect(getCsfloatIntegration()).resolves.toEqual({ source: 'CSFLOAT' });
    const { url, init } = lastCall(fn);
    expect(url).toMatch(/\/api\/integrations\/csfloat$/);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  test('saveCsfloatApiKey: PUT com JSON { apiKey } e Content-Type JSON; a resposta só traz a máscara', async () => {
    const fn = mockFetch(200, { success: true, data: { hasApiKey: true, apiKeyMasked: '••••••••a1b2' } });
    const view = await saveCsfloatApiKey(KEY);
    const { url, init } = lastCall(fn);
    expect(url).toMatch(/\/integrations\/csfloat\/api-key$/);
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ apiKey: KEY });
    expect(JSON.stringify(view)).not.toContain(KEY);
  });

  test('o erro de chave inválida não repete a chave enviada', async () => {
    mockFetch(400, { success: false, error: { code: 'INVALID_API_KEY_FORMAT', message: 'A chave deve ter de 8 a 512 caracteres, sem espaços.', field: 'apiKey' } });
    const err = await saveCsfloatApiKey('abc def').catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.code).toBe('INVALID_API_KEY_FORMAT');
    expect(err.field).toBe('apiKey');
    expect(err.message).not.toContain('abc def');
  });

  test('removeCsfloatApiKey: DELETE', async () => {
    const del = mockFetch(200, { success: true, data: { hasApiKey: false } });
    await removeCsfloatApiKey();
    expect(lastCall(del).init.method).toBe('DELETE');
  });

  test('testCsfloatConnection: POST {} e switchCsfloatAccount: POST { confirm: true }, ambos com JSON e prazo de 30 s', async () => {
    const test = mockFetch(200, { success: true, data: { ok: true } });
    await testCsfloatConnection();
    expect(lastCall(test).init.method).toBe('POST');
    expect(lastCall(test).url).toMatch(/\/integrations\/csfloat\/test$/);
    expect(JSON.parse(lastCall(test).init.body as string)).toEqual({});
    expect(lastCall(test).init.headers).toEqual({ 'Content-Type': 'application/json' });
    const sw = mockFetch(200, { success: true, data: { integration: {}, username: null } });
    await switchCsfloatAccount();
    expect(lastCall(sw).url).toMatch(/\/integrations\/csfloat\/switch-account$/);
    expect(JSON.parse(lastCall(sw).init.body as string)).toEqual({ confirm: true });
  });

  test('erro 502 do CSFloat chega com code e params.source para a tradução por código', async () => {
    mockFetch(502, { success: false, error: { code: 'IMPORT_RATE_LIMITED', message: 'm', params: { source: 'CSFLOAT', retryAt: '2026-11-22T18:00:00.000Z' } } });
    const err = await testCsfloatConnection().catch((e) => e);
    expect(err.code).toBe('IMPORT_RATE_LIMITED');
    expect(err.params).toEqual({ source: 'CSFLOAT', retryAt: '2026-11-22T18:00:00.000Z' });
  });

  test('falha de rede vira NETWORK_ERROR sem expor detalhes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError(`fetch failed ${KEY}`); }));
    const err = await saveCsfloatApiKey(KEY).catch((e) => e);
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.message).not.toContain(KEY);
  });
});

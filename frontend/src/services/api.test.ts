import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError, getHealth, refreshCatalog, request, updatePreferences } from './api';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function catchError(promise: Promise<unknown>): Promise<ApiRequestError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiRequestError;
  }
  throw new Error('esperava erro');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('API_BASE_URL', () => {
  const original = process.env.NEXT_PUBLIC_API_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = original;
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  async function loadBase(value: string | undefined, nodeEnv?: string) {
    if (nodeEnv !== undefined) vi.stubEnv('NODE_ENV', nodeEnv);
    if (value === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = value;
    vi.resetModules();
    return (await import('./api')).API_BASE_URL;
  }

  test('padrão sem variável', async () => expect(await loadBase(undefined)).toBe('http://localhost:3001/api'));
  test('em production o padrão é /api (mesma origem)', async () => {
    expect(await loadBase(undefined, 'production')).toBe('/api');
    expect(await loadBase('', 'production')).toBe('/api');
  });
  test('em development o padrão é a porta 3001', async () =>
    expect(await loadBase(undefined, 'development')).toBe('http://localhost:3001/api'));
  test('a variável sobrescreve em production', async () =>
    expect(await loadBase('http://h:1/api', 'production')).toBe('http://h:1/api'));
  test('variável vazia usa o padrão', async () => expect(await loadBase('')).toBe('http://localhost:3001/api'));
  test('sem barra final', async () => expect(await loadBase('http://h:1/api')).toBe('http://h:1/api'));
  test('com barra(s) final(is) removida(s)', async () => {
    expect(await loadBase('http://h:1/api/')).toBe('http://h:1/api');
    expect(await loadBase('http://h:1/api///')).toBe('http://h:1/api');
  });
});

describe('api client', () => {
  test('desembrulha data e monta a URL com query sem null/undefined', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { a: 1 } }));
    vi.stubGlobal('fetch', fetchMock);
    const data = await request('GET', '/x', { query: { q: 'a b', n: null, u: undefined, k: 2 } });
    expect(data).toEqual({ a: 1 });
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/api/x?q=a+b&k=2');
  });

  test('PATCH envia JSON e Content-Type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    await updatePreferences({ theme: 'DARK' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3001/api/settings');
    expect(init.method).toBe('PATCH');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.body).toBe('{"theme":"DARK"}');
  });

  test('refreshCatalog envia {}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    await refreshCatalog();
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(fetchMock.mock.calls[0][1].body).toBe('{}');
  });

  test('envelope de erro vira ApiRequestError com code/status/message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ success: false, error: { code: 'CATALOG_REFRESH_IN_PROGRESS', message: 'em andamento' } }, 409)));
    const error = await catchError(getHealth());
    expect(error).toBeInstanceOf(ApiRequestError);
    expect([error.code, error.status, error.message]).toEqual(['CATALOG_REFRESH_IN_PROGRESS', 409, 'em andamento']);
  });

  test('fetch rejeitado vira NETWORK_ERROR com status 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = await catchError(getHealth());
    expect([error.code, error.status]).toEqual(['NETWORK_ERROR', 0]);
  });

  test('HTML com 200 e JSON inválido com 500 viram INVALID_RESPONSE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html></html>', { status: 200 })));
    expect((await catchError(getHealth())).code).toBe('INVALID_RESPONSE');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('oops', { status: 500 })));
    const error = await catchError(getHealth());
    expect([error.code, error.status]).toEqual(['INVALID_RESPONSE', 500]);
  });

  test('JSON sem campo success vira INVALID_RESPONSE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ hello: 1 })));
    expect((await catchError(getHealth())).code).toBe('INVALID_RESPONSE');
  });

  test('tempo esgotado vira TIMEOUT', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const promise = catchError(request('GET', '/slow', { timeoutMs: 1000 }));
    await vi.advanceTimersByTimeAsync(1001);
    expect((await promise).code).toBe('TIMEOUT');
  });

  test('204 devolve undefined sem ler corpo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    expect(await request('DELETE', '/x')).toBeUndefined();
  });

  test('GET sem body não envia Content-Type nem body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await request('GET', '/x');
    expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/api/x');
  });

  test('query só com null/undefined não deixa "?" na URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await request('GET', '/x', { query: { a: null, b: undefined } });
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/api/x');
  });

  test('query preserva 0 e false', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    await request('GET', '/x', { query: { n: 0, f: false } });
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/api/x?n=0&f=false');
  });

  test('envelope de erro sem code/message vira UNKNOWN com mensagem vazia', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: false }, 500)));
    const error = await catchError(getHealth());
    expect([error.code, error.message, error.status]).toEqual(['UNKNOWN', '', 500]);
  });

  test('JSON "null" e array vazio viram INVALID_RESPONSE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null)));
    expect((await catchError(getHealth())).code).toBe('INVALID_RESPONSE');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([])));
    expect((await catchError(getHealth())).code).toBe('INVALID_RESPONSE');
  });

  test('refreshCatalog: POST, JSON, Content-Type e timeout longo (150 s)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      setTimeout(() => resolve(jsonResponse({ success: true, data: { total: 1 } })), 140000);
    }));
    vi.stubGlobal('fetch', fetchMock);
    const promise = refreshCatalog();
    await vi.advanceTimersByTimeAsync(141000); // acima dos 15 s padrão, abaixo dos 150 s
    expect(await promise).toEqual({ total: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3001/api/catalog/refresh');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  test('timeout padrão de 15 s', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const promise = catchError(getHealth());
    await vi.advanceTimersByTimeAsync(14000);
    await vi.advanceTimersByTimeAsync(1500);
    expect((await promise).code).toBe('TIMEOUT');
  });

  test('signal já abortado antes da chamada vira ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      if (init.signal?.aborted) reject(new DOMException('aborted', 'AbortError'));
    })));
    const controller = new AbortController();
    controller.abort();
    expect((await catchError(request('GET', '/x', { signal: controller.signal }))).code).toBe('ABORTED');
  });

  test('cancelado pelo chamador vira ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })));
    const controller = new AbortController();
    const promise = catchError(request('GET', '/x', { signal: controller.signal }));
    controller.abort();
    expect((await promise).code).toBe('ABORTED');
  });
});

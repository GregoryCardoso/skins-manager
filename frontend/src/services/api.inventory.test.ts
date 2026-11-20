import { afterEach, describe, expect, test, vi } from 'vitest';
import { listItems, listStores, updateFxRate } from './api';

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(data: unknown = {}) {
  const fn = vi.fn().mockImplementation(() => Promise.resolve(ok(data)));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const urlOf = (fn: ReturnType<typeof vi.fn>) => new URL(fn.mock.calls[0][0] as string);

afterEach(() => vi.unstubAllGlobals());

describe('listItems', () => {
  test('só order: sempre manda sortBy=age junto', async () => {
    const fn = stubFetch({ items: [], meta: {} });
    await listItems({ order: 'desc' });
    const url = urlOf(fn);
    expect(url.pathname).toBe('/api/items');
    expect(Object.fromEntries(url.searchParams)).toEqual({ sortBy: 'age', order: 'desc' });
    expect(fn.mock.calls[0][1].method).toBe('GET');
  });

  test('todos os filtros', async () => {
    const fn = stubFetch();
    await listItems({ status: 'VENDIDO', category: 'FACA', stagnantOnly: true, order: 'asc' });
    expect(Object.fromEntries(urlOf(fn).searchParams)).toEqual({
      status: 'VENDIDO', category: 'FACA', stagnantOnly: 'true', sortBy: 'age', order: 'asc',
    });
  });

  test('stagnantOnly só é enviado quando true', async () => {
    const fn = stubFetch();
    await listItems({ order: 'desc', stagnantOnly: false });
    expect(urlOf(fn).searchParams.has('stagnantOnly')).toBe(false);
  });

  test('sem status nem category: não envia as chaves', async () => {
    const fn = stubFetch();
    await listItems({ order: 'asc' });
    const url = urlOf(fn);
    expect(url.searchParams.has('status')).toBe(false);
    expect(url.searchParams.has('category')).toBe(false);
  });

  test('repassa o AbortSignal ao fetch', async () => {
    const fn = stubFetch();
    const controller = new AbortController();
    await listItems({ order: 'desc' }, controller.signal);
    expect(fn.mock.calls[0][1].signal).toBeDefined();
  });

  test('devolve o data desembrulhado', async () => {
    stubFetch({ items: [{ id: 1 }], meta: { count: 1 } });
    await expect(listItems({ order: 'desc' })).resolves.toEqual({ items: [{ id: 1 }], meta: { count: 1 } });
  });
});

describe('listStores / updateFxRate', () => {
  test('listStores: GET /stores', async () => {
    const fn = stubFetch([]);
    await listStores();
    expect(urlOf(fn).pathname).toBe('/api/stores');
    expect(fn.mock.calls[0][1].method).toBe('GET');
  });

  test('updateFxRate: PUT /settings/fx-rate com { usdBrlRate }', async () => {
    const fn = stubFetch({});
    await updateFxRate(5.4);
    expect(urlOf(fn).pathname).toBe('/api/settings/fx-rate');
    const init = fn.mock.calls[0][1];
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ usdBrlRate: 5.4 });
  });
});

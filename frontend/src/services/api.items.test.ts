import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  ApiRequestError, createItem, deleteItem, getItem, getSaleQuote, request, searchCatalog, sellItem, unsellItem, updateItem,
} from './api';

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch(body: unknown = { success: true, data: {} }, status = 200) {
  const fn = vi.fn().mockImplementation(() => Promise.resolve(respond(body, status)));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('ApiRequestError com field e params (D113)', () => {
  test('lê field e params do erro', async () => {
    stubFetch({ success: false, error: { code: 'FLOAT_OUT_OF_RANGE', message: 'm', field: 'floatValue', params: { minFloat: 0.1, maxFloat: 0.7 } } }, 400);
    const error = await request('GET', '/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ code: 'FLOAT_OUT_OF_RANGE', status: 400, field: 'floatValue', params: { minFloat: 0.1, maxFloat: 0.7 } });
  });

  test('ignora tipos inválidos', async () => {
    stubFetch({ success: false, error: { code: 'X', message: 'm', field: 5, params: { a: 1, b: { c: 1 }, d: null, e: 'ok', f: [1] } } }, 400);
    const error = (await request('GET', '/x').catch((e: unknown) => e)) as ApiRequestError;
    expect(error.field).toBeUndefined();
    expect(error.params).toEqual({ a: 1, e: 'ok' });
    stubFetch({ success: false, error: { code: 'X', message: 'm', params: ['a'] } }, 400);
    const other = (await request('GET', '/x').catch((e: unknown) => e)) as ApiRequestError;
    expect(other.params).toBeUndefined();
  });

  test('sem field e sem params: ficam indefinidos', async () => {
    stubFetch({ success: false, error: { code: 'ITEM_NOT_FOUND', message: 'm' } }, 404);
    const error = (await request('GET', '/x').catch((e: unknown) => e)) as ApiRequestError;
    expect(error.field).toBeUndefined();
    expect(error.params).toBeUndefined();
  });
});

const call = (fn: ReturnType<typeof vi.fn>) => {
  const [url, init] = fn.mock.calls[0] as [string, RequestInit];
  return { url: new URL(url), method: init.method, body: init.body ? JSON.parse(init.body as string) : undefined };
};

describe('funções de itens', () => {
  test('getItem, createItem, updateItem, deleteItem', async () => {
    let fn = stubFetch();
    await getItem(7);
    expect(call(fn)).toMatchObject({ method: 'GET' });
    expect(call(fn).url.pathname).toBe('/api/items/7');

    fn = stubFetch();
    await createItem({ catalogId: 'a', acquisitionType: 'GANHEI' });
    expect(call(fn)).toMatchObject({ method: 'POST', body: { catalogId: 'a', acquisitionType: 'GANHEI' } });
    expect(call(fn).url.pathname).toBe('/api/items');

    fn = stubFetch();
    await updateItem(7, { purchasePriceCents: 5 });
    expect(call(fn)).toMatchObject({ method: 'PATCH', body: { purchasePriceCents: 5 } });
    expect(call(fn).url.pathname).toBe('/api/items/7');

    fn = stubFetch();
    await deleteItem(7);
    expect(call(fn).method).toBe('DELETE');
    expect(call(fn).url.pathname).toBe('/api/items/7');
  });

  test('sellItem e unsellItem', async () => {
    let fn = stubFetch();
    await sellItem(7, { saleStoreId: 1, salePriceCents: 125, soldAt: '2026-11-20T12:00:00-03:00', netReceivedCents: 120 });
    expect(call(fn)).toMatchObject({
      method: 'POST', body: { saleStoreId: 1, salePriceCents: 125, soldAt: '2026-11-20T12:00:00-03:00', netReceivedCents: 120 },
    });
    expect(call(fn).url.pathname).toBe('/api/items/7/sell');
    fn = stubFetch();
    await unsellItem(7);
    expect(call(fn)).toMatchObject({ method: 'POST', body: {} });
    expect(call(fn).url.pathname).toBe('/api/items/7/unsell');
  });

  test('getSaleQuote monta a rota e a query', async () => {
    const fn = stubFetch();
    await getSaleQuote(2, 115);
    expect(call(fn).url.pathname).toBe('/api/stores/2/sale-quote');
    expect(call(fn).url.searchParams.get('salePriceCents')).toBe('115');
  });
});

describe('searchCatalog', () => {
  test('menos de 2 caracteres não chama a API', async () => {
    const fn = stubFetch();
    await expect(searchCatalog('a')).resolves.toEqual({ items: [], meta: { catalogUpdatedAt: null, total: 0 } });
    await searchCatalog('  ');
    expect(fn).not.toHaveBeenCalled();
  });

  test('envia q, categoria e limite', async () => {
    const fn = stubFetch({ success: true, data: { items: [], meta: { catalogUpdatedAt: null, total: 0 } } });
    await searchCatalog(' ak ', { category: 'SKIN', limit: 20 });
    expect(Object.fromEntries(call(fn).url.searchParams)).toEqual({ q: 'ak', category: 'SKIN', limit: '20' });
    expect(call(fn).url.pathname).toBe('/api/catalog/search');
  });
});

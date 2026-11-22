import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createStoreBalanceCheck, deleteStoreBalanceEntry, getCurrentStoreBalances, getStoreBalanceCheckPreview, listStoreBalances,
} from './api';

function stubFetch(data: unknown = {}, status = 200) {
  const fn = vi.fn().mockImplementation(() => Promise.resolve(
    new Response(JSON.stringify({ success: true, data }), { status, headers: { 'Content-Type': 'application/json' } }),
  ));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const call = (fn: ReturnType<typeof vi.fn>) => {
  const [url, init] = fn.mock.calls[0] as [string, RequestInit];
  const headers = (init.headers ?? {}) as Record<string, string>;
  return { url: new URL(url), method: init.method, body: init.body ? JSON.parse(init.body as string) : undefined, headers };
};

afterEach(() => vi.unstubAllGlobals());

describe('funções do saldo calculado das lojas (8.6)', () => {
  test('getCurrentStoreBalances: GET /store-balances/current', async () => {
    const payload = { stores: [], totals: { nextReleaseAt: null }, usdBrlRate: null, computedAt: 'x' };
    const fn = stubFetch(payload);
    await expect(getCurrentStoreBalances()).resolves.toEqual(payload);
    expect(call(fn).method).toBe('GET');
    expect(call(fn).url.pathname).toBe('/api/store-balances/current');
  });

  test('listStoreBalances: GET com storeId na query', async () => {
    const fn = stubFetch({ balances: [] });
    await listStoreBalances(3);
    expect(call(fn).url.pathname).toBe('/api/store-balances');
    expect(call(fn).url.searchParams.get('storeId')).toBe('3');
  });

  test('getStoreBalanceCheckPreview: GET /check-preview com loja, valor e data na query', async () => {
    const fn = stubFetch({ computedCents: 8000 });
    await getStoreBalanceCheckPreview({ storeId: 2, balanceCents: 7900, recordedAt: '2026-11-16T12:00:00-03:00' });
    const { url, method } = call(fn);
    expect(method).toBe('GET');
    expect(url.pathname).toBe('/api/store-balances/check-preview');
    expect(url.searchParams.get('storeId')).toBe('2');
    expect(url.searchParams.get('balanceCents')).toBe('7900');
    expect(url.searchParams.get('recordedAt')).toBe('2026-11-16T12:00:00-03:00');
  });

  test('createStoreBalanceCheck: POST com adjust e nota; deleteStoreBalanceEntry: DELETE /:id', async () => {
    let fn = stubFetch({ id: 1 }, 201);
    const body = { storeId: 1, balanceCents: 12346, recordedAt: '2026-11-20T15:00:00.000Z', adjust: true, note: 'taxa' };
    await createStoreBalanceCheck(body);
    expect(call(fn)).toMatchObject({ method: 'POST', body });
    expect(call(fn).url.pathname).toBe('/api/store-balances');
    fn = stubFetch({ id: 9 });
    await expect(deleteStoreBalanceEntry(9)).resolves.toEqual({ id: 9 });
    expect(call(fn).method).toBe('DELETE');
    expect(call(fn).url.pathname).toBe('/api/store-balances/9');
  });

  test('não existe mais função de saldo inicial na API (D254)', async () => {
    const api = await import('./api');
    expect('putInitialBalance' in api).toBe(false);
  });
});

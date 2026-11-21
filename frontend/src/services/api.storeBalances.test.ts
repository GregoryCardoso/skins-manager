import { afterEach, describe, expect, test, vi } from 'vitest';
import { createStoreBalance, deleteStoreBalance, getCurrentStoreBalances, listStoreBalances } from './api';

function stubFetch(data: unknown = {}, status = 200) {
  const fn = vi.fn().mockImplementation(() => Promise.resolve(
    new Response(JSON.stringify({ success: true, data }), { status, headers: { 'Content-Type': 'application/json' } }),
  ));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const call = (fn: ReturnType<typeof vi.fn>) => {
  const [url, init] = fn.mock.calls[0] as [string, RequestInit];
  return { url: new URL(url), method: init.method, body: init.body ? JSON.parse(init.body as string) : undefined };
};

afterEach(() => vi.unstubAllGlobals());

describe('funções de saldos das lojas (8.3)', () => {
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

  test('createStoreBalance: POST com o corpo; deleteStoreBalance: DELETE /:id', async () => {
    let fn = stubFetch({ id: 1 }, 201);
    await createStoreBalance({ storeId: 1, balanceCents: 12346, recordedAt: '2026-11-20T15:00:00.000Z' });
    expect(call(fn)).toMatchObject({ method: 'POST', body: { storeId: 1, balanceCents: 12346, recordedAt: '2026-11-20T15:00:00.000Z' } });
    expect(call(fn).url.pathname).toBe('/api/store-balances');
    fn = stubFetch({ id: 9 });
    await expect(deleteStoreBalance(9)).resolves.toEqual({ id: 9 });
    expect(call(fn).method).toBe('DELETE');
    expect(call(fn).url.pathname).toBe('/api/store-balances/9');
  });
});

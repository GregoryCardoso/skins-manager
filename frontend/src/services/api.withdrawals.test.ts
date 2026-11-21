import { afterEach, describe, expect, test, vi } from 'vitest';
import { createWithdrawal, deleteWithdrawal, getWithdrawalFeeSuggestion, listWithdrawals, updateWithdrawal } from './api';

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

describe('funções de saques', () => {
  test('listWithdrawals: GET /withdrawals', async () => {
    const payload = { withdrawals: [], totals: { count: 0, amountBrlCents: 0 } };
    const fn = stubFetch(payload);
    await expect(listWithdrawals()).resolves.toEqual(payload);
    expect(call(fn).method).toBe('GET');
    expect(call(fn).url.pathname).toBe('/api/withdrawals');
  });

  test('getWithdrawalFeeSuggestion: GET com storeId e amountStoreCents na query', async () => {
    const fn = stubFetch({ storeId: 1, amountStoreCents: 10000, suggestedFeeCents: 250, warningCode: null });
    await expect(getWithdrawalFeeSuggestion(1, 10000)).resolves.toMatchObject({ suggestedFeeCents: 250 });
    expect(call(fn).url.pathname).toBe('/api/withdrawals/fee-suggestion');
    expect(call(fn).url.searchParams.get('storeId')).toBe('1');
    expect(call(fn).url.searchParams.get('amountStoreCents')).toBe('10000');
  });

  test('createWithdrawal: POST; updateWithdrawal: PATCH com null; deleteWithdrawal: DELETE', async () => {
    let fn = stubFetch({ id: 1 }, 201);
    await createWithdrawal({ storeId: 1, amountStoreCents: 10000, amountBrlCents: 52000, withdrawnAt: '2026-11-10T12:00:00.000Z' });
    expect(call(fn)).toMatchObject({ method: 'POST', body: { storeId: 1, amountStoreCents: 10000 } });
    fn = stubFetch({ id: 3 });
    await updateWithdrawal(3, { feeCents: null });
    expect(call(fn)).toMatchObject({ method: 'PATCH', body: { feeCents: null } });
    expect(call(fn).url.pathname).toBe('/api/withdrawals/3');
    fn = stubFetch({ id: 3 });
    await deleteWithdrawal(3);
    expect(call(fn).method).toBe('DELETE');
  });
});

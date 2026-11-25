import { afterEach, describe, expect, test, vi } from 'vitest';
import { createDeposit, deleteDeposit, listDeposits, updateDeposit } from './api';

function stubFetch(data: unknown = {}, status = 200) {
  const fn = vi.fn().mockImplementation(() => Promise.resolve(
    new Response(JSON.stringify({ success: true, data }), { status, headers: { 'Content-Type': 'application/json' } }),
  ));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const call = (fn: ReturnType<typeof vi.fn>) => {
  const [url, init] = fn.mock.calls[0] as [string, RequestInit];
  return {
    url: new URL(url),
    method: init.method,
    body: init.body ? JSON.parse(init.body as string) : undefined,
    headers: new Headers(init.headers),
  };
};

afterEach(() => vi.unstubAllGlobals());

describe('funções de aportes', () => {
  test('listDeposits: GET /deposits e devolve a lista com totais', async () => {
    const payload = { deposits: [], totals: { count: 0, legacyCount: 0, amountUsdCents: 0, approxCents: null, estimated: false } };
    const fn = stubFetch(payload);
    await expect(listDeposits()).resolves.toEqual(payload);
    expect(call(fn)).toMatchObject({ method: 'GET' });
    expect(call(fn).url.pathname).toBe('/api/deposits');
  });

  test('createDeposit: POST /deposits com JSON', async () => {
    const fn = stubFetch({ id: 1 }, 201);
    await createDeposit({ storeId: 1, amountStoreCents: 9200, amountBrlCents: 50000, depositedAt: '2026-11-10T12:00:00-03:00', note: 'pix' });
    expect(call(fn)).toMatchObject({
      method: 'POST', body: { storeId: 1, amountStoreCents: 9200, amountBrlCents: 50000, depositedAt: '2026-11-10T12:00:00-03:00', note: 'pix' },
    });
    expect(call(fn).url.pathname).toBe('/api/deposits');
    expect(call(fn).headers.get('Content-Type')).toMatch(/application\/json/);
  });

  test('updateDeposit: PATCH /deposits/:id só com o corpo parcial (null limpa)', async () => {
    const fn = stubFetch({ id: 4 });
    await updateDeposit(4, { amountBrlCents: null, note: null });
    expect(call(fn)).toMatchObject({ method: 'PATCH', body: { amountBrlCents: null, note: null } });
    expect(call(fn).url.pathname).toBe('/api/deposits/4');
    expect(call(fn).headers.get('Content-Type')).toMatch(/application\/json/);
  });

  test('deleteDeposit: DELETE /deposits/:id', async () => {
    const fn = stubFetch({ id: 9 });
    await expect(deleteDeposit(9)).resolves.toEqual({ id: 9 });
    expect(call(fn)).toMatchObject({ method: 'DELETE' });
    expect(call(fn).url.pathname).toBe('/api/deposits/9');
  });
});

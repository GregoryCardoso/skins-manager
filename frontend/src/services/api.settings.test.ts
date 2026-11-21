import { afterEach, describe, expect, test, vi } from 'vitest';
import { refreshFxRate, updatePreferences } from './api';

function stubFetch(data: unknown = {}) {
  const fn = vi.fn().mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

const lastCall = (fn: ReturnType<typeof vi.fn>) => {
  const [url, init] = fn.mock.calls[0] as [string, RequestInit];
  return { url: new URL(url), init, body: init.body ? JSON.parse(init.body as string) : undefined };
};

describe('configurações (6.2)', () => {
  test('refreshFxRate: POST /settings/fx-rate/refresh com corpo {} e Content-Type JSON', async () => {
    const fn = stubFetch({ settings: {}, quote: { source: 'AWESOMEAPI', rate: 5.3 } });
    await expect(refreshFxRate()).resolves.toMatchObject({ quote: { rate: 5.3 } });
    const { url, init, body } = lastCall(fn);
    expect(url.pathname).toBe('/api/settings/fx-rate/refresh');
    expect(init.method).toBe('POST');
    expect(body).toEqual({});
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  test('updatePreferences envia a fonte da cotação', async () => {
    const fn = stubFetch({});
    await updatePreferences({ fxRefreshSource: 'PTAX' });
    expect(lastCall(fn).body).toEqual({ fxRefreshSource: 'PTAX' });
  });

  test('updatePreferences envia os limites de giro, inclusive null (restaurar padrão)', async () => {
    const fn = stubFetch({});
    await updatePreferences({ fastTurnoverDays: 5, slowItemDays: null });
    const { url, init, body } = lastCall(fn);
    expect(url.pathname).toBe('/api/settings');
    expect(init.method).toBe('PATCH');
    expect(body).toEqual({ fastTurnoverDays: 5, slowItemDays: null });
  });
});

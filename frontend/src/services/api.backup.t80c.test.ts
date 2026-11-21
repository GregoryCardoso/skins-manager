import { afterEach, describe, expect, test, vi } from 'vitest';
import { exportBackup } from './api';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('T80c: exportBackup reusa o timeout e o abort de request', () => {
  const hangingFetch = () =>
    vi.fn((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    );

  test('timeout de 120 s -> TIMEOUT (e não antes)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', hangingFetch());
    const p = exportBackup();
    const assertion = expect(p).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(119_000);
    let settled = false;
    p.catch(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
  });

  test('abort do chamador -> ABORTED', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const controller = new AbortController();
    const p = exportBackup(controller.signal);
    controller.abort();
    await expect(p).rejects.toMatchObject({ code: 'ABORTED' });
  });

  test('falha ao ler o corpo no sucesso -> NETWORK_ERROR', async () => {
    const response = { ok: true, status: 200, headers: new Headers(), blob: () => Promise.reject(new Error('x')) };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(exportBackup()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  test('409 BACKUP_BUSY em JSON vira ApiRequestError com status', async () => {
    const body = { success: false, error: { code: 'BACKUP_BUSY', message: 'x' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 409 })));
    await expect(exportBackup()).rejects.toMatchObject({ code: 'BACKUP_BUSY', status: 409 });
  });
});

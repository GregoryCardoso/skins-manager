import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError, exportBackup, fileNameFromContentDisposition, importBackup } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('fileNameFromContentDisposition (casos extras)', () => {
  test('nome sem aspas, vazio e com caminho do Windows', () => {
    expect(fileNameFromContentDisposition('attachment; filename=b.sqlite')).toBe('b.sqlite');
    expect(fileNameFromContentDisposition('attachment; filename=""')).toBe('skins-manager-backup.sqlite');
    expect(fileNameFromContentDisposition('attachment; filename="C:\\temp\\x.sqlite"')).toBe('x.sqlite');
    expect(fileNameFromContentDisposition('attachment')).toBe('skins-manager-backup.sqlite');
    expect(fileNameFromContentDisposition("attachment; filename*=UTF-8''%E0%A4%A")).toBe('skins-manager-backup.sqlite');
    expect(fileNameFromContentDisposition('')).toBe('skins-manager-backup.sqlite');
  });
});

describe('exportBackup e importBackup (falhas)', () => {
  test('falha de rede vira NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fail')));
    await expect(exportBackup()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await expect(importBackup(new Blob(['x']))).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  test('erro com corpo que não é JSON vira INVALID_RESPONSE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>', { status: 500 })));
    await expect(exportBackup()).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 500 });
  });

  test('sinal já abortado vira ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => Promise.reject(init.signal?.aborted ? new DOMException('x', 'AbortError') : new Error('x'))));
    const controller = new AbortController();
    controller.abort();
    await expect(exportBackup(controller.signal)).rejects.toMatchObject({ code: 'ABORTED' });
  });

  test('exportBackup tem timeout de 120 s (TIMEOUT)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))),
      ),
    );
    const promise = exportBackup();
    const assertion = expect(promise).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(120001);
    await assertion;
  });

  test('importBackup com 413 propaga params.maxBytes', async () => {
    const body = { success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'm', params: { maxBytes: 104857600 } } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 413 })));
    const error = await importBackup(new Blob(['x'])).catch((e) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413, params: { maxBytes: 104857600 } });
  });
});

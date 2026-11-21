import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError, exportBackup, fileNameFromContentDisposition, importBackup } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('fileNameFromContentDisposition', () => {
  test('lê o nome entre aspas, o estendido e usa o padrão sem cabeçalho', () => {
    expect(fileNameFromContentDisposition('attachment; filename="skins-manager-backup-v4-2026-11-20-1534.sqlite"')).toBe(
      'skins-manager-backup-v4-2026-11-20-1534.sqlite',
    );
    expect(fileNameFromContentDisposition("attachment; filename*=UTF-8''backup%20a.sqlite")).toBe('backup a.sqlite');
    expect(fileNameFromContentDisposition(null)).toBe('skins-manager-backup.sqlite');
    expect(fileNameFromContentDisposition('attachment; filename="../../x.sqlite"')).toBe('x.sqlite');
  });
});

describe('backup (6.3)', () => {
  test('exportBackup devolve o blob e o nome do cabeçalho', async () => {
    const fn = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Disposition': 'attachment; filename="b.sqlite"', 'Content-Type': 'application/vnd.sqlite3' },
      }),
    );
    vi.stubGlobal('fetch', fn);
    const { blob, fileName } = await exportBackup();
    expect(fileName).toBe('b.sqlite');
    expect(blob.size).toBe(3);
    expect(new URL((fn.mock.calls[0] as [string])[0]).pathname).toBe('/api/backup/export');
  });

  test('exportBackup converte o erro JSON em ApiRequestError', async () => {
    const body = { success: false, error: { code: 'BACKUP_UNAVAILABLE', message: 'x' } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 409 })));
    await expect(exportBackup()).rejects.toMatchObject({ code: 'BACKUP_UNAVAILABLE', status: 409 });
    await expect(exportBackup()).rejects.toBeInstanceOf(ApiRequestError);
  });

  test('importBackup envia o arquivo como octet-stream, sem JSON', async () => {
    const fn = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ success: true, data: { fileVersion: 4 } }), { status: 200 }));
    vi.stubGlobal('fetch', fn);
    const file = new Blob([new Uint8Array([9, 9])]);
    await expect(importBackup(file)).resolves.toMatchObject({ fileVersion: 4 });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/api/backup/import');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/octet-stream' });
    expect(init.body).toBe(file);
  });

  test('importBackup propaga o código e os params do erro', async () => {
    const body = { success: false, error: { code: 'BACKUP_NEWER_VERSION', message: 'm', params: { fileVersion: 9, appVersion: 4 } } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 400 })));
    await expect(importBackup(new Blob(['x']))).rejects.toMatchObject({ code: 'BACKUP_NEWER_VERSION', params: { fileVersion: 9 } });
  });
});

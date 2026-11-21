import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError, getBackupInfo, openBackupsFolder } from './api';
import { API_ERROR_CODES } from '@/i18n/errorCodes';
import { errorMessageFor } from '@/i18n/errorMessage';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { translate } from '@/i18n/translate';

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const tPt = (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params);
const tEn = (key: string, params?: Record<string, string | number>) => translate(en, key, params);

describe('getBackupInfo / openBackupsFolder (7.2)', () => {
  test('getBackupInfo faz GET /api/backup/info e devolve os dados', async () => {
    const data = { dataDir: 'C:\d', backupsDir: 'C:\d\backups', autoBackupKeep: 10, canOpenFolder: true };
    const fn = vi.fn().mockResolvedValue(json({ success: true, data }));
    vi.stubGlobal('fetch', fn);
    await expect(getBackupInfo()).resolves.toEqual(data);
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/api/backup/info');
    expect(init.method).toBe('GET');
  });

  test('openBackupsFolder faz POST JSON com corpo {} (nenhum caminho)', async () => {
    const fn = vi.fn().mockResolvedValue(json({ success: true, data: { path: 'C:\d\backups' } }));
    vi.stubGlobal('fetch', fn);
    await expect(openBackupsFolder()).resolves.toEqual({ path: 'C:\d\backups' });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/api/backup/open-folder');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  test.each(['FOLDER_OPEN_UNSUPPORTED', 'FOLDER_OPEN_FAILED'])('erro %s vira ApiRequestError com o código', async (code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ success: false, error: { code, message: 'x' } }, 409)));
    await expect(openBackupsFolder()).rejects.toMatchObject({ code, status: 409 });
    await expect(openBackupsFolder()).rejects.toBeInstanceOf(ApiRequestError);
  });
});

describe('códigos novos da 7.2 nos dois idiomas', () => {
  test.each(['FOLDER_OPEN_UNSUPPORTED', 'FOLDER_OPEN_FAILED', 'DATA_DIR_LOCKED'])('%s está na lista e traduzido', (code) => {
    expect(API_ERROR_CODES).toContain(code);
    expect(tPt(`errors.${code}`)).not.toBe(`errors.${code}`);
    expect(tEn(`errors.${code}`)).not.toBe(`errors.${code}`);
    const e = new ApiRequestError(code as never, 'msg do servidor', 409);
    expect(errorMessageFor(e, tPt, 'pt-BR')).toBe(tPt(`errors.${code}`));
    expect(errorMessageFor(e, tEn, 'en')).toBe(tEn(`errors.${code}`));
  });

  test.each(['folderLabel', 'openFolder', 'copyPath', 'pathCopied', 'copyFailed', 'retention'])('chave de backup %s existe nos dois idiomas', (k) => {
    const find = (dict: unknown) => {
      const stack: unknown[] = [dict];
      while (stack.length) {
        const cur = stack.pop() as Record<string, unknown>;
        if (cur && typeof cur === 'object') {
          if (typeof cur[k] === 'string' && 'reloadNow' in cur) return cur[k] as string;
          stack.push(...Object.values(cur));
        }
      }
      return undefined;
    };
    expect(find(ptBR)).toBeTruthy();
    expect(find(en)).toBeTruthy();
  });
});

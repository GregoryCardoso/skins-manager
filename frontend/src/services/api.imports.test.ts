import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  ApiRequestError, getImportBatch, getUndoPreview, listImportBatches, listOpenImportEntries, runCsfloatImport, undoImportBatch,
} from './api';

// 9.2: cliente da API de importação com fetch falso (nenhuma rede real).
function mockFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const lastCall = (fn: ReturnType<typeof mockFetch>) => {
  const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
  return { url, init };
};
afterEach(() => vi.unstubAllGlobals());

describe('api.ts da importação', () => {
  test('runCsfloatImport: POST JSON com o corte e a varredura completa', async () => {
    const fn = mockFetch(200, { success: true, data: { batch: { id: 3 } } });
    await expect(runCsfloatImport({ cutoffAt: '2026-11-01T00:00:00-03:00', fullScan: false })).resolves.toEqual({ batch: { id: 3 } });
    const { url, init } = lastCall(fn);
    expect(url).toMatch(/\/api\/imports\/csfloat\/run$/);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ cutoffAt: '2026-11-01T00:00:00-03:00', fullScan: false });
  });

  test('runCsfloatImport sem opções envia corpo vazio (Content-Type JSON mesmo assim)', async () => {
    const fn = mockFetch(200, { success: true, data: { batch: { id: 4 } } });
    await runCsfloatImport();
    const { init } = lastCall(fn);
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  test('erros do run chegam com código e params', async () => {
    mockFetch(409, { success: false, error: { code: 'IMPORT_IN_PROGRESS', message: 'Já há uma importação em andamento.' } });
    const err = await runCsfloatImport({}).catch((e) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.code).toBe('IMPORT_IN_PROGRESS');
    expect(err.status).toBe(409);
    mockFetch(502, { success: false, error: { code: 'IMPORT_RATE_LIMITED', message: 'x', params: { source: 'CSFLOAT', retryAt: '2026-11-22T18:30:00.000Z' } } });
    const limited = await runCsfloatImport({}).catch((e) => e);
    expect(limited.params).toEqual({ source: 'CSFLOAT', retryAt: '2026-11-22T18:30:00.000Z' });
  });

  test('listImportBatches: limit e before na query; sem before não envia', async () => {
    const fn = mockFetch(200, { success: true, data: { batches: [], nextBefore: null } });
    await listImportBatches({ limit: 20, before: 7 });
    expect(lastCall(fn).url).toMatch(/\/api\/imports\/batches\?limit=20&before=7$/);
    const fn2 = mockFetch(200, { success: true, data: { batches: [], nextBefore: null } });
    await listImportBatches({ limit: 20, before: null });
    expect(lastCall(fn2).url).toMatch(/\/api\/imports\/batches\?limit=20$/);
  });

  test('getImportBatch, getUndoPreview e listOpenImportEntries: caminhos', async () => {
    let fn = mockFetch(200, { success: true, data: {} });
    await getImportBatch(5);
    expect(lastCall(fn).url).toMatch(/\/api\/imports\/batches\/5$/);
    fn = mockFetch(200, { success: true, data: {} });
    await getUndoPreview(5);
    expect(lastCall(fn).url).toMatch(/\/api\/imports\/batches\/5\/undo-preview$/);
    fn = mockFetch(200, { success: true, data: { entries: [] } });
    await listOpenImportEntries();
    expect(lastCall(fn).url).toMatch(/\/api\/imports\/entries\?open=true$/);
  });

  test('undoImportBatch: POST com confirmWarnings', async () => {
    const fn = mockFetch(200, { success: true, data: { id: 5, status: 'UNDONE' } });
    await undoImportBatch(5, true);
    const { url, init } = lastCall(fn);
    expect(url).toMatch(/\/api\/imports\/batches\/5\/undo$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ confirmWarnings: true });
  });
});

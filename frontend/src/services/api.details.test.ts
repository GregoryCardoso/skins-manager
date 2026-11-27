import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiRequestError, request } from './api';

// 12.9: `details` guarda os parâmetros como vieram (listas e objetos); `params` continua só com texto e número.
function jsonResponse(body: unknown, status = 409): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
async function caught(promise: Promise<unknown>): Promise<ApiRequestError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiRequestError;
  }
  throw new Error('esperava erro');
}
afterEach(() => vi.unstubAllGlobals());

describe('ApiRequestError.details', () => {
  test('listas e objetos ficam em details; params guarda só texto e número (inalterado)', () => {
    const failures = [{ entryId: 2, code: 'X', reason: 'Y' }];
    const error = new ApiRequestError('IMPORT_BULK_CONFLICT', 'm', 409, { params: { failures, itemIds: [1, 2], nested: { a: 1 }, reason: 'R', count: 3, nan: Number.NaN } });
    expect(error.details).toEqual({ failures, itemIds: [1, 2], nested: { a: 1 }, reason: 'R', count: 3, nan: Number.NaN });
    expect(error.params).toEqual({ reason: 'R', count: 3 });
  });

  test('só listas e objetos: params indefinido, details completo', () => {
    const error = new ApiRequestError('UNIT_IN_STOCK', 'm', 409, { params: { itemIds: [42] } });
    expect(error.params).toBeUndefined();
    expect(error.details).toEqual({ itemIds: [42] });
  });

  test('sem params, params nulo, lista ou texto: details indefinido', () => {
    for (const params of [undefined, null, [1, 2], 'x', 5]) {
      const error = new ApiRequestError('X', 'm', 400, { params });
      expect(error.details).toBeUndefined();
      expect(error.params).toBeUndefined();
    }
    expect(new ApiRequestError('X', 'm').details).toBeUndefined();
  });

  test('vindo da resposta HTTP: a falha por linha chega inteira', async () => {
    const failures = [{ entryId: 7, code: 'IMPORT_ENTRY_CONFLICT', reason: 'SALE_TX_NOT_FOUND' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: false, error: { code: 'IMPORT_BULK_CONFLICT', message: 'm', params: { failures, total: 2 } } })));
    const error = await caught(request('POST', '/x'));
    expect(error.code).toBe('IMPORT_BULK_CONFLICT');
    expect(error.details?.failures).toEqual(failures);
    expect(error.params).toEqual({ total: 2 });
  });
});

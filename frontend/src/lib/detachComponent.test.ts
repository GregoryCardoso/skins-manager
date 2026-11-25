// 10.7 (D366): separar chaveiro ou Sticker Slab no frontend: chamadas da API, invalidação e textos por motivo nos dois idiomas.
import { afterEach, describe, expect, test, vi } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { errorMessageFor } from '@/i18n/errorMessage';
import { translate } from '@/i18n/translate';
import { ApiRequestError, detachComponent, getDetachPreview } from '@/services/api';
import { INVALIDATION_MAP } from './queryInvalidation';
import { queryKeys } from './queryKeys';

type Dict = Record<string, unknown>;
const t = (dict: Dict) => (key: string, params?: Record<string, string | number>) => translate(dict, key, params);

describe('API e invalidação da separação', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = () => {
    const fn = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ success: true, data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    vi.stubGlobal('fetch', fn);
    return fn;
  };

  test('a prévia manda a porcentagem só quando informada; a separação é um POST com o corpo', async () => {
    let fn = stub();
    await getDetachPreview(4, 8, null);
    expect(String(fn.mock.calls[0][0])).toMatch(/\/api\/items\/4\/components\/8\/detach-preview$/);
    fn = stub();
    await getDetachPreview(4, 8, 3333);
    expect(String(fn.mock.calls[0][0])).toMatch(/\/api\/items\/4\/components\/8\/detach-preview\?hangingShareBp=3333$/);
    fn = stub();
    await detachComponent(4, 8, { hangingShareBp: 1000, detachedAt: '2026-11-17T12:00:00-03:00' });
    expect(String(fn.mock.calls[0][0])).toMatch(/\/api\/items\/4\/components\/8\/detach$/);
    expect((fn.mock.calls[0][1] as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((fn.mock.calls[0][1] as RequestInit).body))).toEqual({ hangingShareBp: 1000, detachedAt: '2026-11-17T12:00:00-03:00' });
  });

  test('a ação invalida itens, valor de mercado, vendas, lojas, saldos, lucro real e importações', () => {
    const groups = (INVALIDATION_MAP['item.detachComponent'] as readonly (readonly unknown[])[]).map((k) => k[0]).sort();
    expect(groups).toEqual(['imports', 'items', 'marketValues', 'profitSummary', 'sales', 'storeBalances', 'stores']);
    expect(queryKeys.items.detachPreview(4, 8, null)[0]).toBe('items');
  });
});

describe('textos da separação', () => {
  const error = (code: string, params: Record<string, unknown>) => new ApiRequestError(code, 'm', 409, { params });

  test('motivos novos têm texto nos dois idiomas', () => {
    for (const lang of [ptBR, en]) {
      const texts = lang.errorReasons as Record<string, string>;
      for (const key of [
        'OPERATION_DATE_INVALID_BEFORE_APPLIED', 'OPERATION_DATE_INVALID_TRADE_UNLOCK_BEFORE_DETACHED', 'INVALID_OPERATION_INPUT_SHARE_NOT_ALLOWED',
        'INVALID_OPERATION_INPUT_SHARE_INVALID', 'OPERATION_UNDO_BLOCKED_HANGING_OCCUPIED', 'OPERATION_UNDO_BLOCKED_DETACHED',
      ]) expect(texts[key]?.trim(), key).toBeTruthy();
      const errors = lang.errors as Record<string, string>;
      expect(errors.COMPONENT_NOT_DETACHABLE?.trim()).toBeTruthy();
      expect(errors.SPLIT_SHARE_REQUIRED?.trim()).toBeTruthy();
    }
  });

  test('o texto sai do motivo e cita a data do limite', () => {
    const text = errorMessageFor(error('OPERATION_DATE_INVALID', { reason: 'BEFORE_APPLIED', acquiredAt: '2026-11-15T12:00:00.000Z' }), t(ptBR), 'pt-BR');
    expect(text).toContain('15/11/2026');
    expect(errorMessageFor(error('OPERATION_UNDO_BLOCKED', { reason: 'DETACHED' }), t(en), 'en')).toContain('Undo the separation');
    expect(errorMessageFor(new ApiRequestError('SPLIT_SHARE_REQUIRED', 'm', 422), t(ptBR), 'pt-BR')).toBe(ptBR.errors.SPLIT_SHARE_REQUIRED);
  });

  test('as chaves do formulário existem nos dois idiomas', () => {
    const flat = (obj: Dict, prefix = ''): string[] => Object.entries(obj).flatMap(([k, v]) => (typeof v === 'object' && v ? flat(v as Dict, `${prefix}${k}.`) : [`${prefix}${k}`]));
    const ptKeys = flat(ptBR.detachForm as Dict).sort();
    expect(ptKeys.length).toBeGreaterThan(20);
    expect(flat(en.detachForm as Dict).sort()).toEqual(ptKeys);
    expect(t(ptBR)('operations.detachedFrom.SPLIT', { weapon: 'AK-47' })).toBe('separado de AK-47');
  });
});

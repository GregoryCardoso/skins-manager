// 10.7 (D366), QA do frontend: paridade pt-BR/en das chaves e dos marcadores {x} da separação, chaves usadas nos componentes existem nos dois
// idiomas, invalidação (inclui valor de mercado e é um superconjunto da aplicação), chave de cache da prévia e textos de erro por motivo.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { errorMessageFor } from '@/i18n/errorMessage';
import { translate } from '@/i18n/translate';
import { ApiRequestError, detachComponent, getDetachPreview } from '@/services/api';
import { INVALIDATION_MAP } from './queryInvalidation';
import { queryKeys } from './queryKeys';

type Dict = Record<string, unknown>;
const flat = (obj: Dict, prefix = ''): Record<string, string> =>
  Object.entries(obj).reduce<Record<string, string>>((acc, [k, v]) => {
    if (typeof v === 'object' && v !== null) Object.assign(acc, flat(v as Dict, `${prefix}${k}.`));
    else acc[`${prefix}${k}`] = String(v);
    return acc;
  }, {});
const PT = flat(ptBR as Dict);
const EN = flat(en as Dict);
const markers = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const byPrefix = (all: Record<string, string>, ...prefixes: string[]) => Object.keys(all).filter((k) => prefixes.some((p) => k.startsWith(p))).sort();
const t = (dict: Dict) => (key: string, params?: Record<string, string | number>) => translate(dict, key, params);

const NEW_PREFIXES = ['detachForm.', 'operations.detach.', 'operations.detachedFrom.', 'inventory.actions.detach'];
const NEW_ERRORS = ['errors.COMPONENT_NOT_DETACHABLE', 'errors.SPLIT_SHARE_REQUIRED'];
const NEW_REASONS = [
  'errorReasons.OPERATION_DATE_INVALID_BEFORE_APPLIED', 'errorReasons.OPERATION_DATE_INVALID_TRADE_UNLOCK_BEFORE_DETACHED',
  'errorReasons.INVALID_OPERATION_INPUT_SHARE_NOT_ALLOWED', 'errorReasons.INVALID_OPERATION_INPUT_SHARE_INVALID',
  'errorReasons.OPERATION_UNDO_BLOCKED_HANGING_OCCUPIED', 'errorReasons.OPERATION_UNDO_BLOCKED_DETACHED',
];

describe('i18n da separação: chaves e marcadores iguais em pt-BR e en', () => {
  test('o conjunto de chaves novas é idêntico nos dois idiomas, sem texto vazio', () => {
    const ptKeys = byPrefix(PT, ...NEW_PREFIXES);
    expect(ptKeys.length).toBeGreaterThan(25);
    expect(byPrefix(EN, ...NEW_PREFIXES)).toEqual(ptKeys);
    for (const key of [...ptKeys, ...NEW_ERRORS, ...NEW_REASONS]) {
      expect(PT[key]?.trim(), `pt-BR ${key}`).toBeTruthy();
      expect(EN[key]?.trim(), `en ${key}`).toBeTruthy();
    }
  });

  test('cada chave tem os mesmos marcadores {x} nos dois idiomas', () => {
    for (const key of [...byPrefix(PT, ...NEW_PREFIXES), ...NEW_ERRORS, ...NEW_REASONS]) {
      expect(markers(EN[key]), key).toEqual(markers(PT[key]));
    }
  });

  test('os marcadores de cada texto são os que o componente passa (nenhum {x} fica sem valor)', () => {
    const source = readFileSync(resolve(__dirname, '../components/DetachComponentModal.tsx'), 'utf8');
    const used = (key: string) => {
      const at = source.indexOf(`'${key}'`);
      if (at < 0) return null;
      const call = source.slice(at, source.indexOf(')', source.indexOf('}', at) > at ? source.indexOf('}', at) : at) + 1);
      return [...call.matchAll(/(\w+):/g)].map((m) => m[1]);
    };
    for (const key of ['detachForm.returnResult', 'detachForm.result', 'detachForm.valued', 'detachForm.cost']) {
      const params = used(key);
      expect(params, `${key} não usado no modal`).not.toBeNull();
      for (const marker of markers(PT[key])) expect(params, `${key}: {${marker}} sem valor`).toContain(marker);
    }
  });

  test('toda chave literal usada nos componentes da separação existe nos dois idiomas', () => {
    const files = ['DetachComponentModal.tsx', 'ItemActions.tsx', 'ItemOperationsList.tsx', 'GeneratedFromNote.tsx'];
    const keys = new Set<string>();
    for (const file of files) {
      const source = readFileSync(resolve(__dirname, '../components', file), 'utf8');
      for (const m of source.matchAll(/\bt\(\s*'([\w.]+)'/g)) if (/detach/i.test(m[1])) keys.add(m[1]);
    }
    expect(keys.size).toBeGreaterThan(10);
    for (const key of keys) {
      expect(PT[key], `pt-BR ${key}`).toBeDefined();
      expect(EN[key], `en ${key}`).toBeDefined();
    }
  });

  test('os motivos dinâmicos (detachForm.unavailable.*, operations.detach.*, detachedFrom.*) existem nos dois idiomas', () => {
    for (const reason of ['WEAPON_NO_PRICE', 'WEAPON_NOT_PRICEABLE', 'HANGING_NO_PRICE']) {
      expect(PT[`detachForm.unavailable.${reason}`]?.trim()).toBeTruthy();
      expect(EN[`detachForm.unavailable.${reason}`]?.trim()).toBeTruthy();
    }
    for (const mode of ['SPLIT', 'RETURN']) {
      expect(PT[`operations.detachedFrom.${mode}`]?.trim()).toBeTruthy();
      expect(EN[`operations.detachedFrom.${mode}`]?.trim()).toBeTruthy();
    }
    for (const key of ['operations.detach.RETURN', 'operations.detach.SPLIT_MARKET_CACHE', 'operations.detach.SPLIT_MANUAL']) {
      expect(PT[key]?.trim(), key).toBeTruthy();
      expect(EN[key]?.trim(), key).toBeTruthy();
    }
  });

  test('o tipo DETACH_COMPONENT tem rótulo nos dois idiomas', () => {
    const labels = Object.keys(PT).filter((k) => k.includes('DETACH_COMPONENT'));
    expect(labels.length).toBeGreaterThan(0);
    for (const key of labels) expect(EN[key]?.trim(), key).toBeTruthy();
  });
});

describe('invalidação da separação', () => {
  test('inclui valor de mercado e é superconjunto da aplicação e do desfazer; a chave da prévia fica sob "items"', () => {
    const groupsOf = (action: keyof typeof INVALIDATION_MAP) => new Set((INVALIDATION_MAP[action] as readonly (readonly unknown[])[]).map((k) => String(k[0])));
    const detach = groupsOf('item.detachComponent');
    expect(detach.has('marketValues')).toBe(true);
    for (const other of ['item.applyComponent', 'operation.undo', 'item.scrapeOff'] as const) {
      for (const group of groupsOf(other)) expect(detach.has(group), `${other}: ${group}`).toBe(true);
    }
    expect(groupsOf('operation.undo').has('marketValues')).toBe(true);
    expect(queryKeys.items.detachPreview(4, 8, null)).not.toEqual(queryKeys.items.detachPreview(4, 8, 3333));
    expect(queryKeys.items.detachPreview(4, 8, null)).not.toEqual(queryKeys.items.detachPreview(4, 9, null));
    expect(queryKeys.items.detachPreview(4, 8, null)[0]).toBe(queryKeys.items.all[0]);
  });
});

describe('API da separação', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (status = 200, body: unknown = { success: true, data: {} }) => {
    const fn = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })));
    vi.stubGlobal('fetch', fn);
    return fn;
  };

  test('a porcentagem 0 é enviada (não é tratada como ausente) na prévia e no corpo', async () => {
    let fn = stub();
    await getDetachPreview(4, 8, 0);
    expect(String(fn.mock.calls[0][0])).toMatch(/detach-preview\?hangingShareBp=0$/);
    fn = stub();
    await detachComponent(4, 8, { hangingShareBp: 0 });
    expect(JSON.parse(String((fn.mock.calls[0][1] as RequestInit).body))).toEqual({ hangingShareBp: 0 });
  });

  test('o POST é JSON e erros do backend viram ApiRequestError com o código', async () => {
    const fn = stub(422, { success: false, error: { code: 'SPLIT_SHARE_REQUIRED', message: 'x', field: 'hangingShareBp' } });
    await expect(detachComponent(4, 8, {})).rejects.toMatchObject({ code: 'SPLIT_SHARE_REQUIRED', field: 'hangingShareBp' });
    const headers = new Headers((fn.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get('Content-Type')).toMatch(/application\/json/);
  });
});

describe('textos de erro por motivo', () => {
  const err = (code: string, params: Record<string, unknown>, status = 409) => new ApiRequestError(code, 'm', status, { params });

  test.each([
    ['OPERATION_UNDO_BLOCKED', { reason: 'HANGING_OCCUPIED' }],
    ['OPERATION_UNDO_BLOCKED', { reason: 'DETACHED' }],
    ['INVALID_OPERATION_INPUT', { reason: 'SHARE_NOT_ALLOWED' }],
    ['INVALID_OPERATION_INPUT', { reason: 'SHARE_INVALID', max: 10000 }],
    ['OPERATION_DATE_INVALID', { reason: 'TRADE_UNLOCK_BEFORE_DETACHED' }],
  ])('%s %j tem texto próprio, sem {marcador} sobrando, nos dois idiomas', (code, params) => {
    for (const [dict, lang] of [[ptBR, 'pt-BR'], [en, 'en']] as const) {
      const text = errorMessageFor(err(code, params, 422), t(dict as Dict), lang);
      expect(text.trim().length).toBeGreaterThan(5);
      expect(text).not.toMatch(/\{\w+\}/);
      expect(text).not.toBe('m');
    }
  });

  test('o código sem motivo conhecido cai no texto do código; códigos novos têm texto', () => {
    expect(errorMessageFor(err('COMPONENT_NOT_DETACHABLE', {}), t(ptBR as Dict), 'pt-BR')).toBe(ptBR.errors.COMPONENT_NOT_DETACHABLE);
    expect(errorMessageFor(err('COMPONENT_NOT_DETACHABLE', {}), t(en as Dict), 'en')).toBe(en.errors.COMPONENT_NOT_DETACHABLE);
    expect(errorMessageFor(err('OPERATION_UNDO_BLOCKED', { reason: 'MOTIVO_NOVO_INEXISTENTE' }), t(ptBR as Dict), 'pt-BR').trim()).not.toBe('');
  });
});

// 10.4 (D363): abrir caixa, cápsula, pacote e terminal. Chamadas do api.ts, mensagens de erro por código e motivo, paridade das chaves de
// tradução dos componentes novos e invalidação das ações.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { API_ERROR_CODES } from '@/i18n/errorCodes';
import { errorMessageFor } from '@/i18n/errorMessage';
import { translate } from '@/i18n/translate';
import { INVALIDATION_MAP } from '@/lib/queryInvalidation';
import { ApiRequestError, getOpenOptions, openContainer, setSteamStore } from '@/services/api';

const tPt = (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params);
const tEn = (key: string, params?: Record<string, string | number>) => translate(en, key, params);
const err = (code: string, extra: { field?: string; params?: unknown } = {}) => new ApiRequestError(code, 'msg do backend', 422, extra);

function stubFetch(data: unknown = {}) {
  const fn = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  vi.stubGlobal('fetch', fn);
  return fn;
}
const call = (fn: ReturnType<typeof vi.fn>) => {
  const [url, init] = fn.mock.calls[0] as [string, RequestInit];
  return { url: new URL(url), method: init.method, body: init.body ? JSON.parse(init.body as string) : undefined };
};
afterEach(() => vi.unstubAllGlobals());

describe('chamadas do api.ts', () => {
  test('getOpenOptions, openContainer e setSteamStore', async () => {
    let fn = stubFetch({ kind: 'CASE' });
    await getOpenOptions(7);
    expect(call(fn)).toMatchObject({ method: 'GET' });
    expect(call(fn).url.pathname).toMatch(/\/items\/7\/open-options$/);

    fn = stubFetch({});
    await openContainer(7, { keyItemId: 3, openedAt: '2026-11-15T12:00:00.000Z', generated: { catalogId: 'skin-1' } });
    expect(call(fn)).toMatchObject({ method: 'POST', body: { keyItemId: 3, openedAt: '2026-11-15T12:00:00.000Z', generated: { catalogId: 'skin-1' } } });
    expect(call(fn).url.pathname).toMatch(/\/items\/7\/open$/);

    fn = stubFetch({});
    await setSteamStore(2);
    expect(call(fn)).toMatchObject({ method: 'PUT', body: { storeId: 2 } });
    expect(call(fn).url.pathname).toMatch(/\/settings\/steam-store$/);
    fn = stubFetch({});
    await setSteamStore(null);
    expect(call(fn).body).toEqual({ storeId: null });
  });
});

describe('mensagens de erro da abertura', () => {
  const NEW_CODES = [
    'ITEM_NOT_OPENABLE', 'CASE_KEY_REQUIRED', 'CASE_KEY_INCOMPATIBLE', 'INVALID_OPERATION_INPUT', 'GENERATED_ITEM_REQUIRED',
    'GENERATED_COST_NOT_ALLOWED', 'GENERATED_FIELD_LOCKED', 'STEAM_STORE_REQUIRED',
  ];

  test('os códigos novos estão na lista e traduzidos nos dois idiomas', () => {
    for (const code of NEW_CODES) {
      expect(API_ERROR_CODES).toContain(code);
      expect(tPt(`errors.${code}`)).not.toBe(`errors.${code}`);
      expect(tEn(`errors.${code}`)).not.toBe(`errors.${code}`);
    }
  });

  test('a chave exigida e a incompatível aparecem na mensagem', () => {
    const required = err('CASE_KEY_REQUIRED', { field: 'keyItemId', params: { keyName: 'Kilowatt Case Key' } });
    expect(errorMessageFor(required, tPt, 'pt-BR')).toContain('Kilowatt Case Key');
    expect(errorMessageFor(required, tEn, 'en')).toContain('Kilowatt Case Key');
    const wrong = err('CASE_KEY_INCOMPATIBLE', { params: { keyName: 'Chroma Case Key', caseName: 'Kilowatt Case' } });
    expect(errorMessageFor(wrong, tPt, 'pt-BR')).toBe('A chave "Chroma Case Key" não abre a caixa "Kilowatt Case".');
    expect(errorMessageFor(wrong, tEn, 'en')).toBe('The key "Chroma Case Key" does not open the case "Kilowatt Case".');
    expect(errorMessageFor(err('CASE_KEY_REQUIRED'), tPt, 'pt-BR')).toBe('Esta caixa precisa de uma chave do estoque.');
  });

  test('motivos de INVALID_OPERATION_INPUT e de OPERATION_DATE_INVALID têm texto nos dois idiomas', () => {
    const reasons = ['NOT_A_KEY', 'KEY_NOT_ALLOWED', 'DECISION_REQUIRED', 'DECISION_INVALID', 'DECISION_NOT_ALLOWED', 'PRICE_NOT_ALLOWED', 'GENERATED_NOT_ALLOWED', 'GENERATED_FIELD_NOT_ALLOWED'];
    for (const reason of reasons) {
      const error = err('INVALID_OPERATION_INPUT', { params: { reason } });
      expect(errorMessageFor(error, tPt, 'pt-BR')).not.toBe(tPt('errors.INVALID_OPERATION_INPUT'));
      expect(errorMessageFor(error, tEn, 'en')).not.toBe(tEn('errors.INVALID_OPERATION_INPUT'));
    }
    for (const reason of ['BEFORE_CONTAINER_ACQUIRED', 'BEFORE_KEY_ACQUIRED']) {
      const error = err('OPERATION_DATE_INVALID', { field: 'openedAt', params: { reason, acquiredAt: '2026-11-10T12:00:00.000Z' } });
      expect(errorMessageFor(error, tPt, 'pt-BR')).toContain('10/11/2026');
      expect(errorMessageFor(error, tEn, 'en')).toContain('11/10/26');
    }
    expect(errorMessageFor(err('OPERATION_DATE_INVALID', { params: { reason: 'TRADE_UNLOCK_BEFORE_OPENED' } }), tPt, 'pt-BR')).toBe('O fim do trade lock não pode ser antes da abertura.');
  });

  test('campo travado do item gerado cita o rótulo do campo', () => {
    const error = err('GENERATED_FIELD_LOCKED', { field: 'acquisitionType', params: { field: 'acquisitionType' } });
    expect(errorMessageFor(error, tPt, 'pt-BR')).toBe('Este item foi obtido por uma abertura ou separação. Desfaça a operação para mudar "Como obteve".');
  });
});

describe('invalidação e traduções dos componentes novos', () => {
  test('item.open recarrega itens, vendas, lojas, saldos, lucro real e importações; settings.steamStore, as configurações, lojas e itens', () => {
    const groups = (action: keyof typeof INVALIDATION_MAP) => (INVALIDATION_MAP[action] as readonly (readonly unknown[])[]).map((k) => String(k[0])).sort();
    expect(groups('item.open')).toEqual(groups('item.applyComponent'));
    expect(groups('settings.steamStore')).toEqual(['items', 'marketValues', 'settings', 'stores']);
  });

  const flatten = (node: unknown, prefix = ''): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const full = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'string') out[full] = value;
      else Object.assign(out, flatten(value, full));
    }
    return out;
  };
  const dicts = { 'pt-BR': flatten(ptBR), en: flatten(en) };

  test('toda chave literal usada nos componentes da abertura existe em pt-BR e en', () => {
    const dir = path.resolve(__dirname, '../components');
    const files = ['OpenContainerModal.tsx', 'GeneratedFromNote.tsx', 'inventory/ItemRowActions.tsx', 'StoreCard.tsx', 'ItemOperationsList.tsx', 'ItemHistoryBox.tsx', 'ProfitEquation.tsx', 'ItemIdentityFields.tsx'];
    const missing: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const m of source.matchAll(/\bt(?:Plural|Loose)?\(\s*'([A-Za-z0-9_.]+)'/g)) {
        const key = m[1];
        for (const [lang, dict] of Object.entries(dicts)) {
          if (!(key in dict) && !Object.keys(dict).some((k) => k.startsWith(`${key}.`))) missing.push(`${lang}:${file}:${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test('variantes dinâmicas: operations.generatedFrom.* e openForm.* têm as mesmas chaves nos dois idiomas', () => {
    for (const variant of ['CASE', 'CASE_KEY', 'CAPSULE', 'PACKAGE', 'TERMINAL']) {
      expect(dicts['pt-BR'][`operations.generatedFrom.${variant}`]).toBeTruthy();
      expect(dicts.en[`operations.generatedFrom.${variant}`]).toBeTruthy();
    }
    const keysOf = (dict: Record<string, string>) => Object.keys(dict).filter((k) => k.startsWith('openForm.') || k.startsWith('stores.steam')).sort();
    expect(keysOf(dicts['pt-BR'])).toEqual(keysOf(dicts.en));
    expect(tPt('operations.generatedFrom.CASE_KEY', { container: 'Kilowatt Case', key: 'Kilowatt Case Key' })).toBe('aberto de Kilowatt Case com Kilowatt Case Key');
  });
});

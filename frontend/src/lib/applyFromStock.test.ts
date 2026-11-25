// 10.3 (D362): aplicar do estoque no frontend: estado do formulário (patches e aplicados), avisos da importação, textos por motivo,
// chamadas da API e invalidação.
import { afterEach, describe, expect, test, vi } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { errorMessageFor } from '@/i18n/errorMessage';
import { translate } from '@/i18n/translate';
import { applyComponent, getApplyCandidates, listItemOperations, scrapeOffComponent, undoOperation, ApiRequestError } from '@/services/api';
import type { ImportEntryView, ItemComponent } from '@/types/api';
import {
  appliedChanges, buildComponentsBody, componentsAllowedFor, componentsBodyFromItem, componentsStateFromItem, emptyComponentsState, newPatchDraft,
  sameComponents,
} from './itemComponents';
import { componentWarningsOf, entryActions, stockCandidateOf } from './importSummary';
import { INVALIDATION_MAP } from './queryInvalidation';
import { makeItem } from './testFixtures';

const component = (over: Partial<ItemComponent>): ItemComponent => ({
  id: 1, kind: 'STICKER', catalogId: 'st1', name: 'Sticker | st1', namePtBr: null, imageUrl: null, slot: 1, wear: 0.1, pattern: null,
  source: 'MANUAL', origin: 'APPLIED_FROM_STOCK', sourceItemId: 7, operationId: 3, undoable: true, scrapeable: true, detachable: false, ...over,
});

describe('componentes: o que veio junto e o aplicado do estoque ficam separados', () => {
  const item = makeItem({
    components: [
      component({ id: 1, origin: 'CAME_WITH', sourceItemId: null, operationId: null, slot: 0, wear: null, undoable: false, scrapeable: false }),
      component({ id: 2 }),
      component({ id: 3, kind: 'CHARM', catalogId: 'ch1', slot: null, wear: null, pattern: 5 }),
    ],
  });

  test('o estado do formulário tem a lista editável só com o que veio junto; os aplicados vão à parte', () => {
    const state = componentsStateFromItem(item, 'en');
    expect(state.stickers).toHaveLength(1);
    expect(state.hanging).toBeNull();
    expect(state.applied.map((a) => a.component.id)).toEqual([2, 3]);
    expect(state.applied[0]).toMatchObject({ slot: '1', wearText: '10', patternText: '' });
    expect(componentsBodyFromItem(item)).toEqual([{ kind: 'STICKER', catalogId: 'st1', slot: 0 }]);
  });

  test('sem mexer nos aplicados o corpo só leva o que veio junto e nada mudou', () => {
    const state = componentsStateFromItem(item, 'en');
    const built = buildComponentsBody(state, 'en');
    expect(built).toEqual({ ok: true, body: [{ kind: 'STICKER', catalogId: 'st1', slot: 0 }] });
    if (built.ok) expect(sameComponents(built.body, componentsBodyFromItem(item))).toBe(true);
  });

  test('mudar posição, desgaste ou pattern de um aplicado manda só `{ id, ... }`; limpar vira nulo', () => {
    const state = componentsStateFromItem(item, 'en');
    state.applied[0] = { ...state.applied[0], slot: '3', wearText: '40' };
    state.applied[1] = { ...state.applied[1], patternText: '' };
    const built = buildComponentsBody(state, 'en');
    expect(built).toEqual({
      ok: true,
      body: [
        { kind: 'STICKER', catalogId: 'st1', slot: 0 },
        { id: 2, slot: 3, wear: 0.4 },
        { id: 3, slot: null, pattern: null },
      ],
    });
    if (built.ok) expect(sameComponents(built.body, componentsBodyFromItem(item))).toBe(false);
  });

  test('valores inválidos de um aplicado viram erro local', () => {
    const state = componentsStateFromItem(item, 'en');
    expect(appliedChanges({ ...state.applied[0], wearText: 'x' }, 'en')).toBe('invalidWear');
    expect(appliedChanges({ ...state.applied[1], patternText: '1000000' }, 'en')).toBe('invalidPattern');
    expect(appliedChanges(state.applied[0], 'en')).toBeNull();
  });
});

describe('patches no agente', () => {
  test('a seção de patches só vale para PERSONAGEM com patches no catálogo; arma continua valendo', () => {
    expect(componentsAllowedFor('SKIN')).toBe(true);
    expect(componentsAllowedFor('PERSONAGEM')).toBe(false);
    expect(componentsAllowedFor('PERSONAGEM', true)).toBe(true);
    expect(componentsAllowedFor('FACA', true)).toBe(false);
  });

  test('o corpo leva os patches com a posição; sem item do catálogo é erro local', () => {
    const state = emptyComponentsState();
    const draft = { ...newPatchDraft(), catalog: { id: 'patch-1', name: 'Patch | A', namePtBr: null, imageUrl: null }, slot: '2' };
    expect(buildComponentsBody({ ...state, patches: [draft] }, 'en')).toEqual({ ok: true, body: [{ kind: 'PATCH', catalogId: 'patch-1', slot: 2 }] });
    expect(buildComponentsBody({ ...state, patches: [newPatchDraft()] }, 'en')).toMatchObject({ ok: false, errorKey: 'itemForm.components.choosePatch' });
  });
});

describe('avisos de componente possivelmente aplicado do estoque', () => {
  const entry = (outcome: ImportEntryView['outcome'], warnings: ImportEntryView['display']['componentWarnings'], allowedActions?: ImportEntryView['allowedActions']): ImportEntryView => ({
    id: 9, batchId: 1, outcome, reasonCode: null, entityType: 'ITEM_SALE', entityId: 5, candidateIds: [], resolution: null, resolvedAt: null, allowedActions,
    display: {
      direction: 'SELL', marketHashName: 'X', name: 'X', namePtBr: null, imageUrl: null, catalogId: null, category: 'SKIN', variant: 'NORMAL',
      floatValue: null, paintSeed: null, phase: null, priceCents: 100, currency: 'USD', date: null, state: null, componentWarnings: warnings,
    },
  });
  const maybe = { code: 'COMPONENT_MAYBE_APPLIED_FROM_STOCK' as const, name: 'Sticker | BIG', candidateItemId: 42 };

  test('aparece na venda criada e na ligada; os avisos de compra continuam só na criada', () => {
    expect(componentWarningsOf(entry('CREATED', [maybe]))).toEqual([maybe]);
    expect(componentWarningsOf(entry('MATCHED', [maybe, { code: 'COMPONENT_LIMIT_EXCEEDED', name: 'Y' }]))).toEqual([maybe]);
    expect(componentWarningsOf(entry('FAILED', [maybe]))).toEqual([]);
    expect(stockCandidateOf(entry('CREATED', [maybe]))).toBe(42);
    expect(stockCandidateOf(entry('CREATED', [{ code: 'COMPONENT_FULLY_SCRAPED', name: 'Y' }]))).toBeNull();
  });

  test('a ação vem de `allowedActions` e tem rótulo e resultado nos dois idiomas', () => {
    expect(entryActions(entry('CREATED', [maybe], ['APPLY_FROM_STOCK']))).toEqual(['APPLY_FROM_STOCK']);
    expect(entryActions(entry('CREATED', [maybe], []))).toEqual([]);
    for (const lang of [ptBR, en]) {
      expect(lang.imports.actions.APPLY_FROM_STOCK.trim()).not.toBe('');
      expect(lang.imports.actions.resolved.APPLIED.trim()).not.toBe('');
      expect((lang.imports.componentWarnings as Record<string, string>).COMPONENT_MAYBE_APPLIED_FROM_STOCK).toContain('{name}');
      expect(lang.imports.undo.ITEM_IN_OPERATION.trim()).not.toBe('');
    }
  });
});

describe('mensagens por motivo', () => {
  const t = (lang: typeof ptBR) => (key: string, params?: Record<string, string | number>) => translate(lang as never, key, params);
  const error = (code: string, params: Record<string, unknown>) => new ApiRequestError(code, 'm', 409, { params });

  test('OPERATION_DATE_INVALID e OPERATION_UNDO_BLOCKED escolhem o texto pelo motivo e citam a data do limite', () => {
    const date = errorMessageFor(error('OPERATION_DATE_INVALID', { reason: 'AFTER_SALE', soldAt: '2026-11-20T10:00:00.000Z' }), t(ptBR), 'pt-BR');
    expect(date).toContain('depois da venda');
    expect(date).toContain('20/11/2026');
    expect(errorMessageFor(error('OPERATION_DATE_INVALID', { reason: 'FUTURE' }), t(en), 'en')).toBe('The date cannot be in the future.');
    expect(errorMessageFor(error('OPERATION_UNDO_BLOCKED', { reason: 'TARGET_SOLD' }), t(ptBR), 'pt-BR')).toContain('vendido');
    // motivo desconhecido: texto geral do código
    expect(errorMessageFor(error('OPERATION_UNDO_BLOCKED', { reason: 'OUTRO' }), t(ptBR), 'pt-BR')).toBe(ptBR.errors.OPERATION_UNDO_BLOCKED);
    expect(errorMessageFor(error('ITEM_CONSUMED', {}), t(en), 'en')).toBe(en.errors.ITEM_CONSUMED);
  });

  test('todo motivo do backend tem texto nos dois idiomas', () => {
    const reasons = ['FUTURE', 'BEFORE_TARGET_ACQUIRED', 'BEFORE_SOURCE_ACQUIRED', 'AFTER_SALE', 'BEFORE_APPLICATION', 'ACQUIRED_AFTER_OPERATION'];
    const blocked = ['NOT_LATEST', 'TARGET_SOLD', 'TARGET_NOT_IN_STOCK'];
    for (const lang of [ptBR, en]) {
      const texts = lang.errorReasons as Record<string, string>;
      for (const r of reasons) expect(texts[`OPERATION_DATE_INVALID_${r}`]?.trim(), r).toBeTruthy();
      for (const r of blocked) expect(texts[`OPERATION_UNDO_BLOCKED_${r}`]?.trim(), r).toBeTruthy();
    }
  });
});

describe('API e invalidação', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = () => {
    const fn = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ success: true, data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    vi.stubGlobal('fetch', fn);
    return fn;
  };
  const call = (fn: ReturnType<typeof stub>) => ({ url: String(fn.mock.calls[0][0]), init: fn.mock.calls[0][1] as RequestInit });

  test('as cinco chamadas usam as rotas do backend', async () => {
    let fn = stub();
    await getApplyCandidates(4);
    expect(call(fn).url).toMatch(/\/api\/items\/4\/apply-candidates$/);
    fn = stub();
    await applyComponent(4, { sourceItemId: 9, slot: 1, appliedAt: '2026-11-15T12:00:00-03:00' });
    expect(call(fn).url).toMatch(/\/api\/items\/4\/apply-component$/);
    expect(call(fn).init.method).toBe('POST');
    expect(JSON.parse(String(call(fn).init.body))).toEqual({ sourceItemId: 9, slot: 1, appliedAt: '2026-11-15T12:00:00-03:00' });
    fn = stub();
    await scrapeOffComponent(4, 8);
    expect(call(fn).url).toMatch(/\/api\/items\/4\/components\/8\/scrape-off$/);
    fn = stub();
    await listItemOperations(4);
    expect(call(fn).url).toMatch(/\/api\/items\/4\/operations$/);
    fn = stub();
    await undoOperation(6);
    expect(call(fn).url).toMatch(/\/api\/operations\/6\/undo$/);
    expect(call(fn).init.method).toBe('POST');
  });

  test('as três ações invalidam itens, vendas, lojas, saldos, lucro real e importações', () => {
    for (const action of ['item.applyComponent', 'item.scrapeOff', 'operation.undo'] as const) {
      const groups = (INVALIDATION_MAP[action] as readonly (readonly unknown[])[]).map((k) => k[0]).sort();
      expect(groups).toEqual(['imports', 'items', 'marketValues', 'profitSummary', 'sales', 'storeBalances', 'stores']);
    }
  });
});

import { describe, expect, test } from 'vitest';
import {
  buildComponentsBody, componentTooltip, componentsAllowedFor, componentsBodyFromItem, componentsStateFromItem,
  emptyComponentsState, newStickerDraft, parseWearText, sameComponents, wearToText,
} from './itemComponents';
import { makeItem } from './testFixtures';
import type { ItemComponent } from '@/types/api';

const catalog = (id: string) => ({ id, name: `Sticker | ${id}`, namePtBr: null, imageUrl: null });
const component = (over: Partial<ItemComponent>): ItemComponent => ({
  id: 1, kind: 'STICKER', catalogId: 'st1', name: 'Sticker | st1', namePtBr: null, imageUrl: null, slot: null, wear: null, pattern: null,
  source: 'MANUAL', origin: 'CAME_WITH', sourceItemId: null, operationId: null, undoable: false, scrapeable: false, detachable: false, ...over,
});

describe('desgaste em %', () => {
  test('ida e volta sem ruído de ponto flutuante', () => {
    expect(wearToText(0.1, 'en')).toBe('10');
    expect(wearToText(0.255, 'pt-BR')).toBe('25,5');
    expect(parseWearText('25,5', 'pt-BR')).toBe(0.255);
    expect(parseWearText('10', 'en')).toBe(0.1);
    expect(parseWearText('0', 'en')).toBe(0);
  });
  test('inválidos', () => {
    for (const text of ['100', '-1', 'abc', '1e3']) expect(parseWearText(text, 'en')).toBeNull();
  });
});

describe('buildComponentsBody', () => {
  test('vazio gera lista vazia (limpa)', () => {
    expect(buildComponentsBody(emptyComponentsState(), 'en')).toEqual({ ok: true, body: [] });
  });
  test('stickers com slot e desgaste mais o pendurado com pattern', () => {
    const a = { ...newStickerDraft(), catalog: catalog('st1'), slot: '2', wearText: '10' };
    const b = { ...newStickerDraft(), catalog: catalog('st2') };
    const result = buildComponentsBody({ stickers: [a, b], hanging: { kind: 'STICKER_SLAB', catalog: catalog('st3'), patternText: '77' }, patches: [], applied: [] }, 'en');
    expect(result).toEqual({
      ok: true,
      body: [
        { kind: 'STICKER', catalogId: 'st1', slot: 2, wear: 0.1 },
        { kind: 'STICKER', catalogId: 'st2' },
        { kind: 'STICKER_SLAB', catalogId: 'st3', pattern: 77 },
      ],
    });
  });
  test('erros locais: sem item do catálogo, desgaste e pattern inválidos', () => {
    expect(buildComponentsBody({ stickers: [newStickerDraft()], hanging: null, patches: [], applied: [] }, 'en')).toMatchObject({ ok: false, errorKey: 'itemForm.components.chooseSticker', params: { n: 1 } });
    const bad = { ...newStickerDraft(), catalog: catalog('st1'), wearText: 'x' };
    expect(buildComponentsBody({ stickers: [bad], hanging: null, patches: [], applied: [] }, 'en')).toMatchObject({ ok: false, errorKey: 'itemForm.components.invalidWear' });
    expect(buildComponentsBody({ stickers: [], hanging: { kind: 'CHARM', catalog: null, patternText: '' }, patches: [], applied: [] }, 'en')).toMatchObject({ ok: false, errorKey: 'itemForm.components.chooseCharm' });
    expect(buildComponentsBody({ stickers: [], hanging: { kind: 'CHARM', catalog: catalog('c'), patternText: '1000000' }, patches: [], applied: [] }, 'en')).toMatchObject({ ok: false, errorKey: 'itemForm.components.invalidPattern' });
  });
});

describe('estado a partir do item e comparação', () => {
  const item = makeItem({
    components: [
      component({ id: 1, slot: 1, wear: 0.1 }),
      component({ id: 2, kind: 'CHARM', catalogId: 'ch1', name: 'Charm | ch1', pattern: 5 }),
    ],
  });
  test('rascunhos do item geram o mesmo corpo gravado (sem mudança no PATCH)', () => {
    const state = componentsStateFromItem(item, 'en');
    expect(state.stickers).toHaveLength(1);
    expect(state.hanging).toMatchObject({ kind: 'CHARM', patternText: '5' });
    const built = buildComponentsBody(state, 'en');
    expect(built.ok && sameComponents(built.body, componentsBodyFromItem(item))).toBe(true);
  });
  test('sameComponents ignora a ordem e vê diferenças', () => {
    const a = [{ kind: 'STICKER' as const, catalogId: 'a', slot: 0 }, { kind: 'STICKER' as const, catalogId: 'b', slot: 1 }];
    expect(sameComponents(a, [a[1], a[0]])).toBe(true);
    expect(sameComponents(a, [a[0]])).toBe(false);
    expect(sameComponents(a, [{ ...a[0], wear: 0.2 }, a[1]])).toBe(false);
  });
});

test('só SKIN mostra a seção (10.1)', () => {
  expect(componentsAllowedFor('SKIN')).toBe(true);
  for (const c of ['FACA', 'LUVA', 'CAIXA', 'STICKER', 'PERSONAGEM', 'OUTRO', ''] as const) expect(componentsAllowedFor(c)).toBe(false);
});

test('componentTooltip', () => {
  const labels = { slot: 'slot', wear: 'wear', pattern: 'pattern' };
  expect(componentTooltip(component({ slot: 1, wear: 0.1, pattern: 3 }), 'en', labels)).toBe('Sticker | st1 · slot 1 · wear 10% · pattern 3');
  expect(componentTooltip(component({ namePtBr: 'Adesivo' }), 'pt-BR', labels)).toBe('Adesivo');
});

import { describe, expect, test } from 'vitest';
import { makeItem } from './testFixtures';
import {
  MAX_BULK_IDS, groupSelectionState, itemIdsOf, pruneSelection, replaceScoped, selectionDirection, setGroupSelected, unitIdsOf,
} from './inventorySelection';
import type { ItemGroup } from '@/types/api';

const group = (ids: number[]): ItemGroup => ({ key: `g${ids.join('-')}`, units: ids.map((id) => makeItem({ id })) }) as unknown as ItemGroup;

describe('inventorySelection (pura)', () => {
  test('limite e direção pela aba', () => {
    expect(MAX_BULK_IDS).toBe(500);
    expect(selectionDirection('FOR_SALE')).toBe('OFF_SALE');
    expect(selectionDirection('OFF_SALE')).toBe('FOR_SALE');
  });

  test('pruneSelection devolve o mesmo conjunto quando nada sai', () => {
    const selected = new Set([1, 2]);
    expect(pruneSelection(selected, new Set([1, 2, 3]))).toBe(selected);
    expect([...pruneSelection(selected, new Set([2]))]).toEqual([2]);
  });

  test('ids visíveis das duas visões', () => {
    expect([...unitIdsOf([group([1, 2]), group([3])])]).toEqual([1, 2, 3]);
    expect([...itemIdsOf([makeItem({ id: 5 })])]).toEqual([5]);
  });

  test('estado do grupo e marcar/desmarcar só as unidades dele', () => {
    const g = group([1, 2, 3]);
    expect(groupSelectionState(g, new Set())).toBe('none');
    expect(groupSelectionState(g, new Set([2]))).toBe('some');
    expect(groupSelectionState(g, new Set([1, 2, 3]))).toBe('all');
    expect([...setGroupSelected(new Set([9]), g, true)].sort()).toEqual([1, 2, 3, 9]);
    expect([...setGroupSelected(new Set([1, 2, 3, 9]), g, false)]).toEqual([9]);
  });

  test('replaceScoped mexe só no escopo', () => {
    expect([...replaceScoped(new Set([1, 9]), [1, 2], new Set([2]))].sort()).toEqual([2, 9]);
  });
});

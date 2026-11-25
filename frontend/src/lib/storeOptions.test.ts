import { describe, expect, test } from 'vitest';
import { launchStoreOptions } from './storeOptions';
import { makeStore } from './testFixtures';

describe('launchStoreOptions', () => {
  const stores = [makeStore({ id: 1 }), makeStore({ id: 2, isActive: false }), makeStore({ id: 3 }), makeStore({ id: 4, isActive: false })];

  test('lançamento novo: só as lojas ativas', () => {
    expect(launchStoreOptions(stores).map((s) => s.id)).toEqual([1, 3]);
    expect(launchStoreOptions(stores, [null, undefined]).map((s) => s.id)).toEqual([1, 3]);
  });

  test('edição: a loja gravada inativa continua na lista, na ordem original', () => {
    expect(launchStoreOptions(stores, [2]).map((s) => s.id)).toEqual([1, 2, 3]);
    expect(launchStoreOptions(stores, [2, 4]).map((s) => s.id)).toEqual([1, 2, 3, 4]);
  });

  test('loja gravada ativa não duplica; id desconhecido é ignorado', () => {
    expect(launchStoreOptions(stores, [1, 99]).map((s) => s.id)).toEqual([1, 3]);
  });
});

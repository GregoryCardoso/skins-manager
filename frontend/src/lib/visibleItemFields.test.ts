import { describe, expect, test } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { resolveErrorTarget } from './formErrors';
import { visibleItemFields, type FieldVisibility } from './itemForm';

const ALL = ['catalogId', 'name', 'category', 'variant', 'floatValue', 'exterior', 'paintSeed', 'phase', 'purchasePriceCents', 'fxRateAtPurchase', 'inspectLink'];
const base: FieldVisibility = { weapon: false, exteriorInput: false, exteriorDerived: false, phaseLocked: false, price: true, fx: false, informativeStore: false, receivedDateLabel: false, informativeStoreInDetails: false };
const mode = { showSearch: false, freeMode: false, hasCatalog: true };
const err = (code: string, field?: string) => new ApiRequestError(code, 'm', 400, field ? { field } : {});

describe('visibleItemFields', () => {
  test('item escolhido, não arma, compra em USD', () => {
    expect(visibleItemFields(ALL, base, mode)).toEqual(['purchasePriceCents', 'inspectLink']);
  });
  test('busca aberta mostra catalogId; modo livre mostra nome e categoria', () => {
    expect(visibleItemFields(ALL, base, { showSearch: true, freeMode: false, hasCatalog: false })).toContain('catalogId');
    const free = visibleItemFields(ALL, base, { showSearch: true, freeMode: true, hasCatalog: false });
    expect(free).toEqual(expect.arrayContaining(['name', 'category']));
  });
  test('arma e BRL mostram atributos e câmbio; GANHEI esconde o preço', () => {
    const v = visibleItemFields(ALL, { ...base, weapon: true, fx: true, price: false }, mode);
    expect(v).toEqual(expect.arrayContaining(['variant', 'floatValue', 'exterior', 'paintSeed', 'phase', 'fxRateAtPurchase']));
    expect(v).not.toContain('purchasePriceCents');
  });
  test('erro de campo oculto vai para o topo com rótulo', () => {
    const v = visibleItemFields(ALL, { ...base, price: false }, mode);
    expect(resolveErrorTarget(err('GANHEI_COST_NOT_ALLOWED'), v)).toEqual({ target: null, topLabelField: 'purchasePriceCents' });
    expect(resolveErrorTarget(err('INVALID_FLOAT', 'floatValue'), v)).toEqual({ target: null, topLabelField: 'floatValue' });
    expect(resolveErrorTarget(err('CATALOG_ITEM_NOT_FOUND'), v)).toEqual({ target: null, topLabelField: 'catalogId' });
    const open = visibleItemFields(ALL, base, { showSearch: true, freeMode: false, hasCatalog: true });
    expect(resolveErrorTarget(err('CATALOG_ITEM_NOT_FOUND'), open)).toEqual({ target: 'catalogId', topLabelField: null });
  });
});

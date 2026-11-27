import { describe, expect, test } from 'vitest';
import { revealFor } from './formErrors';
import { detailsCollapsedByDefault, fieldsInDetails, isUnitSellable, sellableUnitsOf } from './sellForm';
import { makeItem, makeStore, STORES } from './testFixtures';

const [csfloat, steam, csmoney] = STORES;

describe('detailsCollapsedByDefault', () => {
  test('recolhido quando as taxas da loja estão configuradas; aberto sem taxa ou sem loja', () => {
    expect(detailsCollapsedByDefault(csfloat)).toBe(true);
    expect(detailsCollapsedByDefault(steam)).toBe(true);
    expect(detailsCollapsedByDefault(csmoney)).toBe(false);
    expect(detailsCollapsedByDefault(undefined)).toBe(false);
  });
});

describe('fieldsInDetails', () => {
  test('com taxas: o líquido (e a cotação, fora de USD) vão para "Mais detalhes"', () => {
    expect(fieldsInDetails(csfloat)).toEqual(['netReceivedCents']);
    expect(fieldsInDetails(steam)).toEqual(['netReceivedCents', 'fxRateAtSale']);
  });

  test('sem taxas: o líquido fica à vista; só a cotação (loja fora de USD) vai para o bloco', () => {
    expect(fieldsInDetails(csmoney)).toEqual([]);
    expect(fieldsInDetails(makeStore({ id: 9, currency: 'JPY' }))).toEqual(['fxRateAtSale']);
    expect(fieldsInDetails(undefined)).toEqual([]);
  });
});

describe('revealFor com os campos da venda', () => {
  test('abre "Mais detalhes" só para os campos que o formulário escondeu', () => {
    const detailsFields = fieldsInDetails(steam);
    expect(revealFor('fxRateAtSale', { detailsFields })).toBe('details');
    expect(revealFor('netReceivedCents', { detailsFields })).toBe('details');
    expect(revealFor('salePriceCents', { detailsFields })).toBeNull();
    expect(revealFor('netReceivedCents', { detailsFields: fieldsInDetails(csmoney) })).toBeNull();
  });

  test('o comportamento do formulário do item não muda', () => {
    expect(revealFor('assetId')).toBe('details');
    expect(revealFor('purchaseStoreId', { informativeStoreInDetails: true })).toBe('details');
    expect(revealFor('purchaseStoreId')).toBeNull();
  });
});

describe('unidades do seletor', () => {
  const locked = { isLocked: true, remainingMs: 1, formatted: '1d', tradeUnlockAt: '2099-01-01T00:00:00.000Z' };

  test('só as unidades em estoque entram; trade lock não é vendável', () => {
    const units = [makeItem({ id: 1, tradeLock: locked }), makeItem({ id: 2 }), makeItem({ id: 3, status: 'VENDIDO' }), makeItem({ id: 4, saleState: 'OFF_SALE' })];
    expect(sellableUnitsOf(units).map((unit) => unit.id)).toEqual([1, 2, 4]);
    expect(sellableUnitsOf(undefined)).toEqual([]);
    expect(isUnitSellable(units[0])).toBe(false);
    expect(isUnitSellable(units[1])).toBe(true);
    // do holding também se vende (a venda guarda que saiu do holding)
    expect(isUnitSellable(units[3])).toBe(true);
  });
});

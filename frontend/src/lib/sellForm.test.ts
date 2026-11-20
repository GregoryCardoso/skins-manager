import { describe, expect, test } from 'vitest';
import {
  applySaleStore, buildSellBody, initialSellState, netTextFromQuote, priceLabelKey, recalculate, referenceFor,
  type SellContext,
} from './sellForm';
import { STORES, makeItem } from './testFixtures';

const ctx: SellContext = { stores: STORES, usdBrlRate: 5.4, language: 'pt-BR' };
const NOW = '2026-11-20T12:00';
const store = (id: number) => STORES.find((s) => s.id === id);

describe('rótulos e visibilidade', () => {
  test('rótulo do preço pelo tipo da taxa', () => {
    expect(priceLabelKey(store(1))).toBe('sellForm.salePriceDeducted');
    expect(priceLabelKey(store(2))).toBe('sellForm.salePriceAdded');
    expect(priceLabelKey(store(3))).toBe('sellForm.salePriceDeducted');
  });

  test('estado inicial: loja principal, agora, sem cotação em USD', () => {
    expect(initialSellState(ctx, NOW)).toMatchObject({ storeId: 1, soldAt: NOW, fxText: '', netText: '', netTouched: false });
  });

  test('loja BRL pré-preenche a cotação; trocar de loja zera o líquido', () => {
    const s = applySaleStore({ ...initialSellState(ctx, NOW), netText: '1,00', netTouched: true }, 2, ctx);
    expect(s).toMatchObject({ storeId: 2, fxText: '5,4', netText: '', netTouched: false });
    expect(applySaleStore(s, 1, ctx).fxText).toBe('');
  });
});

describe('referência do preço mínimo', () => {
  const minPrices = [
    { storeId: 1, storeName: 'CSFloat', currency: 'USD' as const, minPriceCents: 103, approx: null, warning: null, warningCode: null },
    { storeId: 3, storeName: 'CSMoney', currency: 'USD' as const, minPriceCents: null, approx: null, warning: 'x', warningCode: 'FEES_NOT_CONFIGURED' as const },
  ];
  const item = makeItem({ minPrices });

  test('com preço, com aviso, loja inativa e sem lista', () => {
    expect(referenceFor(item, store(1))).toMatchObject({ kind: 'price' });
    expect(referenceFor(item, store(3))).toEqual({ kind: 'warning', warningCode: 'FEES_NOT_CONFIGURED', warning: 'x' });
    expect(referenceFor(item, store(4))).toEqual({ kind: 'inactive' });
    expect(referenceFor(makeItem({ minPrices: null }), store(1))).toEqual({ kind: 'none' });
    expect(referenceFor(item, undefined)).toEqual({ kind: 'none' });
  });
});

describe('corpo da venda', () => {
  const base = { ...initialSellState(ctx, NOW), priceText: '1,25' };

  test('loja com taxa: líquido calculado não vai; só se o usuário mudar', () => {
    const untouched = buildSellBody({ ...base, netText: '1,22' }, ctx, 122);
    expect(untouched.ok && 'netReceivedCents' in untouched.body).toBe(false);
    const sameButTouched = buildSellBody({ ...base, netText: '1,22', netTouched: true }, ctx, 122);
    expect(sameButTouched.ok && 'netReceivedCents' in sameButTouched.body).toBe(false);
    const changed = buildSellBody({ ...base, netText: '1,20', netTouched: true }, ctx, 122);
    expect(changed.ok && changed.body.netReceivedCents).toBe(120);
  });

  test('Recalcular devolve ao calculado', () => {
    const touched = { ...base, netText: '1,00', netTouched: true };
    expect(recalculate(touched, 122, 'pt-BR')).toMatchObject({ netText: '1,22', netTouched: false });
    expect(recalculate(touched, null, 'pt-BR')).toMatchObject({ netText: '', netTouched: false });
    expect(netTextFromQuote(122, 'en')).toBe('1.22');
  });

  test('loja sem taxa: o líquido sempre vai quando preenchido; vazio fica de fora (backend responde no campo)', () => {
    const withNet = buildSellBody({ ...base, storeId: 3, netText: '1,10' }, ctx, null);
    expect(withNet.ok && withNet.body).toMatchObject({ saleStoreId: 3, salePriceCents: 125, netReceivedCents: 110 });
    const without = buildSellBody({ ...base, storeId: 3 }, ctx, null);
    expect(without.ok && 'netReceivedCents' in without.body).toBe(false);
  });

  test('cotação só em loja BRL', () => {
    const steam = buildSellBody({ ...base, storeId: 2, fxText: '5,40' }, ctx, null);
    expect(steam.ok && steam.body.fxRateAtSale).toBe(5.4);
    const usd = buildSellBody({ ...base, fxText: '5,40' }, ctx, null);
    expect(usd.ok && 'fxRateAtSale' in usd.body).toBe(false);
  });

  test('validações locais', () => {
    expect(buildSellBody({ ...base, priceText: '' }, ctx, null)).toEqual({ ok: false, errors: { salePriceCents: 'sellForm.priceRequired' } });
    expect(buildSellBody({ ...base, priceText: '0' }, ctx, null)).toEqual({ ok: false, errors: { salePriceCents: 'itemForm.invalidMoney' } });
    expect(buildSellBody({ ...base, soldAt: '' }, ctx, null)).toEqual({ ok: false, errors: { soldAt: 'itemForm.invalidDate' } });
    expect(buildSellBody({ ...base, netText: 'abc' }, ctx, null)).toEqual({ ok: false, errors: { netReceivedCents: 'itemForm.invalidMoney' } });
    expect(buildSellBody({ ...base, storeId: null }, ctx, null)).toEqual({ ok: false, errors: { saleStoreId: 'sellForm.chooseStore' } });
  });

  test('data enviada em ISO com offset', () => {
    const r = buildSellBody(base, ctx, null);
    expect(r.ok && r.body.soldAt).toMatch(/^2026-11-20T12:00:00[+-]\d{2}:\d{2}$/);
  });
});

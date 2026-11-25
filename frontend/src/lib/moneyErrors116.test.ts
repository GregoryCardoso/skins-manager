import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';
import ptBR from '@/i18n/pt-BR.json';
import { translate } from '@/i18n/translate';
import { invalidMoneyKey, moneyErrorParams } from './currencies';
import { buildCreateBody, initialCreateState } from './itemForm';
import { buildSellBody } from './sellForm';
import type { Store } from '@/types/api';

// 11.6 (seção 14): mensagem de valor inválido por moeda da loja (JPY, KRW e CLP não têm centavos).
const store = (id: number, currency: string): Store => ({ id, name: `Loja ${currency}`, currency, isActive: true } as unknown as Store);

describe('invalidMoneyKey', () => {
  test.each(['JPY', 'KRW', 'CLP'])('%s usa a mensagem de número inteiro', (c) => {
    expect(invalidMoneyKey(c)).toBe('itemForm.invalidMoneyWhole');
  });
  test.each(['USD', 'BRL', 'EUR', 'ARS', undefined])('%s usa a mensagem com centavos', (c) => {
    expect(invalidMoneyKey(c)).toBe('itemForm.invalidMoney');
  });
});

describe('moneyErrorParams', () => {
  test('exemplo no formato do idioma', () => {
    expect(moneyErrorParams('pt-BR', 'USD').example).toBe('1,25');
    expect(moneyErrorParams('en', 'BRL').example).toBe('1.25');
    expect(moneyErrorParams('en', 'JPY')).toEqual({ example: '1500', currency: 'JPY' });
  });
  test('textos finais', () => {
    expect(translate(ptBR, 'itemForm.invalidMoney', moneyErrorParams('pt-BR', 'BRL'))).toBe('Valor inválido. Use um formato como 1,25.');
    expect(translate(en, 'itemForm.invalidMoneyWhole', moneyErrorParams('en', 'KRW'))).toBe('Invalid amount. KRW has no decimal places: use a whole number, like 1500.');
  });
});

describe('formulários escolhem a chave pela moeda da loja', () => {
  test('venda em loja JPY e em loja USD', () => {
    const base = { storeId: 1, priceText: 'abc', netText: '', fxText: '', soldAt: '2026-11-25T10:00', netTouched: false };
    const ctx = { stores: [store(1, 'JPY'), store(2, 'USD')], usdBrlRate: null, language: 'en' } as never;
    const jpy = buildSellBody(base as never, ctx, null);
    expect(jpy.ok).toBe(false);
    if (!jpy.ok) expect(jpy.errors.salePriceCents).toBe('itemForm.invalidMoneyWhole');
    const usd = buildSellBody({ ...base, storeId: 2 } as never, ctx, null);
    if (!usd.ok) expect(usd.errors.salePriceCents).toBe('itemForm.invalidMoney');
  });

  test('cadastro em loja KRW', () => {
    const ctx = { stores: [store(1, 'KRW')], usdBrlRate: null, language: 'en' } as never;
    const state = { ...initialCreateState(ctx), purchaseStoreId: 1, priceText: '1,5x', acquisitionType: 'COMPRA' } as never;
    const r = buildCreateBody(state, ctx);
    if (!r.ok) expect(r.errors.purchasePriceCents).toBe('itemForm.invalidMoneyWhole');
  });
});

import { describe, expect, test } from 'vitest';
import { revealFor } from './formErrors';
import { emptyComponentsState, newStickerDraft, type ComponentsState } from './itemComponents';
import {
  buildCreateBody, fieldVisibility, initialCreateState, isDirty, isGeneratedUnit, setAcquisitionType, stateFromItem, type FormContext,
} from './itemForm';
import { makeItem, STORES } from './testFixtures';
import type { ItemView } from '@/types/api';

const ctx: FormContext = { stores: STORES, usdBrlRate: 5, rates: { BRL: 5 }, language: 'en', now: new Date('2026-11-20T12:00:00.000Z') };

describe('fieldVisibility no item ganho (12.6a)', () => {
  test('Compra: data de compra, loja obrigatória no corpo principal', () => {
    const vis = fieldVisibility(initialCreateState(ctx), STORES);
    expect(vis).toMatchObject({ price: true, receivedDateLabel: false, informativeStoreInDetails: false, informativeStore: false });
  });

  test('Ganhei: sem preço, data "recebeu" e loja informativa em "Mais detalhes"', () => {
    const state = setAcquisitionType(initialCreateState(ctx), 'GANHEI');
    expect(fieldVisibility(state, STORES)).toMatchObject({ price: false, fx: false, receivedDateLabel: true, informativeStoreInDetails: true, informativeStore: true });
  });

  test('o corpo do cadastro de um item ganho é o mesmo de antes: sem preço nem cotação, com a loja informativa', () => {
    const state = { ...setAcquisitionType(initialCreateState(ctx), 'GANHEI'), freeMode: true, name: 'X', category: 'OUTRO' as const };
    const built = buildCreateBody(state, ctx);
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.body).toMatchObject({ acquisitionType: 'GANHEI', purchaseStoreId: 1, category: 'OUTRO', name: 'X' });
      expect(built.body).not.toHaveProperty('purchasePriceCents');
      expect(built.body).not.toHaveProperty('fxRateAtPurchase');
    }
  });
});

describe('isGeneratedUnit', () => {
  test('só a unidade nascida de uma operação', () => {
    expect(isGeneratedUnit(undefined)).toBe(false);
    expect(isGeneratedUnit(makeItem())).toBe(false);
    expect(isGeneratedUnit(makeItem({ acquisitionType: 'GERADO' }))).toBe(true);
    expect(isGeneratedUnit(makeItem({ generatedFrom: {} as ItemView['generatedFrom'] }))).toBe(true);
    expect(isGeneratedUnit(makeItem({ detachedFrom: {} as ItemView['detachedFrom'] }))).toBe(true);
  });
});

describe('isDirty', () => {
  const item = makeItem({ floatValue: 0.123456789012 });
  const clean = () => stateFromItem(item, 'en');

  test('cadastro nunca é "sujo" (não há operação para proteger)', () => {
    expect(isDirty(initialCreateState(ctx), undefined, null, ctx)).toBe(false);
  });

  test('item recém-aberto não tem alteração, mesmo com float longo', () => {
    expect(isDirty(clean(), item, emptyComponentsState(), ctx)).toBe(false);
    expect(isDirty(clean(), item, null, ctx)).toBe(false);
  });

  test('mudar um campo, ou digitar texto inválido, conta como alteração', () => {
    expect(isDirty({ ...clean(), inspectLink: 'steam://x' }, item, null, ctx)).toBe(true);
    expect(isDirty({ ...clean(), floatText: 'abc' }, item, null, ctx)).toBe(true);
    expect(isDirty({ ...clean(), originDetail: 'Mimo' }, item, null, ctx)).toBe(true);
  });

  test('uma linha de sticker nova (mesmo sem item escolhido) é alteração; sem painel os componentes são ignorados', () => {
    const withRow: ComponentsState = { ...emptyComponentsState(), stickers: [newStickerDraft()] };
    expect(isDirty(clean(), item, withRow, ctx)).toBe(true);
    expect(isDirty(clean(), item, null, ctx)).toBe(false);
  });
});

describe('revealFor', () => {
  test('origem e ID do ativo ficam em "Mais detalhes"; a loja só no item ganho', () => {
    expect(revealFor('originDetail')).toBe('details');
    expect(revealFor('assetId')).toBe('details');
    expect(revealFor('purchaseStoreId')).toBeNull();
    expect(revealFor('purchaseStoreId', { informativeStoreInDetails: true })).toBe('details');
  });

  test('os outros campos já estão à vista', () => {
    for (const field of ['catalogId', 'floatValue', 'purchasePriceCents', 'acquiredAt', 'components']) expect(revealFor(field, { informativeStoreInDetails: true })).toBeNull();
  });
});

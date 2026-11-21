import { describe, expect, test } from 'vitest';
import {
  applyCatalogChoice, applyPurchaseStore, buildCreateBody, buildPatchBody, fieldVisibility, initialCreateState,
  stateFromItem, variantOptions, setAcquiredAt, setAcquisitionType, setTradeUnlockAt, addSevenDays,
  type CatalogChoice, type FormContext,
} from './itemForm';
import { STORES, makeItem } from './testFixtures';

const ctx: FormContext = { stores: STORES, usdBrlRate: 5.4, language: 'pt-BR', now: new Date(2026, 10, 20, 12, 0) };

const AK: CatalogChoice = {
  id: 'skin-ak-redline', name: 'AK-47 | Redline', namePtBr: null, imageUrl: null, minFloat: 0.1, maxFloat: 0.7,
  hasStattrak: true, hasSouvenir: false, phase: null, category: 'SKIN',
};
const DOPPLER: CatalogChoice = { ...AK, id: 'skin-karambit-doppler-p2', category: 'FACA', phase: 'Phase 2', hasStattrak: true };
const CASE: CatalogChoice = { ...AK, id: 'crate-revolver', category: 'CAIXA', minFloat: null, maxFloat: null, hasStattrak: false };

function created(choice: CatalogChoice, mutate: (s: ReturnType<typeof initialCreateState>) => void = () => {}) {
  const state = applyCatalogChoice(initialCreateState(ctx), choice);
  mutate(state);
  return buildCreateBody(state, ctx);
}

describe('estado inicial', () => {
  test('COMPRA, loja principal e data de compra agora; trade lock = compra + 7 dias (D161)', () => {
    const s = initialCreateState(ctx);
    expect(s).toMatchObject({
      acquisitionType: 'COMPRA', purchaseStoreId: 1, tradeUnlockAt: '2026-11-27T12:00', tradeUnlockAuto: true,
      acquiredAt: '2026-11-20T12:00', fxText: '',
    });
  });
});

describe('fim do trade lock automático (D161)', () => {
  const base = () => initialCreateState(ctx);

  test('GANHEI vem sem trade lock; COMPRA com compra + 7 dias, e volta a acompanhar o tipo', () => {
    const ganhei = setAcquisitionType(base(), 'GANHEI');
    expect(ganhei).toMatchObject({ acquisitionType: 'GANHEI', tradeUnlockAt: '', tradeUnlockAuto: true });
    expect(setAcquisitionType(ganhei, 'COMPRA')).toMatchObject({ tradeUnlockAt: '2026-11-27T12:00', tradeUnlockAuto: true });
  });

  test('trocar a data de compra recalcula a sugestão (COMPRA) e não preenche em GANHEI', () => {
    expect(setAcquiredAt(base(), '2026-11-10T08:30')).toMatchObject({ acquiredAt: '2026-11-10T08:30', tradeUnlockAt: '2026-11-17T08:30', tradeUnlockAuto: true });
    const ganhei = setAcquisitionType(base(), 'GANHEI');
    expect(setAcquiredAt(ganhei, '2026-11-10T08:30').tradeUnlockAt).toBe('');
  });

  test('data de compra apagada ou inválida deixa a sugestão vazia sem desligar o automático', () => {
    expect(setAcquiredAt(base(), '')).toMatchObject({ tradeUnlockAt: '', tradeUnlockAuto: true });
    expect(setAcquiredAt(base(), '2026-02-30T10:00')).toMatchObject({ tradeUnlockAt: '', tradeUnlockAuto: true });
  });

  test('digitar ou limpar o campo desliga o automático: tipo e data de compra não o alteram mais', () => {
    const typed = setTradeUnlockAt(base(), '2026-12-01T10:00');
    expect(typed).toMatchObject({ tradeUnlockAt: '2026-12-01T10:00', tradeUnlockAuto: false });
    expect(setAcquisitionType(typed, 'GANHEI').tradeUnlockAt).toBe('2026-12-01T10:00');
    expect(setAcquiredAt(typed, '2026-11-01T10:00').tradeUnlockAt).toBe('2026-12-01T10:00');
    const cleared = setTradeUnlockAt(base(), '');
    expect(cleared).toMatchObject({ tradeUnlockAt: '', tradeUnlockAuto: false });
    expect(setAcquiredAt(cleared, '2026-11-01T10:00').tradeUnlockAt).toBe('');
    expect(setAcquisitionType(cleared, 'GANHEI').tradeUnlockAt).toBe('');
    expect(setAcquisitionType(setAcquisitionType(cleared, 'GANHEI'), 'COMPRA').tradeUnlockAt).toBe('');
  });

  test('botão "+7 dias" preenche e desliga o automático', () => {
    const s = addSevenDays(setAcquiredAt(base(), '2026-11-10T08:30'), ctx.now);
    expect(s).toMatchObject({ tradeUnlockAt: '2026-11-17T08:30', tradeUnlockAuto: false });
    expect(setAcquiredAt(s, '2026-11-01T08:30').tradeUnlockAt).toBe('2026-11-17T08:30');
  });

  test('edição de item existente não sugere nada', () => {
    const item = makeItem({ tradeUnlockAt: null, acquisitionType: 'GANHEI' });
    const s = stateFromItem(item, 'pt-BR');
    expect(s).toMatchObject({ tradeUnlockAt: '', tradeUnlockAuto: false });
    expect(setAcquisitionType(s, 'COMPRA').tradeUnlockAt).toBe('');
    expect(setAcquiredAt(s, '2026-11-01T10:00').tradeUnlockAt).toBe('');
    const locked = stateFromItem(makeItem({ tradeUnlockAt: '2026-11-25T12:00:00.000Z' }), 'pt-BR');
    expect(locked.tradeUnlockAuto).toBe(false);
    expect(setAcquisitionType(locked, 'GANHEI').tradeUnlockAt).toBe(locked.tradeUnlockAt);
  });

  test('corpo: a sugestão automática de COMPRA é enviada; GANHEI e campo vazio não enviam tradeUnlockAt', () => {
    const compra = applyCatalogChoice(base(), AK);
    const r = buildCreateBody({ ...compra, priceText: '1' }, ctx);
    expect(r.ok && r.body.tradeUnlockAt).toMatch(/^2026-11-27T12:00:00[+-]\d{2}:\d{2}$/);
    const ganhei = setAcquisitionType(applyCatalogChoice(base(), AK), 'GANHEI');
    const g = buildCreateBody(ganhei, ctx);
    expect(g.ok && 'tradeUnlockAt' in g.body).toBe(false);
    const cleared = setTradeUnlockAt({ ...compra, priceText: '1' }, '');
    const c = buildCreateBody(cleared, ctx);
    expect(c.ok && 'tradeUnlockAt' in c.body).toBe(false);
  });
});

describe('cadastro com catálogo', () => {
  test('envia catalogId sem name nem category', () => {
    const r = created(AK, (s) => { s.priceText = '1,25'; });
    expect(r.ok && r.body).toMatchObject({ catalogId: 'skin-ak-redline', acquisitionType: 'COMPRA', purchaseStoreId: 1, purchasePriceCents: 125, variant: 'NORMAL' });
    expect(r.ok && 'name' in r.body).toBe(false);
    expect(r.ok && 'category' in r.body).toBe(false);
  });

  test('fase travada pelo catálogo não é enviada; fase livre é', () => {
    const locked = created(DOPPLER, (s) => { s.priceText = '10'; s.phase = 'Phase 2'; });
    expect(locked.ok && 'phase' in locked.body).toBe(false);
    const free = created(AK, (s) => { s.priceText = '10'; s.phase = ' Ruby '; });
    expect(free.ok && free.body.phase).toBe('Ruby');
  });

  test('categoria sem arma não envia atributos de arma', () => {
    const r = created(CASE, (s) => { s.priceText = '2'; s.floatText = '0,1'; s.paintSeedText = '5'; s.variant = 'NORMAL'; });
    expect(r.ok).toBe(true);
    if (r.ok) for (const key of ['variant', 'floatValue', 'exterior', 'paintSeed', 'phase']) expect(key in r.body).toBe(false);
  });

  test('float no formato do idioma; com float o exterior manual não vai', () => {
    const r = created(AK, (s) => { s.priceText = '1'; s.floatText = '0,2345'; s.exterior = 'FN'; });
    expect(r.ok && r.body.floatValue).toBe(0.2345);
    expect(r.ok && 'exterior' in r.body).toBe(false);
    const manual = created(AK, (s) => { s.priceText = '1'; s.exterior = 'WW'; });
    expect(manual.ok && manual.body.exterior).toBe('WW');
  });

  test('GANHEI nunca envia preço nem cotação; loja é só informativa', () => {
    const r = created(AK, (s) => { s.acquisitionType = 'GANHEI'; s.priceText = '5'; s.fxText = '5,4'; s.purchaseStoreId = 2; });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect('purchasePriceCents' in r.body).toBe(false);
      expect('fxRateAtPurchase' in r.body).toBe(false);
      expect(r.body.purchaseStoreId).toBe(2);
    }
  });

  test('COMPRA em loja BRL envia a cotação; em USD não', () => {
    const brl = created(AK, (s) => { s.purchaseStoreId = 2; s.priceText = '10'; s.fxText = '5,40'; });
    expect(brl.ok && brl.body.fxRateAtPurchase).toBe(5.4);
    const usd = created(AK, (s) => { s.priceText = '10'; s.fxText = '5,40'; });
    expect(usd.ok && 'fxRateAtPurchase' in usd.body).toBe(false);
  });

  test('textos inválidos viram erro por campo, sem corpo', () => {
    const r = created(AK, (s) => { s.priceText = 'abc'; s.floatText = 'x'; s.paintSeedText = '1,5'; });
    expect(r).toEqual({
      ok: false,
      errors: { floatValue: 'itemForm.invalidNumber', paintSeed: 'itemForm.invalidNumber', purchasePriceCents: 'itemForm.invalidMoney' },
    });
  });

  test('item fora do catálogo envia categoria e nome', () => {
    const state = { ...initialCreateState(ctx), freeMode: true, category: 'OUTRO' as const, name: ' Caixa misteriosa ', priceText: '3' };
    const r = buildCreateBody(state, ctx);
    expect(r.ok && r.body).toMatchObject({ category: 'OUTRO', name: 'Caixa misteriosa' });
    expect(r.ok && 'catalogId' in r.body).toBe(false);
  });

  test('textos opcionais vazios e datas', () => {
    const r = created(AK, (s) => { s.priceText = '1'; s.inspectLink = '  steam://x '; s.tradeUnlockAt = '2026-11-27T12:00'; });
    expect(r.ok && r.body.inspectLink).toBe('steam://x');
    expect(r.ok && r.body.tradeUnlockAt).toMatch(/^2026-11-27T12:00:00[+-]\d{2}:\d{2}$/);
    expect(r.ok && r.body.acquiredAt).toMatch(/^2026-11-20T12:00:00[+-]\d{2}:\d{2}$/);
    expect(r.ok && 'originDetail' in r.body).toBe(false);
  });
});

describe('troca de item do catálogo (T68)', () => {
  const FADE: CatalogChoice = { ...DOPPLER, id: 'skin-karambit-fade', phase: null };

  test('Doppler Phase 2 -> Fade limpa a fase e o cadastro não envia fase', () => {
    const s = applyCatalogChoice(applyCatalogChoice(initialCreateState(ctx), DOPPLER), FADE);
    expect(s.phase).toBe('');
    const r = buildCreateBody({ ...s, priceText: '10' }, ctx);
    expect(r.ok && 'phase' in r.body).toBe(false);
  });

  test('fase livre digitada some ao trocar de item e fica ao reescolher o mesmo', () => {
    const typed = { ...applyCatalogChoice(initialCreateState(ctx), FADE), phase: 'Ruby' };
    expect(applyCatalogChoice(typed, FADE).phase).toBe('Ruby');
    expect(applyCatalogChoice(typed, AK).phase).toBe('');
  });
});

describe('troca de loja de compra', () => {
  test('mudar de moeda limpa o preço e pré-preenche a cotação em BRL', () => {
    let s = applyCatalogChoice(initialCreateState(ctx), AK);
    s.priceText = '10';
    s = applyPurchaseStore(s, 2, ctx);
    expect(s).toMatchObject({ purchaseStoreId: 2, priceText: '', fxText: '5,4' });
    s = applyPurchaseStore({ ...s, priceText: '50' }, 1, ctx);
    expect(s).toMatchObject({ purchaseStoreId: 1, priceText: '', fxText: '' });
  });

  test('mesma moeda mantém o preço', () => {
    const s = applyPurchaseStore({ ...initialCreateState(ctx), priceText: '10' }, 3, ctx);
    expect(s.priceText).toBe('10');
  });
});

describe('visibilidade e opções', () => {
  test('arma x não arma, exterior só sem float, cotação só em BRL', () => {
    const s = applyCatalogChoice(initialCreateState(ctx), AK);
    expect(fieldVisibility(s, STORES)).toMatchObject({ weapon: true, exteriorInput: true, exteriorDerived: false, fx: false, price: true });
    expect(fieldVisibility({ ...s, floatText: '0,2' }, STORES)).toMatchObject({ exteriorInput: false, exteriorDerived: true });
    expect(fieldVisibility({ ...s, purchaseStoreId: 2 }, STORES).fx).toBe(true);
    expect(fieldVisibility({ ...s, acquisitionType: 'GANHEI', purchaseStoreId: 2 }, STORES)).toMatchObject({ price: false, fx: false, informativeStore: true });
    expect(fieldVisibility(applyCatalogChoice(initialCreateState(ctx), CASE), STORES).weapon).toBe(false);
  });

  test('opções de variante por categoria e catálogo, mantendo o valor atual', () => {
    expect(variantOptions('LUVA', null, '')).toEqual(['NORMAL']);
    expect(variantOptions('FACA', null, '')).toEqual(['NORMAL', 'STATTRAK']);
    expect(variantOptions('SKIN', null, '')).toEqual(['NORMAL', 'STATTRAK', 'SOUVENIR']);
    expect(variantOptions('SKIN', { ...AK, hasStattrak: false, hasSouvenir: false }, '')).toEqual(['NORMAL']);
    expect(variantOptions('SKIN', AK, 'SOUVENIR')).toEqual(['NORMAL', 'STATTRAK', 'SOUVENIR']);
  });
});

describe('edição (PATCH só com o que mudou)', () => {
  const item = makeItem();
  const edit = (mutate: (s: ReturnType<typeof stateFromItem>) => void, base = item) => {
    const s = stateFromItem(base, 'pt-BR');
    mutate(s);
    return buildPatchBody(s, base, ctx);
  };

  test('sem mudanças -> corpo vazio', () => {
    expect(edit(() => {})).toEqual({ ok: true, body: {} });
  });

  test('só os campos alterados', () => {
    const r = edit((s) => { s.priceText = '2,50'; s.originDetail = 'Troca'; });
    expect(r).toEqual({ ok: true, body: { purchasePriceCents: 250, originDetail: 'Troca' } });
  });

  test('limpar texto opcional manda null; limpar float manda null e mantém o exterior', () => {
    const withLink = makeItem({ inspectLink: 'steam://x' });
    expect(edit((s) => { s.inspectLink = ' '; }, withLink)).toEqual({ ok: true, body: { inspectLink: null } });
    const r = edit((s) => { s.floatText = ''; });
    expect(r).toEqual({ ok: true, body: { floatValue: null, exterior: 'FT' } });
  });

  test('float alterado -> envia só o float (exterior é derivado)', () => {
    const r = edit((s) => { s.floatText = '0,3'; });
    expect(r).toEqual({ ok: true, body: { floatValue: 0.3 } });
  });

  test('COMPRA -> GANHEI envia só o tipo; GANHEI -> COMPRA exige preço e leva a loja gravada', () => {
    expect(edit((s) => { s.acquisitionType = 'GANHEI'; })).toEqual({ ok: true, body: { acquisitionType: 'GANHEI' } });
    const won = makeItem({ acquisitionType: 'GANHEI', purchasePriceCents: 0, purchaseStoreId: 3 });
    const r = edit((s) => { s.acquisitionType = 'COMPRA'; s.priceText = '4'; }, won);
    expect(r).toEqual({ ok: true, body: { acquisitionType: 'COMPRA', purchaseStoreId: 3, purchasePriceCents: 400 } });
  });

  test('datas só vão se mudarem; trade lock limpo manda null', () => {
    const locked = makeItem({ tradeUnlockAt: '2026-11-25T12:00:00.000Z' });
    expect(edit(() => {}, locked)).toEqual({ ok: true, body: {} });
    expect(edit((s) => { s.tradeUnlockAt = ''; }, locked)).toEqual({ ok: true, body: { tradeUnlockAt: null } });
  });

  test('trocar o item do catálogo envia catalogId; fase travada nunca vai', () => {
    const r = edit((s) => Object.assign(s, applyCatalogChoice(s, DOPPLER)));
    expect(r.ok && r.body.catalogId).toBe('skin-karambit-doppler-p2');
    expect(r.ok && 'phase' in r.body).toBe(false);
  });

  test('T68: trocar Doppler (fase travada) por Fade limpa a fase na edição', () => {
    const FADE: CatalogChoice = { ...DOPPLER, id: 'skin-karambit-fade', phase: null };
    const doppler = makeItem({ catalogId: DOPPLER.id, category: 'FACA', phase: 'Phase 2' });
    const r = edit((s) => Object.assign(s, applyCatalogChoice(s, FADE)), doppler);
    expect(r.ok && r.body.catalogId).toBe('skin-karambit-fade');
    expect(r.ok && r.body.phase).toBeNull();
  });

  test('item legado fica intacto sem escolher catálogo; vincular envia catalogId', () => {
    const legacy = makeItem({ catalogId: null, catalog: null, isLegacy: true });
    expect(edit(() => {}, legacy)).toEqual({ ok: true, body: {} });
    const r = edit((s) => Object.assign(s, applyCatalogChoice(s, AK)), legacy);
    expect(r.ok && r.body.catalogId).toBe('skin-ak-redline');
  });

  test('item fora do catálogo: nome e categoria alterados', () => {
    const free = makeItem({ catalogId: null, catalog: null, category: 'OUTRO', name: 'Caixa', variant: null, floatValue: null, exterior: null });
    const r = edit((s) => { s.name = 'Caixa 2'; }, free);
    expect(r).toEqual({ ok: true, body: { name: 'Caixa 2' } });
  });

  test('troca para loja de outra moeda sem preço novo não envia preço (o backend recusa no campo)', () => {
    const r = edit((s) => Object.assign(s, applyPurchaseStore(s, 2, ctx)));
    expect(r.ok && r.body).toMatchObject({ purchaseStoreId: 2 });
    expect(r.ok && 'purchasePriceCents' in r.body).toBe(false);
  });
});

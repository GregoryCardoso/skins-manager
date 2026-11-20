// QA da 4B.3: bordas das libs puras (itemForm, sellForm, formErrors, dateInput, numberInput).
import { describe, expect, test } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { localInputToDate, localInputToIso, isoToLocalInput, addDaysToLocalInput } from './dateInput';
import { formatFloat } from './format';
import { resolveErrorTarget } from './formErrors';
import {
  applyCatalogChoice, applyPurchaseStore, buildCreateBody, buildPatchBody, fieldVisibility, initialCreateState,
  stateFromItem, type CatalogChoice, type FormContext,
} from './itemForm';
import { formatCentsInput, parseDecimalInput, parseFloatInput, parseIntegerInput, parseMoneyToCents } from './numberInput';
import { applySaleStore, buildSellBody, initialSellState, type SellContext } from './sellForm';
import { STORES, makeItem } from './testFixtures';

const ctx: FormContext = { stores: STORES, usdBrlRate: 5.4, language: 'pt-BR', now: new Date(2026, 10, 20, 12, 0) };
const sctx: SellContext = { stores: STORES, usdBrlRate: 5.4, language: 'pt-BR' };

const AK: CatalogChoice = {
  id: 'skin-ak-redline', name: 'AK-47 | Redline', namePtBr: null, imageUrl: null, minFloat: 0.1, maxFloat: 0.7,
  hasStattrak: true, hasSouvenir: false, phase: null, category: 'SKIN',
};

const edit = (mutate: (s: ReturnType<typeof stateFromItem>) => void, item = makeItem(), language = 'pt-BR') => {
  const s = stateFromItem(item, language);
  mutate(s);
  return buildPatchBody(s, item, { ...ctx, language });
};

describe('PATCH só com campos alterados: bordas', () => {
  test('float com muitas casas faz ida e volta sem acusar alteração (pt-BR e en)', () => {
    const item = makeItem({ floatValue: 0.07234567890123456 });
    expect(edit(() => {}, item)).toEqual({ ok: true, body: {} });
    expect(edit(() => {}, item, 'en')).toEqual({ ok: true, body: {} });
    for (const v of [0, 1, 0.00000012, 0.1 + 0.2, 0.9999999999999999, 1e-7]) {
      expect(parseFloatInput(formatFloat(v, 'pt-BR'), 'pt-BR')).toBe(v);
      expect(parseFloatInput(formatFloat(v, 'en'), 'en')).toBe(v);
    }
  });

  test('preço com texto diferente do inicial (1 x 1,00) é enviado mesmo com valor igual (comportamento atual, inofensivo)', () => {
    expect(edit((s) => { s.priceText = '1'; })).toEqual({ ok: true, body: { purchasePriceCents: 100 } });
  });

  test('espaços nos textos opcionais não geram PATCH quando o valor gravado é o mesmo', () => {
    const item = makeItem({ originDetail: 'drop' });
    expect(edit((s) => { s.originDetail = '  drop  '; }, item)).toEqual({ ok: true, body: {} });
  });

  test('item vendido: edição não gera campos de venda', () => {
    const sold = makeItem({
      status: 'VENDIDO', saleStoreId: 1, salePriceCents: 125, saleCurrency: 'USD', netReceivedCents: 122,
      soldAt: '2026-11-18T12:00:00.000Z',
    });
    expect(edit(() => {}, sold)).toEqual({ ok: true, body: {} });
    const r = edit((s) => { s.originDetail = 'x'; }, sold);
    expect(r).toEqual({ ok: true, body: { originDetail: 'x' } });
  });

  test('mudar só a loja dentro da mesma moeda envia só purchaseStoreId', () => {
    const item = makeItem();
    const r = edit((s) => Object.assign(s, applyPurchaseStore(s, 4, ctx)), item);
    expect(r).toEqual({ ok: true, body: { purchaseStoreId: 4 } });
  });

  test('COMPRA em BRL: trocar só a cotação envia só a cotação', () => {
    const brl = makeItem({ purchaseStoreId: 2, purchaseCurrency: 'BRL', purchasePriceCents: 500, fxRateAtPurchase: 5.4 });
    expect(edit(() => {}, brl)).toEqual({ ok: true, body: {} });
    expect(edit((s) => { s.fxText = '5,5'; }, brl)).toEqual({ ok: true, body: { fxRateAtPurchase: 5.5 } });
  });

  test('número inválido no PATCH bloqueia com erro no campo e sem corpo', () => {
    expect(edit((s) => { s.priceText = '1,234'; })).toEqual({ ok: false, errors: { purchasePriceCents: 'itemForm.invalidMoney' } });
    expect(edit((s) => { s.floatText = 'abc'; })).toEqual({ ok: false, errors: { floatValue: 'itemForm.invalidNumber' } });
    expect(edit((s) => { s.paintSeedText = '-1'; })).toEqual({ ok: false, errors: { paintSeed: 'itemForm.invalidNumber' } });
    expect(edit((s) => { s.acquiredAt = '2026-02-30T10:00'; })).toEqual({ ok: false, errors: { acquiredAt: 'itemForm.invalidDate' } });
  });
});

describe('GANHEI: sem preço e sem cotação (create e PATCH)', () => {
  test('create GANHEI em loja BRL com textos residuais de preço e cotação: nada disso vai', () => {
    const state = applyCatalogChoice(initialCreateState(ctx), AK);
    Object.assign(state, applyPurchaseStore(state, 2, ctx), { acquisitionType: 'GANHEI', priceText: '9,99' });
    expect(state.fxText).not.toBe('');
    const r = buildCreateBody(state, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.acquisitionType).toBe('GANHEI');
      expect('purchasePriceCents' in r.body).toBe(false);
      expect('fxRateAtPurchase' in r.body).toBe(false);
    }
  });

  test('create GANHEI com preço inválido residual não bloqueia (campo oculto)', () => {
    const state = applyCatalogChoice(initialCreateState(ctx), AK);
    Object.assign(state, { acquisitionType: 'GANHEI', priceText: 'abc', fxText: 'xyz' });
    expect(buildCreateBody(state, ctx).ok).toBe(true);
  });

  test('GANHEI sem loja: nenhum purchaseStoreId', () => {
    const state = applyCatalogChoice(initialCreateState(ctx), AK);
    Object.assign(state, { acquisitionType: 'GANHEI', purchaseStoreId: null });
    const r = buildCreateBody(state, ctx);
    expect(r.ok && 'purchaseStoreId' in r.body).toBe(false);
  });

  test('PATCH de GANHEI nunca envia preço nem cotação, mesmo com texto residual', () => {
    const won = makeItem({ acquisitionType: 'GANHEI', purchasePriceCents: 0, purchaseStoreId: null });
    const r = edit((s) => { s.priceText = '5'; s.fxText = '5,4'; s.originDetail = 'x'; }, won);
    expect(r).toEqual({ ok: true, body: { originDetail: 'x' } });
  });

  test('COMPRA -> GANHEI em loja BRL: só o tipo; sem cotação', () => {
    const brl = makeItem({ purchaseStoreId: 2, purchaseCurrency: 'BRL', purchasePriceCents: 500, fxRateAtPurchase: 5.4 });
    expect(edit((s) => { s.acquisitionType = 'GANHEI'; }, brl)).toEqual({ ok: true, body: { acquisitionType: 'GANHEI' } });
  });

  test('GANHEI -> COMPRA em loja BRL: preço e cotação obrigatórios vão juntos', () => {
    const won = makeItem({ acquisitionType: 'GANHEI', purchasePriceCents: 0, purchaseStoreId: 2, fxRateAtPurchase: null, purchaseCurrency: 'BRL' });
    const r = edit((s) => { s.acquisitionType = 'COMPRA'; s.priceText = '10'; s.fxText = '5,4'; }, won);
    expect(r).toEqual({ ok: true, body: { acquisitionType: 'COMPRA', purchaseStoreId: 2, purchasePriceCents: 1000, fxRateAtPurchase: 5.4 } });
  });
});

describe('troca de loja e cotação por moeda', () => {
  test('USD -> BRL -> USD: preço limpo a cada troca de moeda; cotação só em BRL', () => {
    let s = initialCreateState(ctx);
    s.priceText = '1,00';
    s = applyPurchaseStore(s, 2, ctx);
    expect(s).toMatchObject({ purchaseStoreId: 2, priceText: '', fxText: '5,4' });
    s.priceText = '5,00';
    s = applyPurchaseStore(s, 1, ctx);
    expect(s).toMatchObject({ purchaseStoreId: 1, priceText: '', fxText: '' });
  });

  test('BRL -> BRL mantém preço e a cotação editada', () => {
    const brl2: typeof STORES = [...STORES, { id: 9, name: 'Outra BRL', currency: 'BRL', isActive: true, isPrimary: false, saleFeeType: 'DEDUCTED', saleFeesConfigured: true }];
    const c2: FormContext = { ...ctx, stores: brl2 };
    let s = applyPurchaseStore(initialCreateState(c2), 2, c2);
    s.priceText = '7,00';
    s.fxText = '5,9';
    s = applyPurchaseStore(s, 9, c2);
    expect(s).toMatchObject({ priceText: '7,00', fxText: '5,9' });
  });

  test('BRL sem cotação salva: campo vazio; create BRL com cotação vazia não envia cotação (backend responde no campo)', () => {
    const noRate: FormContext = { ...ctx, usdBrlRate: null };
    const s = applyPurchaseStore(initialCreateState(noRate), 2, noRate);
    expect(s.fxText).toBe('');
    Object.assign(s, applyCatalogChoice(s, AK), { priceText: '5' });
    const r = buildCreateBody(s, noRate);
    expect(r.ok && 'fxRateAtPurchase' in r.body).toBe(false);
  });

  test('cotação inválida em loja BRL bloqueia; em loja USD é ignorada', () => {
    const s = applyCatalogChoice(applyPurchaseStore(initialCreateState(ctx), 2, ctx), AK);
    Object.assign(s, { priceText: '5', fxText: '0' });
    expect(buildCreateBody(s, ctx)).toEqual({ ok: false, errors: { fxRateAtPurchase: 'itemForm.invalidNumber' } });
    const usd = applyCatalogChoice(initialCreateState(ctx), AK);
    Object.assign(usd, { priceText: '5', fxText: 'lixo' });
    expect(buildCreateBody(usd, ctx).ok).toBe(true);
    expect(fieldVisibility(usd, STORES).fx).toBe(false);
  });

  test('loja sem id (null) não quebra a troca', () => {
    const s = applyPurchaseStore(initialCreateState(ctx), null, ctx);
    expect(s).toMatchObject({ purchaseStoreId: null, fxText: '' });
  });
});

describe('sellForm: líquido enviado só quando alterado e obrigatório em loja sem taxa', () => {
  const base = { ...initialSellState(sctx, '2026-11-20T12:00'), priceText: '1,25' };

  test('loja com taxa: líquido editado e igual ao calculado não vai; diferente vai; apagado não vai', () => {
    const a = buildSellBody({ ...base, netText: '1,22', netTouched: true }, sctx, 122);
    expect(a.ok && 'netReceivedCents' in a.body).toBe(false);
    const b = buildSellBody({ ...base, netText: '1,21', netTouched: true }, sctx, 122);
    expect(b.ok && b.body.netReceivedCents).toBe(121);
    const c = buildSellBody({ ...base, netText: '', netTouched: true }, sctx, 122);
    expect(c.ok && 'netReceivedCents' in c.body).toBe(false);
  });

  test('loja com taxa sem prévia (erro na prévia): editado manualmente vai; não editado não vai', () => {
    const manual = buildSellBody({ ...base, netText: '1,00', netTouched: true }, sctx, null);
    expect(manual.ok && manual.body.netReceivedCents).toBe(100);
    const auto = buildSellBody({ ...base, netText: '1,00', netTouched: false }, sctx, null);
    expect(auto.ok && 'netReceivedCents' in auto.body).toBe(false);
  });

  test('loja sem taxa: líquido enviado mesmo sem "tocar"; igual ao preço e com ponto no formato en', () => {
    const r = buildSellBody({ ...base, storeId: 3, netText: '1,25' }, sctx, null);
    expect(r.ok && r.body.netReceivedCents).toBe(125);
    const en: SellContext = { ...sctx, language: 'en' };
    const e = buildSellBody({ ...initialSellState(en, '2026-11-20T12:00'), priceText: '1.25', storeId: 3, netText: '1.10' }, en, null);
    expect(e.ok && e.body.netReceivedCents).toBe(110);
  });

  test('loja sem taxa com líquido inválido (0, negativo, 3 casas) bloqueia no campo', () => {
    for (const t of ['0', '-1', '1,234', 'x']) {
      expect(buildSellBody({ ...base, storeId: 3, netText: t }, sctx, null)).toEqual({ ok: false, errors: { netReceivedCents: 'itemForm.invalidMoney' } });
    }
  });

  test('trocar de loja zera líquido e netTouched; cotação só em BRL e limpa em USD', () => {
    let s = { ...base, netText: '1,00', netTouched: true };
    s = applySaleStore(s, 2, sctx);
    expect(s).toMatchObject({ netText: '', netTouched: false, fxText: '5,4' });
    s = applySaleStore(s, 3, sctx);
    expect(s).toMatchObject({ fxText: '', storeId: 3 });
  });

  test('loja BRL: cotação inválida bloqueia; USD ignora cotação residual', () => {
    expect(buildSellBody({ ...base, storeId: 2, fxText: 'abc' }, sctx, null)).toEqual({ ok: false, errors: { fxRateAtSale: 'itemForm.invalidNumber' } });
    const usd = buildSellBody({ ...base, storeId: 1, fxText: 'abc' }, sctx, null);
    expect(usd.ok && 'fxRateAtSale' in usd.body).toBe(false);
  });

  test('preço com 3 casas e valores gigantes não viram centavos', () => {
    expect(buildSellBody({ ...base, priceText: '1,255' }, sctx, null).ok).toBe(false);
    expect(buildSellBody({ ...base, priceText: '99999999999999999999' }, sctx, null).ok).toBe(false);
  });
});

describe('formErrors: bordas', () => {
  const FORM = ['netReceivedCents', 'salePriceCents', 'saleStoreId', 'soldAt'] as const;
  const err = (code: string, extra: { field?: string } = {}) => new ApiRequestError(code, 'm', 400, extra);

  test('NET_RECEIVED_ABOVE_PRICE com e sem field cai em netReceivedCents', () => {
    expect(resolveErrorTarget(err('NET_RECEIVED_ABOVE_PRICE', { field: 'netReceivedCents' }), FORM).target).toBe('netReceivedCents');
    expect(resolveErrorTarget(err('NET_RECEIVED_ABOVE_PRICE'), FORM).target).toBe('netReceivedCents');
  });

  test('FEES_NOT_CONFIGURED com field netReceivedCents (backend atual) vai ao campo do líquido, não da loja', () => {
    expect(resolveErrorTarget(err('FEES_NOT_CONFIGURED', { field: 'netReceivedCents' }), FORM).target).toBe('netReceivedCents');
  });

  test('ITEM_TRADE_LOCKED com soldAt e sem field', () => {
    expect(resolveErrorTarget(err('ITEM_TRADE_LOCKED', { field: 'soldAt' }), FORM).target).toBe('soldAt');
    expect(resolveErrorTarget(err('ITEM_TRADE_LOCKED'), FORM)).toEqual({ target: null, topLabelField: null });
  });

  test('field vazio é tratado como ausente; null/undefined/string não quebram', () => {
    expect(resolveErrorTarget(err('SOLD_AT_IN_FUTURE', { field: '' }), FORM).target).toBe('soldAt');
    for (const v of [null, undefined, 'x', 42, {}]) expect(resolveErrorTarget(v, FORM)).toEqual({ target: null, topLabelField: null });
  });

  test('lista de campos vazia: tudo vai ao topo', () => {
    expect(resolveErrorTarget(err('X', { field: 'soldAt' }), [])).toEqual({ target: null, topLabelField: 'soldAt' });
  });
});

describe('dateInput: bordas', () => {
  test('formatos que o input nunca devolve, mas podem chegar: segundos, espaço, só data', () => {
    expect(localInputToIso('2026-11-20T14:30:15')).toBeNull();
    expect(localInputToIso('2026-11-20 14:30')).toBeNull();
    expect(localInputToIso('2026-11-20')).toBeNull();
    expect(localInputToIso('0050-01-01T10:00')).toBeNull(); // ano < 100 não vira 1950
  });

  test('ano bissexto e limites de hora', () => {
    expect(localInputToDate('2028-02-29T23:59')).not.toBeNull();
    expect(localInputToDate('2027-02-29T10:00')).toBeNull();
    expect(localInputToDate('2026-11-20T24:00')).toBeNull();
    expect(localInputToDate('2026-11-20T10:60')).toBeNull();
  });

  test('espaços nas pontas são aceitos', () => {
    expect(localInputToIso(' 2026-11-20T14:30 ')).toMatch(/^2026-11-20T14:30:00[+-]\d{2}:\d{2}$/);
  });

  test('ISO em UTC na virada do dia vira a data local correta; ISO sem fuso é lido como local pelo Date', () => {
    const iso = new Date(2026, 11, 31, 23, 30).toISOString();
    expect(isoToLocalInput(iso)).toBe('2026-12-31T23:30');
  });

  test('+7 dias atravessa fim de mês, ano e fevereiro bissexto', () => {
    expect(addDaysToLocalInput('2026-11-28T10:00', 7)).toBe('2026-12-05T10:00');
    expect(addDaysToLocalInput('2028-02-25T10:00', 7)).toBe('2028-03-03T10:00');
    expect(addDaysToLocalInput('2027-02-25T10:00', 7)).toBe('2027-03-04T10:00');
  });
});

describe('numberInput: bordas', () => {
  test('dinheiro: espaços, zeros à esquerda, ponto e vírgula juntos, formatos ambíguos', () => {
    expect(parseMoneyToCents(' 1,25 ', 'pt-BR')).toBe(125);
    expect(parseMoneyToCents('007,5', 'pt-BR')).toBe(750);
    expect(parseMoneyToCents('1.234,56', 'pt-BR')).toBe(123456);
    expect(parseMoneyToCents('1,234.56', 'en')).toBe(123456);
    expect(parseMoneyToCents('1,', 'pt-BR')).toBeNull();
    expect(parseMoneyToCents(',5', 'pt-BR')).toBeNull();
    expect(parseMoneyToCents('1e3', 'pt-BR')).toBeNull();
    expect(parseMoneyToCents('+1', 'pt-BR')).toBeNull();
    expect(parseMoneyToCents('-0', 'pt-BR')).toBeNull();
    expect(parseMoneyToCents('', 'pt-BR')).toBeNull();
    expect(parseMoneyToCents('0', 'pt-BR')).toBe(0);
  });

  test('0,10 + float: centavos sem erro de ponto flutuante', () => {
    for (const [t, c] of [['0,07', 7], ['1,15', 115], ['19,99', 1999], ['4,35', 435], ['8,2', 820]] as const) {
      expect(parseMoneyToCents(t, 'pt-BR')).toBe(c);
      expect(parseMoneyToCents(t.replace(',', '.'), 'en')).toBe(c);
    }
  });

  test('formatCentsInput ida e volta em todos os centavos de amostra', () => {
    for (const c of [0, 1, 9, 10, 99, 100, 101, 123456, 9999999999]) {
      expect(parseMoneyToCents(formatCentsInput(c, 'pt-BR'), 'pt-BR')).toBe(c);
      expect(parseMoneyToCents(formatCentsInput(c, 'en'), 'en')).toBe(c);
    }
  });

  test('cotação (decimal) recusa zero, negativo e texto; aceita vírgula e ponto em pt-BR', () => {
    expect(parseDecimalInput('0', 'pt-BR')).toBeNull();
    expect(parseDecimalInput('-5,4', 'pt-BR')).toBeNull();
    expect(parseDecimalInput('5,43', 'pt-BR')).toBe(5.43);
    expect(parseDecimalInput('5.43', 'pt-BR')).toBe(5.43);
    expect(parseDecimalInput('5,43', 'en')).toBe(5.43);
  });

  test('float: zero e 1 aceitos; negativo e notação científica recusados; seed: 0 e 1000 aceitos', () => {
    expect(parseFloatInput('0', 'pt-BR')).toBe(0);
    expect(parseFloatInput('1', 'en')).toBe(1);
    expect(parseFloatInput('-0,1', 'pt-BR')).toBeNull();
    expect(parseFloatInput('1e-3', 'pt-BR')).toBeNull();
    expect(parseIntegerInput('0')).toBe(0);
    expect(parseIntegerInput('1000')).toBe(1000);
    expect(parseIntegerInput('1,5')).toBeNull();
    expect(parseIntegerInput('')).toBeNull();
    expect(parseIntegerInput('99999999999999999999')).toBeNull();
  });
});

'use strict';

// QA 8.6 (D250, D252): bordas adicionais do saldo calculado das lojas (sem saldo inicial, Revisão 23). Funções puras, com `at`/`now` fixos.
const {
  computeStoreBalance, daysSince, buildCheckRecord, buildCurrentBalances,
} = require('../../src/services/storeBalanceService');
const { maxAmountCents, MAX_NOTE_LENGTH } = require('../../src/config/constants');
const MAX_AMOUNT_CENTS = maxAmountCents('USD'); // teto do USD (1e10); o teto por moeda tem testes próprios
const { csfloat, steam, csmoney } = require('../helpers/storeFixtures');

const NOW = new Date('2026-11-22T12:00:00.000Z');
const A = '2026-11-10T12:00:00.000Z';
const RATE = { usdBrlRate: 5 };
const err = (fn) => { try { fn(); } catch (e) { return [e.code, e.field]; } return null; };

// Registro antigo (migrado): conferência sem cálculo nem ajuste.
const legacyOf = (storeId, balanceCents, recordedAt = A, id = 100 + storeId) => ({
  id, storeId, kind: 'CHECK', balanceCents, recordedAt, computedCents: null, adjustmentCents: null,
});
const checkOf = (storeId, recordedAt, adjustmentCents, id = 200) => ({
  id, storeId, kind: 'CHECK', balanceCents: 0, computedCents: 0, adjustmentCents, recordedAt,
});
const sale = (storeId, soldAt, net, days = 7, extra = {}) => ({
  status: 'VENDIDO', saleStoreId: storeId, saleCurrency: 'USD', soldAt, netReceivedCents: net, saleHoldDaysApplied: days,
  acquisitionType: 'GANHEI', purchaseStoreId: null, acquiredAt: '2026-10-01T12:00:00.000Z', purchasePriceCents: 0, purchaseCurrency: 'USD', ...extra,
});
const purchase = (storeId, acquiredAt, cents, extra = {}) => ({
  status: 'EM_ESTOQUE', acquisitionType: 'COMPRA', purchaseStoreId: storeId, purchaseCurrency: 'USD', purchasePriceCents: cents,
  acquiredAt, saleStoreId: null, ...extra,
});
const deposit = (storeId, depositedAt, cents) => ({ storeId, amountStoreCents: cents, depositedAt });
const withdrawal = (storeId, withdrawnAt, cents) => ({ storeId, amountStoreCents: cents, withdrawnAt });

describe('computeStoreBalance: bordas extras', () => {
  const store = csfloat({ id: 1 });
  const run = (extra) => computeStoreBalance({ store, at: NOW, ...extra });

  test('compra na igualdade com `at` entra; compra de outra loja e com loja nula nunca entram', () => {
    const items = [
      purchase(1, NOW.toISOString(), 300),
      purchase(2, '2026-11-12T12:00:00.000Z', 999),
      purchase(null, '2026-11-12T12:00:00.000Z', 999),
    ];
    expect(run({ items }).breakdown.purchasesCents).toBe(300);
    expect(run({ items: [purchase(1, '2026-11-22T12:00:00.001Z', 300)] }).breakdown.purchasesCents).toBe(0); // depois de `at`
  });

  test('GANHEI com loja informativa e custo gravado nunca desconta; GANHEI vendido credita só o líquido na loja da venda', () => {
    const won = purchase(1, '2026-11-12T12:00:00.000Z', 777, { acquisitionType: 'GANHEI' });
    expect(run({ items: [won] }).availableCents).toBe(0);
    const wonSold = sale(1, '2026-11-01T12:00:00.000Z', 400, 7, { purchaseStoreId: 1, purchasePriceCents: 777 });
    const r = run({ items: [wonSold] });
    expect(r.breakdown).toMatchObject({ purchasesCents: 0, salesReleasedCents: 400 });
    expect(r.availableCents).toBe(400);
  });

  test('compra numa loja e venda em outra: cada saldo vê só o seu lado, na moeda da própria loja', () => {
    const steamStore = steam({ id: 2 });
    const item = {
      ...purchase(2, '2026-11-02T12:00:00.000Z', 5000, { purchaseCurrency: 'BRL' }),
      status: 'VENDIDO', saleStoreId: 1, saleCurrency: 'USD', soldAt: '2026-11-05T12:00:00.000Z', netReceivedCents: 1200, saleHoldDaysApplied: 7,
    };
    const onSteam = computeStoreBalance({ store: steamStore, items: [item], at: NOW });
    const onCsf = computeStoreBalance({ store, items: [item], at: NOW });
    expect(onSteam.availableCents).toBe(-5000);
    expect(onSteam.breakdown.salesReleasedCents).toBe(0);
    expect(onCsf.availableCents).toBe(1200);
    expect(onCsf.breakdown.purchasesCents).toBe(0);
    expect(onSteam.ignored).toEqual({ legacyDeposits: 0, currencyMismatch: 0 });
    expect(onCsf.ignored).toEqual({ legacyDeposits: 0, currencyMismatch: 0 });
  });

  test('a mesma venda cai em pendente numa data e em disponível noutra, sem duplicar', () => {
    const items = [sale(1, '2026-11-08T12:00:00.000Z', 700)]; // libera 11-15
    const early = run({ items, at: new Date('2026-11-14T00:00:00.000Z') });
    expect(early.availableCents).toBe(0);
    expect(early.pending).toEqual({ cents: 700, count: 1, nextReleaseAt: '2026-11-15T12:00:00.000Z', lastReleaseAt: '2026-11-15T12:00:00.000Z', releases: [{ releaseAt: '2026-11-15T12:00:00.000Z', cents: 700, count: 1 }] });
    const late = run({ items, at: new Date('2026-11-15T12:00:00.000Z') });
    expect(late.availableCents).toBe(700);
    expect(late.pending).toEqual({ cents: 0, count: 0, nextReleaseAt: null, lastReleaseAt: null, releases: [] });
  });

  test('sem corte por data: venda antiga já liberada e aporte antigo entram', () => {
    const items = [sale(1, '2026-11-01T12:00:00.000Z', 700)]; // libera 11-08
    expect(run({ items }).availableCents).toBe(700);
    expect(run({ items, deposits: [deposit(1, '2020-01-01T00:00:00.000Z', 300)] }).availableCents).toBe(1000);
  });

  test('saque sem loja e de outra loja não entram; saque com valor da loja nulo é ignorado', () => {
    const withdrawals = [
      withdrawal(null, '2026-11-12T12:00:00.000Z', 500),
      withdrawal(2, '2026-11-12T12:00:00.000Z', 500),
      { storeId: 1, amountStoreCents: null, withdrawnAt: '2026-11-12T12:00:00.000Z' },
    ];
    expect(run({ withdrawals }).availableCents).toBe(0);
  });

  test('aporte legado: só conta o da própria loja, de qualquer data (ignored.legacyDeposits)', () => {
    const legacy = (storeId, at) => ({ storeId, amountStoreCents: null, depositedAt: at });
    const r = run({
      deposits: [legacy(1, '2026-10-01T12:00:00.000Z'), legacy(1, '2026-11-12T12:00:00.000Z'), legacy(null, '2026-11-12T12:00:00.000Z'), legacy(2, '2026-11-12T12:00:00.000Z')],
    });
    expect(r.ignored.legacyDeposits).toBe(2);
    expect(r.availableCents).toBe(0);
  });

  test('moeda divergente conta em qualquer data e não entra no cálculo', () => {
    const r = run({
      deposits: [deposit(1, '2026-10-01T12:00:00.000Z', 1000)],
      items: [
        purchase(1, '2026-11-01T12:00:00.000Z', 100, { purchaseCurrency: 'BRL' }),
        sale(1, '2026-11-15T12:00:00.000Z', 900, 0, { saleCurrency: 'BRL' }),
      ],
    });
    expect(r.ignored.currencyMismatch).toBe(2);
    expect(r.availableCents).toBe(1000);
    expect(r.pending.count).toBe(0);
  });

  test('pendente e disponível: saldo negativo com pendente positivo continua negativo (sem compensar)', () => {
    const r = run({ items: [purchase(1, '2026-11-12T12:00:00.000Z', 5000), sale(1, '2026-11-21T12:00:00.000Z', 9000)] });
    expect(r.availableCents).toBe(-5000);
    expect(r.pending.cents).toBe(9000);
  });

  test('item vendido e depois desfeito (status EM_ESTOQUE, sem loja de venda) não gera venda', () => {
    const back = purchase(1, '2026-11-12T12:00:00.000Z', 100, { soldAt: null, netReceivedCents: null, saleHoldDaysApplied: null });
    const r = run({ items: [back] });
    expect(r.pending.count).toBe(0);
    expect(r.availableCents).toBe(-100);
  });

  test('`at` como string ISO e checks de outra loja, de outro kind ou com ajuste nulo não entram', () => {
    const checks = [
      checkOf(2, '2026-11-12T12:00:00.000Z', 50, 1),
      checkOf(1, '2026-11-12T12:00:00.000Z', null, 2),
      { ...legacyOf(1, 0, '2026-11-12T12:00:00.000Z', 3), kind: 'OUTRO', adjustmentCents: 999 },
      checkOf(1, '2026-11-12T12:00:00.000Z', -30, 4),
    ];
    const r = computeStoreBalance({ store, at: '2026-11-22T12:00:00.000Z', checks });
    expect(r.breakdown.adjustmentsCents).toBe(-30);
  });

  test('ajuste depois de `at` não entra (conferência no futuro do cálculo)', () => {
    const r = run({ checks: [checkOf(1, '2026-11-23T00:00:00.000Z', 40)] });
    expect(r.breakdown.adjustmentsCents).toBe(0);
  });

  test('o resultado nunca é -0 e não muta as entradas', () => {
    const items = [purchase(1, '2026-11-12T12:00:00.000Z', 0)];
    const frozen = JSON.parse(JSON.stringify(items));
    const r = run({ items });
    expect(Object.is(r.availableCents, -0)).toBe(false);
    expect(items).toEqual(frozen);
  });

  test('loja inativa e loja BRL calculam como as demais', () => {
    const inactive = csmoney({ id: 3, isActive: false });
    expect(computeStoreBalance({ store: inactive, at: NOW, deposits: [deposit(3, '2026-11-12T12:00:00.000Z', 10)] }).availableCents).toBe(10);
    const brl = steam({ id: 2 });
    const r = computeStoreBalance({
      store: brl, at: NOW, deposits: [deposit(2, '2026-11-12T12:00:00.000Z', 20000)],
      items: [purchase(2, '2026-11-13T12:00:00.000Z', 5000, { purchaseCurrency: 'BRL' })],
    });
    expect(r.availableCents).toBe(15000);
  });
});

describe('buildCheckRecord: ordem dos erros (D244) em combinações', () => {
  const store = csfloat({ id: 1 });
  const lastCheck = checkOf(1, '2026-11-15T12:00:00.000Z', null);
  const ok = { storeId: 1, balanceCents: 5000, recordedAt: '2026-11-16T12:00:00.000Z', adjust: true, note: 'x' };
  const ctx = { store, lastCheck, computedCents: 4000, now: NOW };
  const run = (input, over = {}) => err(() => buildCheckRecord(input, { ...ctx, ...over }));

  test('caso base válido', () => {
    expect(run(ok)).toBeNull();
  });

  test('REQUIRED_FIELD vence STORE_NOT_FOUND e INVALID_AMOUNT; ordem storeId, balanceCents, recordedAt', () => {
    expect(run({ ...ok, storeId: undefined, balanceCents: -1 }, { store: null })).toEqual(['REQUIRED_FIELD', 'storeId']);
    expect(run({ ...ok, balanceCents: undefined, recordedAt: undefined }, { store: null })).toEqual(['REQUIRED_FIELD', 'balanceCents']);
    expect(run({ ...ok, recordedAt: null }, { store: null })).toEqual(['REQUIRED_FIELD', 'recordedAt']);
  });

  test('STORE_NOT_FOUND vence INVALID_AMOUNT e data inválida', () => {
    expect(run({ ...ok, balanceCents: -1, recordedAt: 'lixo' }, { store: null })).toEqual(['STORE_NOT_FOUND', 'storeId']);
  });

  test('INVALID_AMOUNT vence data inválida, futura, antes da última e nota', () => {
    expect(run({ ...ok, balanceCents: -1, recordedAt: '2026-11-01T00:00:00.000Z', note: '   ' })).toEqual(['INVALID_AMOUNT', 'balanceCents']);
    expect(run({ ...ok, balanceCents: 1.5, recordedAt: 'lixo' })).toEqual(['INVALID_AMOUNT', 'balanceCents']);
    expect(run({ ...ok, balanceCents: MAX_AMOUNT_CENTS + 1 })).toEqual(['INVALID_AMOUNT', 'balanceCents']);
  });

  test('data inválida vence futura; futura vence antes da última; última vence nota', () => {
    expect(run({ ...ok, recordedAt: 'lixo' })[0]).toMatch(/INVALID_DATE|INVALID_FIELD/);
    expect(run({ ...ok, recordedAt: '2027-01-01T00:00:00.000Z' })).toEqual(['RECORDED_AT_IN_FUTURE', 'recordedAt']);
    expect(run({ ...ok, recordedAt: '2026-11-12T00:00:00.000Z', note: '  ' })).toEqual(['BALANCE_CHECK_BEFORE_LAST', 'recordedAt']);
    expect(run({ ...ok, note: '   ' })).toEqual(['ADJUSTMENT_NOTE_REQUIRED', 'note']);
  });

  test('nota só com espaços: sem ajuste (adjust false ou diferença 0) vira nula e não dá erro; com ajuste dá ADJUSTMENT_NOTE_REQUIRED', () => {
    const spaces = { ...ok, note: '    \t  ' };
    expect(buildCheckRecord({ ...spaces, adjust: false }, ctx)).toMatchObject({ note: null, adjustmentCents: null });
    expect(buildCheckRecord({ ...spaces, balanceCents: 4000 }, ctx)).toMatchObject({ note: null, adjustmentCents: null });
    expect(run(spaces)).toEqual(['ADJUSTMENT_NOTE_REQUIRED', 'note']);
    expect(run({ ...spaces, note: '' })).toEqual(['ADJUSTMENT_NOTE_REQUIRED', 'note']);
    expect(run({ ...spaces, note: null })).toEqual(['ADJUSTMENT_NOTE_REQUIRED', 'note']);
    expect(run({ ...spaces, note: undefined })).toEqual(['ADJUSTMENT_NOTE_REQUIRED', 'note']);
  });

  test('adjust só vale com o booleano true (truthy não conta)', () => {
    for (const adjust of ['true', 1, 'sim']) {
      expect(buildCheckRecord({ ...ok, adjust, note: null }, ctx).adjustmentCents).toBeNull();
    }
  });

  test('nota: exatamente MAX_NOTE_LENGTH passa; +1 dá FIELD_TOO_LONG; espaços nas pontas não contam', () => {
    const exact = 'a'.repeat(MAX_NOTE_LENGTH);
    expect(buildCheckRecord({ ...ok, note: exact }, ctx).note).toBe(exact);
    expect(buildCheckRecord({ ...ok, note: `  ${exact}  ` }, ctx).note).toBe(exact);
    expect(run({ ...ok, note: `${exact}b` })).toEqual(['FIELD_TOO_LONG', 'note']);
    expect(run({ ...ok, adjust: false, note: `${exact}b` })).toEqual(['FIELD_TOO_LONG', 'note']);
  });

  test('ajuste negativo e positivo; computedCents negativo gera ajuste = real − calculado', () => {
    expect(buildCheckRecord({ ...ok, balanceCents: 3000 }, ctx).adjustmentCents).toBe(-1000);
    expect(buildCheckRecord({ ...ok, balanceCents: 500 }, { ...ctx, computedCents: -300 }).adjustmentCents).toBe(800);
    expect(buildCheckRecord({ ...ok, balanceCents: 0 }, { ...ctx, computedCents: -300 }).computedCents).toBe(-300);
  });

  test('data igual à última aceita; um ms antes recusada; sem última conferência (só registros antigos) qualquer data vale', () => {
    expect(run({ ...ok, recordedAt: lastCheck.recordedAt })).toBeNull();
    expect(run({ ...ok, recordedAt: '2026-11-15T11:59:59.999Z' })).toEqual(['BALANCE_CHECK_BEFORE_LAST', 'recordedAt']);
    expect(run({ ...ok, recordedAt: '2020-01-01T00:00:00.000Z' }, { lastCheck: null })).toBeNull();
  });

  test('loja BRL grava fxRate das configurações; sem cotação ou cotação inválida grava nulo; USD sempre nulo', () => {
    const brl = steam({ id: 2 });
    const input = { ...ok, storeId: 2 };
    const base = { store: brl, lastCheck: null, computedCents: 4000, now: NOW };
    expect(buildCheckRecord(input, { ...base, settings: RATE }).fxRate).toBe(5);
    expect(buildCheckRecord(input, { ...base, settings: { usdBrlRate: null } }).fxRate).toBeNull();
    expect(buildCheckRecord(input, { ...base, settings: { usdBrlRate: 0 } }).fxRate).toBeNull();
    expect(buildCheckRecord(input, base).fxRate).toBeNull();
    expect(buildCheckRecord(ok, { ...ctx, settings: RATE }).fxRate).toBeNull();
  });
});

describe('daysSince: bordas extras', () => {
  test('data no futuro dá 0 (mínimo); 48h dá 2; data inválida não derruba com número', () => {
    expect(daysSince('2026-11-23T00:00:00.000Z', NOW)).toBe(0);
    expect(daysSince('2026-11-20T12:00:00.000Z', NOW)).toBe(2);
    expect(daysSince(undefined, NOW)).toBeNull();
  });
});

describe('buildCurrentBalances: bordas extras', () => {
  const stores = [csfloat({ id: 1, saleHoldDays: 7 }), steam({ id: 2, saleHoldDays: 0 }), csmoney({ id: 3, saleHoldDays: 0, isActive: false })];

  test('nextReleaseAt dos totais é o menor entre as lojas; loja inativa entra nos totais', () => {
    const items = [
      sale(1, '2026-11-21T12:00:00.000Z', 100), // libera 11-28
      sale(3, '2026-11-20T12:00:00.000Z', 200, 10), // libera 11-30
      sale(1, '2026-11-18T12:00:00.000Z', 50), // libera 11-25
    ];
    const r = buildCurrentBalances({ stores, items, settings: RATE, now: NOW });
    expect(r.totals.nextReleaseAt).toBe('2026-11-25T12:00:00.000Z');
    expect(r.totals.lastReleaseAt).toBe('2026-11-30T12:00:00.000Z'); // a maior entre as lojas (a inativa)
    expect(r.stores.find((s) => s.storeId === 1).pending.releases.map((x) => x.releaseAt)).toEqual(['2026-11-25T12:00:00.000Z', '2026-11-28T12:00:00.000Z']);
    expect(r.stores.find((s) => s.storeId === 1).pending.lastReleaseAt).toBe('2026-11-28T12:00:00.000Z');
    expect(r.totals.pendingUsdCents).toBe(350);
    expect(r.stores.find((s) => s.storeId === 3)).toMatchObject({ isActive: false, pending: { cents: 200, usdCents: 200 } });
  });

  test('sem cotação válida: usdBrlRate nulo, loja BRL sem US$ e totais nulos; USD segue exato', () => {
    const deposits = [deposit(2, '2026-11-01T12:00:00.000Z', 1000)];
    const r = buildCurrentBalances({ stores, deposits, items: [], settings: { usdBrlRate: null }, now: NOW });
    expect(r.usdBrlRate).toBeNull();
    expect(r.stores.find((s) => s.storeId === 2)).toMatchObject({ availableUsdCents: null, warningCode: 'FX_NOT_CONFIGURED' });
    expect(r.stores.find((s) => s.storeId === 1).availableUsdCents).toBe(0);
    expect(r.totals.availableUsdCents).toBeNull();
    const nan = buildCurrentBalances({ stores, deposits, items: [], settings: { usdBrlRate: -2 }, now: NOW });
    expect(nan.usdBrlRate).toBeNull();
  });

  test('sem lojas: totais zerados e sem datas', () => {
    const r = buildCurrentBalances({ stores: [], settings: RATE, now: NOW });
    expect(r.stores).toEqual([]);
    expect(r.totals).toMatchObject({ availableUsdCents: 0, pendingUsdCents: 0, nonWithdrawableUsdCents: 0, nextReleaseAt: null, lastReleaseAt: null, estimated: false });
  });

  test('negativo em BRL: convertido com sinal, estimado e com o aviso; nunca -0 quando o valor é 0', () => {
    const r = buildCurrentBalances({
      stores, items: [purchase(2, '2026-11-15T12:00:00.000Z', 10000, { purchaseCurrency: 'BRL' })], settings: RATE, now: NOW,
    });
    const row = r.stores.find((s) => s.storeId === 2);
    expect(row).toMatchObject({ availableCents: -10000, availableUsdCents: -2000, negative: true, estimated: true, warningCode: 'COMPUTED_BALANCE_NEGATIVE' });
    const zero = r.stores.find((s) => s.storeId === 1);
    expect(Object.is(zero.availableUsdCents, -0)).toBe(false);
    expect(Object.is(zero.availableCents, -0)).toBe(false);
  });

  test('nunca conferida: sem warningCode; com moeda divergente o aviso fica em ignored (não em warningCode)', () => {
    const r = buildCurrentBalances({
      stores, items: [purchase(1, '2026-11-15T12:00:00.000Z', 10, { purchaseCurrency: 'BRL' })], settings: RATE, now: NOW,
    });
    const row = r.stores.find((s) => s.storeId === 1);
    expect(row).not.toHaveProperty('initialBalance');
    expect(row.breakdown).not.toHaveProperty('initialCents');
    expect(row).toMatchObject({ lastCheck: null, daysSinceLastCheck: null, warningCode: null, ignored: { currencyMismatch: 1 } });
  });
});

describe('Revisão 23 (D252): aporte e compra na mesma loja', () => {
  const store = csfloat({ id: 1 });

  test('aporte de 1020 e compra de 520 -> disponível 500', () => {
    const r = computeStoreBalance({
      store, at: NOW, deposits: [deposit(1, '2026-11-01T12:00:00.000Z', 1020)], items: [purchase(1, '2026-11-02T12:00:00.000Z', 520)],
    });
    expect(r.availableCents).toBe(500);
    expect(r.breakdown).toEqual({ depositsCents: 1020, purchasesCents: 520, withdrawalsCents: 0, salesReleasedCents: 0, adjustmentsCents: 0 });
  });

  test('o registro antigo (conferência sem cálculo) conta na última conferência e não muda o saldo', () => {
    const entries = [legacyOf(1, 999, '2026-11-20T12:00:00.000Z', 7)];
    const row = buildCurrentBalances({ stores: [store], entries, settings: RATE, now: NOW }).stores[0];
    expect(row).toMatchObject({ availableCents: 0, daysSinceLastCheck: 2 });
    expect(row.lastCheck).toMatchObject({ id: 7, legacy: true });
  });
});

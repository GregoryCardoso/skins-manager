'use strict';

// 8.6 (D239, D246, Revisão 23: D252, D256): funções puras do saldo calculado das lojas, com `now`/`at` fixos.
// O saldo parte sempre de 0, com todas as movimentações da loja (não existe saldo inicial).
const {
  computeStoreBalance, daysSince, buildCheckRecord, buildCurrentBalances,
} = require('../../src/services/storeBalanceService');
const { computeRealProfit } = require('../../src/services/profitService');
const { MAX_AMOUNT_CENTS, MAX_NOTE_LENGTH } = require('../../src/config/constants');
const { csfloat, steam, csmoney } = require('../helpers/storeFixtures');

const NOW = new Date('2026-11-22T12:00:00.000Z');
const RATE = { usdBrlRate: 5.4321 };
const code = (fn) => { try { fn(); } catch (e) { return [e.code, e.field]; } return null; };

const checkOf = (storeId, recordedAt, { balanceCents = 0, computedCents = 0, adjustmentCents = null, id = 200 } = {}) => ({
  id, storeId, kind: 'CHECK', balanceCents, computedCents, adjustmentCents, recordedAt,
});
// Registro antigo (migrado): conferência sem cálculo nem ajuste.
const legacyOf = (storeId, balanceCents, recordedAt, id = 300) => ({
  id, storeId, kind: 'CHECK', balanceCents, computedCents: null, adjustmentCents: null, recordedAt,
});
const sale = (storeId, soldAt, net, days = 7, extra = {}) => ({
  status: 'VENDIDO', saleStoreId: storeId, saleCurrency: 'USD', soldAt, netReceivedCents: net, saleHoldDaysApplied: days,
  acquisitionType: 'GANHEI', purchaseStoreId: null, acquiredAt: '2026-10-01T12:00:00.000Z', purchasePriceCents: 0, purchaseCurrency: 'USD', ...extra,
});
const purchase = (storeId, acquiredAt, cents, extra = {}) => ({
  status: 'EM_ESTOQUE', acquisitionType: 'COMPRA', purchaseStoreId: storeId, purchaseCurrency: 'USD', purchasePriceCents: cents,
  acquiredAt, saleStoreId: null, fxRateAtPurchase: null, ...extra,
});
const deposit = (storeId, depositedAt, cents) => ({ storeId, amountStoreCents: cents, depositedAt });
const withdrawal = (storeId, withdrawnAt, cents) => ({ storeId, amountStoreCents: cents, withdrawnAt });

describe('exemplo de referência da Revisão 23 (D252): aporte 10,20 + compra 5,20', () => {
  const store = csfloat({ id: 1 });
  const deposits = [deposit(1, '2026-11-01T12:00:00.000Z', 1020)];
  const bought = purchase(1, '2026-11-02T12:00:00.000Z', 520);

  test('saldo 500, total colocado 1020, estoque 520 e lucro real 0 (exato)', () => {
    const balances = buildCurrentBalances({ stores: [store], deposits, items: [bought], settings: RATE, now: NOW });
    expect(balances.stores[0]).toMatchObject({
      availableCents: 500, availableUsdCents: 500, breakdown: { depositsCents: 1020, purchasesCents: 520 },
    });
    const profit = computeRealProfit({ deposits, stores: [store], balances, stockItems: [bought], settings: RATE });
    expect(profit).toMatchObject({
      depositsUsdCents: 1020, platformBalanceUsdCents: 500, stockUsdCents: 520, realProfitUsdCents: 0, estimated: false,
    });
  });

  test('vendendo o item por líquido 600: disponível 1100, estoque 0 e lucro 80', () => {
    const soldItem = { ...bought, status: 'VENDIDO', saleStoreId: 1, saleCurrency: 'USD', soldAt: '2026-11-10T12:00:00.000Z', netReceivedCents: 600, saleHoldDaysApplied: 0 };
    const balances = buildCurrentBalances({ stores: [store], deposits, items: [soldItem], settings: RATE, now: NOW });
    expect(balances.stores[0].availableCents).toBe(1100);
    const profit = computeRealProfit({ deposits, stores: [store], balances, stockItems: [], settings: RATE });
    expect(profit).toMatchObject({ platformBalanceUsdCents: 1100, stockUsdCents: 0, realProfitUsdCents: 80 });
  });
});

describe('computeStoreBalance: sem corte por data', () => {
  const store = csfloat({ id: 1 });
  const run = (extra) => computeStoreBalance({ store, at: NOW, ...extra });

  test('movimentações antigas contam; a igualdade com `at` entra e um ms depois fica fora', () => {
    expect(run({ deposits: [deposit(1, '2000-01-01T00:00:00.000Z', 500)] }).availableCents).toBe(500);
    expect(run({ deposits: [deposit(1, NOW.toISOString(), 500)] }).availableCents).toBe(500);
    expect(run({ deposits: [deposit(1, '2026-11-22T12:00:00.001Z', 500)] }).availableCents).toBe(0);
  });

  test('a venda antiga já liberada conta; o pendente é soldAt <= at < liberação', () => {
    const r = run({ items: [sale(1, '2026-01-01T12:00:00.000Z', 400), sale(1, '2026-11-20T18:00:00.000Z', 1500), sale(1, '2026-11-23T00:00:00.000Z', 99)] });
    expect(r.breakdown.salesReleasedCents).toBe(400);
    expect(r.pending).toEqual({ cents: 1500, count: 1, nextReleaseAt: '2026-11-27T18:00:00.000Z' });
  });

  test('compra de item vendido continua descontando; GANHEI com loja informativa não afeta', () => {
    const soldItem = { ...purchase(1, '2026-11-12T00:00:00.000Z', 300), ...sale(1, '2026-11-13T00:00:00.000Z', 400, 0), acquisitionType: 'COMPRA', purchaseStoreId: 1, acquiredAt: '2026-11-12T00:00:00.000Z', purchasePriceCents: 300 };
    expect(run({ items: [soldItem] })).toMatchObject({ availableCents: 100, breakdown: { purchasesCents: 300, salesReleasedCents: 400 } });
    expect(run({ items: [{ ...purchase(1, '2026-11-12T00:00:00.000Z', 900), acquisitionType: 'GANHEI' }] }).availableCents).toBe(0);
  });

  test('venda com retenção nula, 0 e 7', () => {
    const r = run({ items: [sale(1, '2026-11-20T00:00:00.000Z', 100, null), sale(1, '2026-11-20T00:00:00.000Z', 200, 0), sale(1, '2026-11-20T00:00:00.000Z', 400, 7)] });
    expect(r.availableCents).toBe(300);
    expect(r.pending).toMatchObject({ cents: 400, count: 1 });
  });

  test('liberação exatamente em `at` já está liberada', () => {
    expect(run({ items: [sale(1, '2026-11-15T12:00:00.000Z', 250)] }).availableCents).toBe(250);
  });

  test('venda em loja diferente da de compra: a compra desconta de uma e o líquido entra na outra', () => {
    const item = { ...sale(2, '2026-11-12T00:00:00.000Z', 700, 0), acquisitionType: 'COMPRA', purchaseStoreId: 1, purchasePriceCents: 500, purchaseCurrency: 'USD', saleCurrency: 'BRL' };
    expect(run({ items: [item] }).availableCents).toBe(-500);
    expect(computeStoreBalance({ store: steam({ id: 2 }), items: [item], at: NOW }).availableCents).toBe(700);
  });

  test('aporte legado ignorado e contado; saque sem loja não entra; a taxa do saque não desconta de novo', () => {
    const r = run({
      deposits: [{ storeId: 1, amountStoreCents: null, depositedAt: '2026-11-12T00:00:00.000Z' }, deposit(1, '2026-11-12T00:00:00.000Z', 100)],
      withdrawals: [{ storeId: null, amountStoreCents: null, withdrawnAt: '2026-11-12T00:00:00.000Z' }, { ...withdrawal(1, '2026-11-12T00:00:00.000Z', 30), feeCents: 5 }],
    });
    expect(r.availableCents).toBe(70);
    expect(r.ignored.legacyDeposits).toBe(1);
  });

  test('ajuste entra por data; conferência sem ajuste e de outra loja não; `excludeId` não existe mais', () => {
    const own = checkOf(1, '2026-11-12T00:00:00.000Z', { adjustmentCents: -50, id: 9 });
    const other = checkOf(2, '2026-11-12T00:00:00.000Z', { adjustmentCents: -70, id: 10 });
    const none = checkOf(1, '2026-11-12T00:00:00.000Z', { id: 11 });
    expect(run({ checks: [own, other, none] }).availableCents).toBe(-50);
    expect(run({ checks: [own], excludeId: 9 }).availableCents).toBe(-50); // parâmetro removido (adendo 6): é ignorado
    expect(run({ checks: [checkOf(1, '2026-11-23T00:00:00.000Z', { adjustmentCents: 40 })] }).availableCents).toBe(0);
  });

  test('registro antigo (sem cálculo nem ajuste) não muda o saldo', () => {
    expect(run({ checks: [legacyOf(1, 9999, '2026-11-12T00:00:00.000Z')] }).availableCents).toBe(0);
  });

  test('resultado negativo (E8-Q20), moeda divergente ignorada e contada, loja inativa e BRL', () => {
    expect(run({ items: [purchase(1, '2026-11-12T00:00:00.000Z', 300)] }).availableCents).toBe(-300);
    const r = run({ items: [purchase(1, '2026-11-12T00:00:00.000Z', 300, { purchaseCurrency: 'BRL' }), sale(1, '2026-11-12T00:00:00.000Z', 50, 0, { saleCurrency: 'BRL' })] });
    expect(r).toMatchObject({ availableCents: 0, ignored: { currencyMismatch: 2 } });
    expect(computeStoreBalance({ store: csfloat({ id: 1, isActive: false }), deposits: [deposit(1, '2026-11-12T00:00:00.000Z', 10)], at: NOW }).availableCents).toBe(10);
  });

  test('histórico completo: disponível = aportes + vendas liberadas − compras − saques, sem ajustes', () => {
    const r = run({
      deposits: [deposit(1, '2026-02-01T00:00:00.000Z', 10000)],
      items: [purchase(1, '2026-02-02T00:00:00.000Z', 4000), sale(1, '2026-03-01T00:00:00.000Z', 1500)],
      withdrawals: [withdrawal(1, '2026-04-01T00:00:00.000Z', 2000)],
    });
    expect(r.availableCents).toBe(10000 + 1500 - 4000 - 2000);
    expect(r.breakdown.adjustmentsCents).toBe(0);
    expect(r.breakdown).not.toHaveProperty('initialCents');
  });
});

describe('daysSince', () => {
  test('0, 23h59 (0), 24h (1) e nulo', () => {
    expect(daysSince(NOW.toISOString(), NOW)).toBe(0);
    expect(daysSince('2026-11-21T12:00:00.001Z', NOW)).toBe(0);
    expect(daysSince('2026-11-21T12:00:00.000Z', NOW)).toBe(1);
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince('2026-11-23T12:00:00.000Z', NOW)).toBe(0);
  });
});

describe('buildCheckRecord', () => {
  const store = csfloat();
  const build = (input, opts = {}) => buildCheckRecord(
    { storeId: 1, balanceCents: 7900, recordedAt: '2026-11-16T12:00:00.000Z', ...input },
    { store, lastCheck: null, computedCents: 8000, settings: RATE, now: NOW, ...opts }
  );

  test('sem ajuste por padrão; com adjust e diferença: ajuste = real − calculado e nota obrigatória', () => {
    expect(build({})).toMatchObject({ kind: 'CHECK', balanceCents: 7900, computedCents: 8000, adjustmentCents: null, note: null });
    expect(build({ adjust: true, note: 'taxa não registrada' })).toMatchObject({ adjustmentCents: -100, note: 'taxa não registrada' });
    expect(code(() => build({ adjust: true }))).toEqual(['ADJUSTMENT_NOTE_REQUIRED', 'note']);
    expect(code(() => build({ adjust: true, note: '   ' }))).toEqual(['ADJUSTMENT_NOTE_REQUIRED', 'note']);
  });

  test('diferença 0 com adjust: sem ajuste e sem exigir nota; o registro não tem mais saldo inicial', () => {
    expect(build({ balanceCents: 8000, adjust: true })).toMatchObject({ adjustmentCents: null, note: null });
    expect(() => build({ recordedAt: '2000-01-01T00:00:00.000Z' })).not.toThrow(); // não existe BALANCE_CHECK_BEFORE_INITIAL
  });

  test('BALANCE_CHECK_BEFORE_LAST: antes da última conferência com cálculo recusada; igual aceita', () => {
    const lastCheck = checkOf(1, '2026-11-18T12:00:00.000Z');
    expect(code(() => build({}, { lastCheck }))).toEqual(['BALANCE_CHECK_BEFORE_LAST', 'recordedAt']);
    expect(build({ recordedAt: '2026-11-18T12:00:00.000Z' }, { lastCheck }).recordedAt).toBe('2026-11-18T12:00:00.000Z');
  });

  test('ordem dos erros: campos, loja, valor, data, última, nota, tamanho', () => {
    expect(code(() => build({ storeId: null }))).toEqual(['REQUIRED_FIELD', 'storeId']);
    expect(code(() => build({}, { store: null }))).toEqual(['STORE_NOT_FOUND', 'storeId']);
    expect(code(() => build({ balanceCents: -1, recordedAt: 'x' }))).toEqual(['INVALID_AMOUNT', 'balanceCents']);
    expect(code(() => build({ balanceCents: MAX_AMOUNT_CENTS + 1 }))).toEqual(['INVALID_AMOUNT', 'balanceCents']);
    expect(code(() => build({ recordedAt: 'x' }))).toEqual(['INVALID_DATE', 'recordedAt']);
    expect(code(() => build({ recordedAt: '2026-11-17T00:00:00.000Z', adjust: true }, { lastCheck: checkOf(1, '2026-11-18T12:00:00.000Z') }))).toEqual(['BALANCE_CHECK_BEFORE_LAST', 'recordedAt']);
    expect(code(() => build({ adjust: true, note: 'a'.repeat(MAX_NOTE_LENGTH + 1) }))).toEqual(['FIELD_TOO_LONG', 'note']);
  });

  test('data mais tarde hoje aceita; amanhã em Brasília recusada', () => {
    expect(build({ recordedAt: '2026-11-22T20:00:00.000Z' }).recordedAt).toBe('2026-11-22T20:00:00.000Z');
    expect(code(() => build({ recordedAt: '2026-11-23T03:00:00.000Z' }))).toEqual(['RECORDED_AT_IN_FUTURE', 'recordedAt']);
  });
});

describe('buildCurrentBalances', () => {
  const stores = [csfloat({ id: 1, saleHoldDays: 7 }), steam({ id: 2, saleHoldDays: 0 }), csmoney({ id: 3, saleHoldDays: 7 })];
  const deposits = [deposit(1, '2026-11-12T12:00:00.000Z', 5000), deposit(2, '2026-11-12T12:00:00.000Z', 4590)];
  const items = [purchase(1, '2026-11-13T12:00:00.000Z', 3000), sale(1, '2026-11-11T09:00:00.000Z', 2500), sale(1, '2026-11-20T18:00:00.000Z', 1500)];
  const entries = [checkOf(1, '2026-11-16T12:00:00.000Z', { balanceCents: 7900, computedCents: 8000, adjustmentCents: -100, id: 201 })];
  const result = buildCurrentBalances({ stores, entries, deposits, items, settings: RATE, now: NOW });
  const byName = Object.fromEntries(result.stores.map((s) => [s.storeName, s]));

  test('CSFloat: 5000 − 3000 + 2500 − 100 = 4400, pendente 1500, última conferência há 6 dias, sem saldo inicial', () => {
    expect(byName.CSFloat).toMatchObject({
      availableCents: 4400, availableUsdCents: 4400, negative: false, warningCode: null, daysSinceLastCheck: 6,
      breakdown: { depositsCents: 5000, purchasesCents: 3000, withdrawalsCents: 0, salesReleasedCents: 2500, adjustmentsCents: -100 },
      pending: { cents: 1500, count: 1, nextReleaseAt: '2026-11-27T18:00:00.000Z', usdCents: 1500, estimated: false },
      lastCheck: { id: 201, kind: 'CHECK', differenceCents: -100, legacy: false },
    });
    expect(byName.CSFloat).not.toHaveProperty('initialBalance');
    expect(byName.CSFloat.breakdown).not.toHaveProperty('initialCents');
  });

  test('Steam (BRL) convertida uma vez para USD e estimada; CSMoney sem registro: sem aviso', () => {
    expect(byName.Steam).toMatchObject({ availableCents: 4590, availableUsdCents: 845, estimated: true, daysSinceLastCheck: null, lastCheck: null });
    expect(byName.CSMoney).toMatchObject({ availableCents: 0, warningCode: null, lastCheck: null });
  });

  test('totais: disponível, pendente e "não sacável" (disponível + pendente das lojas sem saque)', () => {
    expect(result.totals).toMatchObject({
      availableUsdCents: 4400 + 845, pendingUsdCents: 1500, nonWithdrawableUsdCents: 845, nextReleaseAt: '2026-11-27T18:00:00.000Z', estimated: true,
    });
    expect(result.totals).not.toHaveProperty('releasedAfterBalanceUsdCents');
    expect(result.stores.map((s) => s.storeName)).toEqual(['CSFloat', 'Steam', 'CSMoney']);
  });

  test('saldo negativo: convertido com sinal, sem -0, com COMPUTED_BALANCE_NEGATIVE; FX_NOT_CONFIGURED tem prioridade', () => {
    const r = buildCurrentBalances({ stores: [csfloat({ id: 1 })], items: [purchase(1, '2026-11-12T00:00:00.000Z', 300)], settings: RATE, now: NOW });
    expect(r.stores[0]).toMatchObject({ availableCents: -300, availableUsdCents: -300, negative: true, warningCode: 'COMPUTED_BALANCE_NEGATIVE' });
    const tiny = buildCurrentBalances({ stores: [steam({ id: 2 })], items: [purchase(2, '2026-11-12T00:00:00.000Z', 1, { purchaseCurrency: 'BRL' })], settings: RATE, now: NOW });
    expect(Object.is(tiny.stores[0].availableUsdCents, -0)).toBe(false);
    const noFx = buildCurrentBalances({ stores: [steam({ id: 2 })], items: [purchase(2, '2026-11-12T00:00:00.000Z', 300, { purchaseCurrency: 'BRL' })], settings: { usdBrlRate: null }, now: NOW });
    expect(noFx.stores[0]).toMatchObject({ availableCents: -300, availableUsdCents: null, warningCode: 'FX_NOT_CONFIGURED' });
    expect(buildCurrentBalances({ stores: [], now: NOW }).totals).toMatchObject({ availableUsdCents: 0, nonWithdrawableUsdCents: 0, estimated: false });
  });

  test('a última conferência considera o registro antigo (desempate pelo maior id)', () => {
    const rows = [legacyOf(1, 100, '2026-11-20T00:00:00.000Z', 5), legacyOf(1, 90, '2026-11-20T00:00:00.000Z', 6)];
    const row = buildCurrentBalances({ stores: [csfloat({ id: 1 })], entries: rows, settings: RATE, now: NOW }).stores[0];
    expect(row.lastCheck).toMatchObject({ id: 6, legacy: true, differenceCents: null });
    expect(row.daysSinceLastCheck).toBe(2);
  });
});

'use strict';

// 8.3 (D206, D211, D215, D216): buildStoreBalanceRecord e buildCurrentBalances (puros, com `now` fixo).
const { buildStoreBalanceRecord, buildCurrentBalances } = require('../../src/services/storeBalanceService');
const { estimateBalanceBrl } = require('../../src/services/withdrawalService');
const { MAX_AMOUNT_CENTS } = require('../../src/config/constants');
const { csfloat, steam, csmoney } = require('../helpers/storeFixtures');

const NOW = new Date('2026-11-21T12:00:00.000Z');
const RATE = { usdBrlRate: 5.4321 };

const sale = (storeId, soldAt, net, days = 7, extra = {}) => ({
  status: 'VENDIDO', saleStoreId: storeId, soldAt, netReceivedCents: net, saleHoldDaysApplied: days, acquisitionType: 'GANHEI',
  purchaseStoreId: null, acquiredAt: '2026-10-01T12:00:00.000Z', ...extra,
});

describe('buildStoreBalanceRecord', () => {
  const store = csfloat();
  const base = { storeId: 1, balanceCents: 12346, recordedAt: '2026-11-20T15:00:00.000Z' };
  const build = (input, opts = {}) => buildStoreBalanceRecord({ ...base, ...input }, { store, settings: RATE, now: NOW, ...opts });
  const code = (fn) => { try { fn(); } catch (e) { return [e.code, e.field]; } return null; };

  test('registro válido; loja USD grava fxRate nulo', () => {
    expect(build({})).toEqual({ storeId: 1, balanceCents: 12346, fxRate: null, recordedAt: '2026-11-20T15:00:00.000Z' });
  });

  test('loja BRL grava a cotação das configurações; sem cotação, nulo', () => {
    expect(build({}, { store: steam() }).fxRate).toBe(5.4321);
    expect(build({}, { store: steam(), settings: { usdBrlRate: null } }).fxRate).toBeNull();
    expect(build({}, { store: steam(), settings: null }).fxRate).toBeNull();
  });

  test('limites do saldo: 0, 1 e MAX ok; -1, MAX+1, decimal e string inválidos', () => {
    for (const v of [0, 1, MAX_AMOUNT_CENTS]) expect(build({ balanceCents: v }).balanceCents).toBe(v);
    for (const v of [-1, MAX_AMOUNT_CENTS + 1, 1.5, '100', NaN]) {
      expect(code(() => build({ balanceCents: v }))).toEqual(['INVALID_AMOUNT', 'balanceCents']);
    }
  });

  test('obrigatórios e loja inexistente', () => {
    expect(code(() => build({ storeId: null }))).toEqual(['REQUIRED_FIELD', 'storeId']);
    expect(code(() => build({}, { store: null }))).toEqual(['STORE_NOT_FOUND', 'storeId']);
    expect(code(() => build({ balanceCents: null }))).toEqual(['REQUIRED_FIELD', 'balanceCents']);
    expect(code(() => build({ recordedAt: null }))).toEqual(['REQUIRED_FIELD', 'recordedAt']);
    expect(code(() => build({ recordedAt: 'ontem' }))).toEqual(['INVALID_DATE', 'recordedAt']);
  });

  test('data futura: recusada; até 23:59 de hoje em Brasília aceita', () => {
    expect(code(() => build({ recordedAt: '2026-11-23T12:00:00.000Z' }))).toEqual(['RECORDED_AT_IN_FUTURE', 'recordedAt']);
    expect(build({ recordedAt: '2026-11-22T01:59:00.000Z' }).recordedAt).toBe('2026-11-22T01:59:00.000Z'); // 21/11 22:59 BRT
    // virada BRT/UTC: 02:00Z do dia 22 ainda é 23:00 de 21/11 em Brasília
    expect(build({ recordedAt: '2026-11-22T02:00:00.000Z' }).recordedAt).toBe('2026-11-22T02:00:00.000Z');
    expect(code(() => build({ recordedAt: '2026-11-22T03:00:00.000Z' }))).toEqual(['RECORDED_AT_IN_FUTURE', 'recordedAt']);
  });
});

// Cenário completo de D206 / D216.
function d206() {
  const stores = [csfloat({ id: 1, saleHoldDays: 7 }), steam({ id: 2, saleHoldDays: 0 }), csmoney({ id: 3, saleHoldDays: 7 })];
  const latestBalances = [
    { id: 1, storeId: 1, balanceCents: 12346, recordedAt: '2026-11-20T15:00:00.000Z', createdAt: 'x' },
    { id: 2, storeId: 2, balanceCents: 4590, recordedAt: '2026-11-21T09:00:00.000Z', createdAt: 'x' },
  ];
  const items = [
    sale(1, '2026-11-20T18:00:00.000Z', 2500), // B
    sale(1, '2026-11-21T01:30:00.000Z', 2000), // C
    sale(1, '2026-11-18T09:00:00.000Z', 3000), // G
    sale(1, '2026-11-13T20:00:00.000Z', 1200), // F
    sale(1, '2026-11-12T10:00:00.000Z', 1500), // D
    sale(3, '2026-11-19T12:00:00.000Z', 1000), // E
    sale(3, '2026-11-10T12:00:00.000Z', 600), // I
    sale(2, '2026-11-21T10:00:00.000Z', 800, 0), // H
    { status: 'EM_ESTOQUE', acquisitionType: 'COMPRA', purchaseStoreId: 1, acquiredAt: '2026-11-01T12:00:00.000Z', saleStoreId: null },
  ];
  const withdrawals = [{ storeId: 1, withdrawnAt: '2026-11-10T12:00:00.000Z' }, { storeId: null, withdrawnAt: '2026-01-05T12:00:00.000Z' }];
  return { stores, latestBalances, items, withdrawals, settings: RATE, now: NOW };
}

describe('buildCurrentBalances: exemplo de D206 centavo a centavo', () => {
  const result = buildCurrentBalances(d206());
  const byName = Object.fromEntries(result.stores.map((s) => [s.storeName, s]));

  test('CSFloat', () => {
    const c = byName.CSFloat;
    expect(c).toMatchObject({
      availableCents: 12346, availableEstimatedBrlCents: 67065, allowsWithdrawal: true, estimated: true,
      outdated: true, outdatedReasons: ['RELEASED_AFTER_BALANCE'], warningCode: 'BALANCE_MAYBE_OUTDATED', saleHoldDays: 7,
    });
    expect(c.pending).toEqual({ cents: 7500, count: 3, nextReleaseAt: '2026-11-25T09:00:00.000Z', estimatedBrlCents: 40741 });
    expect(c.releasedAfterBalance).toEqual({ cents: 1200, count: 1, earliestReleasedAt: '2026-11-20T20:00:00.000Z', estimatedBrlCents: 6519 });
  });

  test('Steam: venda H com retenção 0 só dispara ACTIVITY_AFTER_BALANCE', () => {
    expect(byName.Steam).toMatchObject({
      availableCents: 4590, availableEstimatedBrlCents: 4590, allowsWithdrawal: false, estimated: false,
      outdated: true, outdatedReasons: ['ACTIVITY_AFTER_BALANCE'], warningCode: 'BALANCE_MAYBE_OUTDATED',
    });
    expect(byName.Steam.pending).toEqual({ cents: 0, count: 0, nextReleaseAt: null, estimatedBrlCents: 0 });
    expect(byName.Steam.releasedAfterBalance).toEqual({ cents: 0, count: 0, earliestReleasedAt: null, estimatedBrlCents: 0 });
  });

  test('CSMoney: sem saldo registrado, sem aviso', () => {
    const m = byName.CSMoney;
    expect(m).toMatchObject({ balance: null, availableCents: 0, availableEstimatedBrlCents: 0, outdated: false, outdatedReasons: [], warningCode: null });
    expect(m.pending).toEqual({ cents: 1000, count: 1, nextReleaseAt: '2026-11-26T12:00:00.000Z', estimatedBrlCents: 5432 });
    expect(m.releasedAfterBalance).toEqual({ cents: 600, count: 1, earliestReleasedAt: '2026-11-17T12:00:00.000Z', estimatedBrlCents: 3259 });
  });

  test('totais', () => {
    expect(result.totals).toEqual({
      availableEstimatedBrlCents: 71655,
      pendingEstimatedBrlCents: 46173,
      releasedAfterBalanceEstimatedBrlCents: 9778,
      nonWithdrawableEstimatedBrlCents: 4590,
      nextReleaseAt: '2026-11-25T09:00:00.000Z',
      estimated: true,
    });
    expect(result.usdBrlRate).toBe(5.4321);
    expect(result.computedAt).toBe(NOW.toISOString());
  });

  test('uma linha por loja, inclusive inativa; ordem das lojas preservada', () => {
    expect(result.stores.map((s) => s.storeName)).toEqual(['CSFloat', 'Steam', 'CSMoney']);
    const inactive = d206();
    inactive.stores[0] = { ...inactive.stores[0], isActive: false };
    const r = buildCurrentBalances(inactive);
    expect(r.stores[0]).toMatchObject({ isActive: false });
    expect(r.stores[0].pending.cents).toBe(7500);
  });
});

describe('buildCurrentBalances: avisos', () => {
  const only = (store, extra) => buildCurrentBalances({ stores: [store], settings: RATE, now: NOW, ...extra }).stores[0];
  const balance = (id, iso, cents = 100) => ({ id, storeId: 1, balanceCents: cents, recordedAt: iso, createdAt: 'x' });
  const recorded = balance(1, '2026-11-20T15:00:00.000Z');

  test('só venda pendente não dispara o aviso', () => {
    const row = only(csfloat(), { latestBalances: [recorded], items: [sale(1, '2026-11-20T18:00:00.000Z', 100)] });
    expect(row.pending.count).toBe(1);
    expect(row).toMatchObject({ outdated: false, outdatedReasons: [], warningCode: null });
  });

  test('venda liberada depois do registro -> RELEASED_AFTER_BALANCE', () => {
    const row = only(csfloat(), { latestBalances: [recorded], items: [sale(1, '2026-11-13T20:00:00.000Z', 100)] });
    expect(row.outdatedReasons).toEqual(['RELEASED_AFTER_BALANCE']);
  });

  test('compra, saque e venda sem retenção depois do registro -> ACTIVITY_AFTER_BALANCE', () => {
    const purchase = { status: 'EM_ESTOQUE', acquisitionType: 'COMPRA', purchaseStoreId: 1, acquiredAt: '2026-11-21T00:00:00.000Z' };
    expect(only(csfloat(), { latestBalances: [recorded], items: [purchase] }).outdatedReasons).toEqual(['ACTIVITY_AFTER_BALANCE']);
    const withdrawal = { storeId: 1, withdrawnAt: '2026-11-21T00:00:00.000Z' };
    expect(only(csfloat(), { latestBalances: [recorded], withdrawals: [withdrawal] }).outdatedReasons).toEqual(['ACTIVITY_AFTER_BALANCE']);
    const noHold = sale(1, '2026-11-21T00:00:00.000Z', 100, null);
    expect(only(csfloat(), { latestBalances: [recorded], items: [noHold] }).outdatedReasons).toEqual(['ACTIVITY_AFTER_BALANCE']);
  });

  test('item GANHEI com loja informativa não dispara ACTIVITY_AFTER_BALANCE', () => {
    const gift = { status: 'EM_ESTOQUE', acquisitionType: 'GANHEI', purchaseStoreId: 1, acquiredAt: '2026-11-21T00:00:00.000Z' };
    expect(only(csfloat(), { latestBalances: [recorded], items: [gift] })).toMatchObject({ outdated: false, outdatedReasons: [] });
  });

  test('atividade exatamente no recordedAt, ou antes, não dispara; saque de outra loja não dispara', () => {
    const equal = { status: 'EM_ESTOQUE', acquisitionType: 'COMPRA', purchaseStoreId: 1, acquiredAt: recorded.recordedAt };
    expect(only(csfloat(), { latestBalances: [recorded], items: [equal] }).outdated).toBe(false);
    const other = { storeId: 3, withdrawnAt: '2026-11-21T00:00:00.000Z' };
    expect(only(csfloat(), { latestBalances: [recorded], withdrawals: [other] }).outdated).toBe(false);
  });

  test('os dois motivos juntos, nessa ordem', () => {
    const items = [sale(1, '2026-11-13T20:00:00.000Z', 100), { status: 'EM_ESTOQUE', acquisitionType: 'COMPRA', purchaseStoreId: 1, acquiredAt: '2026-11-21T00:00:00.000Z' }];
    expect(only(csfloat(), { latestBalances: [recorded], items }).outdatedReasons).toEqual(['RELEASED_AFTER_BALANCE', 'ACTIVITY_AFTER_BALANCE']);
  });

  test('loja sem saldo registrado: outdated false mesmo com atividade', () => {
    const items = [{ status: 'EM_ESTOQUE', acquisitionType: 'COMPRA', purchaseStoreId: 1, acquiredAt: '2026-11-21T00:00:00.000Z' }, sale(1, '2026-11-01T00:00:00.000Z', 100)];
    const row = only(csfloat(), { items });
    expect(row).toMatchObject({ outdated: false, outdatedReasons: [], balance: null, availableCents: 0 });
    expect(row.releasedAfterBalance.count).toBe(1);
  });

  test('o saldo mais recente de cada loja é o que vale (latestBalances por loja)', () => {
    const row = only(csfloat(), { latestBalances: [balance(5, '2026-11-21T08:00:00.000Z', 777)] });
    expect(row.balance).toMatchObject({ id: 5, balanceCents: 777, storeName: 'CSFloat', currency: 'USD' });
  });
});

describe('buildCurrentBalances: sem cotação e totais', () => {
  const noFx = (settings) => {
    const input = d206();
    return buildCurrentBalances({ ...input, settings });
  };

  test('sem cotação: parcelas USD null, cents preenchidos, FX_NOT_CONFIGURED; Steam segue', () => {
    const r = noFx({ usdBrlRate: null });
    const csf = r.stores.find((s) => s.storeName === 'CSFloat');
    expect(csf).toMatchObject({ availableCents: 12346, availableEstimatedBrlCents: null, warningCode: 'FX_NOT_CONFIGURED', estimated: true });
    expect(csf.pending).toMatchObject({ cents: 7500, estimatedBrlCents: null });
    expect(csf.releasedAfterBalance).toMatchObject({ cents: 1200, estimatedBrlCents: null });
    expect(r.stores.find((s) => s.storeName === 'Steam')).toMatchObject({ availableEstimatedBrlCents: 4590 });
    expect(r.totals).toMatchObject({
      availableEstimatedBrlCents: null, pendingEstimatedBrlCents: null, releasedAfterBalanceEstimatedBrlCents: null,
      nonWithdrawableEstimatedBrlCents: 4590, estimated: true,
    });
    expect(r.usdBrlRate).toBeNull();
  });

  test('settings nulo equivale a sem cotação', () => {
    expect(noFx(null).totals.availableEstimatedBrlCents).toBeNull();
    expect(noFx(null).usdBrlRate).toBeNull();
  });

  test('nonWithdrawable soma as três categorias da loja sem saque', () => {
    const input = d206();
    // Steam com retenção 2: venda pendente e liberada além do disponível
    input.stores[1] = steam({ id: 2, saleHoldDays: 2 });
    input.items.push(sale(2, '2026-11-21T00:00:00.000Z', 300, 2)); // libera 23/11: pendente
    input.items.push(sale(2, '2026-11-19T00:00:00.000Z', 200, 2)); // libera 21/11 00:00: antes do registro das 09:00 -> não conta
    input.items.push(sale(2, '2026-11-19T10:00:00.000Z', 50, 2)); // libera 21/11 10:00: depois do registro, antes de now
    const r = buildCurrentBalances(input);
    expect(r.totals.nonWithdrawableEstimatedBrlCents).toBe(4590 + 300 + 50);
  });

  test('nextReleaseAt é o menor entre lojas e nulo sem pendentes', () => {
    expect(buildCurrentBalances({ stores: [csfloat()], now: NOW, settings: RATE }).totals.nextReleaseAt).toBeNull();
    expect(buildCurrentBalances({ stores: [], now: NOW }).totals).toMatchObject({ availableEstimatedBrlCents: 0, nonWithdrawableEstimatedBrlCents: 0, estimated: false });
  });

  test('retenção 0 na loja: nenhuma parcela pendente nem liberada', () => {
    const r = buildCurrentBalances({
      stores: [csfloat({ saleHoldDays: 0 })], items: [sale(1, '2026-11-21T10:00:00.000Z', 900, 0)], settings: RATE, now: NOW,
    });
    expect(r.stores[0].pending.cents + r.stores[0].releasedAfterBalance.cents).toBe(0);
  });

  test('snapshot nulo em vendas antigas nunca entra', () => {
    const r = buildCurrentBalances({ stores: [csfloat()], items: [sale(1, '2026-11-20T10:00:00.000Z', 900, null)], settings: RATE, now: NOW });
    expect(r.stores[0].pending.count + r.stores[0].releasedAfterBalance.count).toBe(0);
  });
});

describe('estimateBalanceBrl: ROUND (T82) e warningCode (T48)', () => {
  test('12346 x 5,4321 -> 67065 (FLOOR daria 67064)', () => {
    expect(estimateBalanceBrl({ balanceCents: 12346, store: csfloat(), settings: RATE })).toMatchObject({
      estimatedBrlCents: 67065, estimated: true, warningCode: null,
    });
  });

  test('metade arredonda para cima: 1 x 0,5 -> 1', () => {
    expect(estimateBalanceBrl({ balanceCents: 1, store: csfloat(), settings: { usdBrlRate: 0.5 } }).estimatedBrlCents).toBe(1);
  });

  test('sem cotação: null + FX_NOT_CONFIGURED; saldo 0 e loja BRL não precisam de cotação', () => {
    expect(estimateBalanceBrl({ balanceCents: 5, store: csfloat(), settings: { usdBrlRate: null } })).toMatchObject({
      estimatedBrlCents: null, warningCode: 'FX_NOT_CONFIGURED', estimated: true,
    });
    expect(estimateBalanceBrl({ balanceCents: 0, store: csfloat(), settings: null })).toMatchObject({ estimatedBrlCents: 0, warningCode: null, estimated: false });
    expect(estimateBalanceBrl({ balanceCents: 4590, store: steam(), settings: null })).toMatchObject({ estimatedBrlCents: 4590, warningCode: null, estimated: false });
  });
});

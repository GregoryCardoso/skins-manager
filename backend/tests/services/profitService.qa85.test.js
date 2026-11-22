'use strict';

// QA 8.5: bordas do lucro real em USD (D225, D226, D229): ROUND por parcela, estimated, sem cotação (quais parcelas ficam
// nulas e quais avisos saem), saque com loja em BRL, líquido 0, ratio e o que o valor informativo em R$ nunca altera.
const { computeRealProfit, estimateStockUsd } = require('../../src/services/profitService');
const { buildCurrentBalances } = require('../../src/services/storeBalanceService');
const { csfloat, steam, csmoney } = require('../helpers/storeFixtures');

const NOW = new Date('2026-11-21T12:00:00.000Z');
const USD_STORES = [csfloat({ id: 1 }), csmoney({ id: 3 })];
const steam2 = (overrides = {}) => steam({ id: 5, name: 'Steam2', ...overrides });
// `latestBalances` são saldos iniciais (âncora do saldo calculado, D239).
const latest = (storeId, balanceCents, recordedAt = '2026-11-20T15:00:00.000Z') => ({
  id: storeId, storeId, kind: 'INITIAL', balanceCents, computedCents: null, adjustmentCents: null, recordedAt, fxRate: null,
});
const stockItem = (cost, currency = 'USD', fx = currency === 'BRL' ? 2.0 : null) => ({
  status: 'EM_ESTOQUE', purchasePriceCents: cost, purchaseCurrency: currency, fxRateAtPurchase: fx,
});
const soldBrl = { status: 'VENDIDO', purchasePriceCents: 99999, purchaseCurrency: 'USD', fxRateAtPurchase: null };

// `latest(...)` agora vira um aporte da loja (não existe mais saldo inicial, D252): o saldo calculado parte de 0.
const asDeposits = (list) => list.map((b) => ({ storeId: b.storeId, amountStoreCents: b.balanceCents, depositedAt: b.recordedAt }));
function profit({ stores = USD_STORES, rate = 2.0, deposits = [], withdrawals = [], latestBalances = [], items = [], stockItems = [] } = {}) {
  const settings = { usdBrlRate: rate };
  const balances = buildCurrentBalances({ stores, items, withdrawals, deposits: [...deposits, ...asDeposits(latestBalances)], settings, now: NOW });
  return computeRealProfit({ deposits, withdrawals, stores, balances, stockItems, settings });
}
const legacyDeposit = (brl, id = 1) => ({ id, storeId: null, amountStoreCents: null, amountBrlCents: brl });
const deposit = (usd, id = 1, extra = {}) => ({ id, storeId: 1, amountStoreCents: usd, amountBrlCents: null, ...extra });
const withdrawal = (amount, fee, id = 1, extra = {}) => ({ id, storeId: 1, amountStoreCents: amount, feeCents: fee, amountBrlCents: null, ...extra });
const legacyWithdrawal = (brl, id = 9) => ({ id, storeId: null, amountStoreCents: null, feeCents: null, amountBrlCents: brl });
const sources = (r) => r.warnings.filter((w) => w.code === 'FX_NOT_CONFIGURED').map((w) => (w.source === 'STORE' ? `STORE:${w.storeName}` : w.source));

describe('ROUND por parcela, antes de somar (T82)', () => {
  // A cotação 2,0 faz cada R$ 0,01 valer 0,5 centavo: ROUND leva cada parcela a 1.
  test('aportes legados: cada um arredonda sozinho (1 + 1 = 2, e não ROUND(2 / 2) = 1)', () => {
    const r = profit({ deposits: [legacyDeposit(1, 1), legacyDeposit(1, 2)] });
    expect(r.depositsUsdCents).toBe(2);
  });

  test('saques sem loja e saques de loja em BRL: cada um arredonda sozinho', () => {
    const stores = [csfloat({ id: 1 }), steam({ id: 2, allowsWithdrawal: true })];
    const r = profit({
      stores, withdrawals: [legacyWithdrawal(1, 8), legacyWithdrawal(1, 9), withdrawal(1, null, 10, { storeId: 2 })],
    });
    expect(r.withdrawalsNetUsdCents).toBe(3);
  });

  test('disponível: cada loja em BRL arredonda sozinha', () => {
    const stores = [steam({ id: 2 }), steam2()];
    const r = profit({ stores, latestBalances: [latest(2, 1), latest(5, 1)] });
    expect(r.platformBalanceUsdCents).toBe(2);
  });

  test('estoque: cada item em BRL arredonda sozinho pela cotação gravada do próprio item', () => {
    const r = profit({ stockItems: [stockItem(1, 'BRL', 2.0), stockItem(1, 'BRL', 2.0), stockItem(3, 'BRL', 3.0)] });
    expect(r.stockUsdCents).toBe(1 + 1 + 1);
  });

  test('o lucro usa as parcelas arredondadas: 0,5 + 0,5 de aporte e de saque se cancelam em ±1 sem erro acumulado', () => {
    const r = profit({ deposits: [legacyDeposit(1, 1), legacyDeposit(1, 2)], withdrawals: [legacyWithdrawal(1, 8), legacyWithdrawal(1, 9)] });
    expect(r.realProfitUsdCents).toBe(0);
  });

  test('a cotação gravada no item do estoque vale, a cotação atual das configurações não', () => {
    const r = profit({ rate: 10, stockItems: [stockItem(500, 'BRL', 5.0)] });
    expect(r.stockUsdCents).toBe(100);
  });
});

describe('estimated e estimatedParts', () => {
  test('tudo em USD: estimated false e nenhuma parcela estimada', () => {
    const r = profit({
      deposits: [deposit(1000)], withdrawals: [withdrawal(500, 10)], latestBalances: [latest(1, 300)], stockItems: [stockItem(100)],
    });
    expect(r.estimated).toBe(false);
    expect(Object.values(r.estimatedParts).every((v) => v === false)).toBe(true);
  });

  test('só o estoque em BRL (cotação gravada) já marca estimated e só a parcela stock', () => {
    const r = profit({ stockItems: [stockItem(500, 'BRL', 5.0)] });
    expect(r.estimated).toBe(true);
    expect(r.estimatedParts).toEqual({
      deposits: false, withdrawals: false, platformBalance: false, pendingBalance: false, stock: true,
    });
  });

  test('parcela BRL de valor 0 nunca é estimada: loja BRL com saldo 0, item BRL de custo 0', () => {
    const stores = [csfloat({ id: 1 }), steam({ id: 2 })];
    const r = profit({ stores, latestBalances: [latest(2, 0)], stockItems: [stockItem(0, 'BRL', 5.0), { ...stockItem(0), acquisitionType: 'GANHEI' }] });
    expect(r.estimated).toBe(false);
    expect(r.estimatedParts.platformBalance).toBe(false);
    expect(r.estimatedParts.stock).toBe(false);
  });

  test('loja BRL com saldo > 0: platformBalance estimada; aporte novo em USD continua exato', () => {
    const stores = [csfloat({ id: 1 }), steam({ id: 2 })];
    const r = profit({ stores, deposits: [deposit(1000)], latestBalances: [latest(2, 400)] });
    expect(r.estimatedParts).toMatchObject({ deposits: false, platformBalance: true });
  });

  test('saque de loja em BRL com líquido > 0 é estimado; com líquido 0 (taxa = valor) não é', () => {
    const stores = [csfloat({ id: 1 }), steam({ id: 2, allowsWithdrawal: true })];
    const net = profit({ stores, withdrawals: [withdrawal(1000, 100, 1, { storeId: 2 })] });
    expect(net.withdrawalsNetUsdCents).toBe(450);
    expect(net.estimatedParts.withdrawals).toBe(true);
    const zero = profit({ stores, withdrawals: [withdrawal(1000, 1000, 1, { storeId: 2 })] });
    expect(zero.withdrawalsNetUsdCents).toBe(0);
    expect(zero.estimatedParts.withdrawals).toBe(false);
  });

  test('aporte legado e saque sem loja marcam as respectivas parcelas', () => {
    const r = profit({ deposits: [legacyDeposit(100)], withdrawals: [legacyWithdrawal(100)] });
    expect(r.estimatedParts).toMatchObject({ deposits: true, withdrawals: true, platformBalance: false });
  });
});

describe('saque líquido (D226, D233)', () => {
  test('taxa nula conta 0; taxa 0 igual; taxa igual ao valor dá líquido 0 e não nulo', () => {
    expect(profit({ withdrawals: [withdrawal(1000, null)] }).withdrawalsNetUsdCents).toBe(1000);
    expect(profit({ withdrawals: [withdrawal(1000, 0)] }).withdrawalsNetUsdCents).toBe(1000);
    expect(profit({ withdrawals: [withdrawal(1000, 1000)] }).withdrawalsNetUsdCents).toBe(0);
  });

  test('líquido 0 em loja BRL sem cotação não deixa a parcela nula', () => {
    const stores = [csfloat({ id: 1 }), steam({ id: 2, allowsWithdrawal: true })];
    const r = profit({ stores, rate: null, withdrawals: [withdrawal(1000, 1000, 1, { storeId: 2 })] });
    expect(r.withdrawalsNetUsdCents).toBe(0);
    expect(sources(r)).toEqual([]);
  });

  test('o valor recebido em R$ (qualquer valor ou nulo) nunca entra: com loja, só o líquido na moeda da loja', () => {
    const a = profit({ withdrawals: [withdrawal(1000, 50, 1, { amountBrlCents: 1 })] });
    const b = profit({ withdrawals: [withdrawal(1000, 50, 1, { amountBrlCents: 99999999 })] });
    const c = profit({ withdrawals: [withdrawal(1000, 50, 1, { amountBrlCents: null })] });
    expect([a, b, c].map((r) => r.withdrawalsNetUsdCents)).toEqual([950, 950, 950]);
  });

  test('o valor pago em R$ do aporte novo nunca entra; no legado é o único valor', () => {
    const a = profit({ deposits: [deposit(1000, 1, { amountBrlCents: 1 })] });
    const b = profit({ deposits: [deposit(1000, 1, { amountBrlCents: 9999999 })] });
    expect([a.depositsUsdCents, b.depositsUsdCents]).toEqual([1000, 1000]);
    expect(profit({ deposits: [legacyDeposit(1000)] }).depositsUsdCents).toBe(500);
  });

  test('saque pré-8.5 com loja e taxa nula entra pelo valor sacado da loja (o R$ vira informativo)', () => {
    const r = profit({ withdrawals: [withdrawal(10000, null, 1, { amountBrlCents: 52037 })] });
    expect(r.withdrawalsNetUsdCents).toBe(10000);
    expect(r.estimatedParts.withdrawals).toBe(false);
  });
});

describe('sem cotação: parcelas nulas e avisos', () => {
  const stores = [csfloat({ id: 1 }), steam({ id: 2 }), csmoney({ id: 3 })];

  test('só aporte legado: depósitos nulos, saques e saldo exatos; aviso só de DEPOSITS; lucro nulo', () => {
    const r = profit({ stores, rate: null, deposits: [legacyDeposit(100)], withdrawals: [withdrawal(500, 0)], latestBalances: [latest(1, 300)] });
    expect(r.depositsUsdCents).toBeNull();
    expect(r.withdrawalsNetUsdCents).toBe(500);
    expect(r.platformBalanceUsdCents).toBe(300);
    expect(r.realProfitUsdCents).toBeNull();
    expect(sources(r)).toEqual(['DEPOSITS']);
    expect(r.approxBrl).toEqual({
      deposits: null, withdrawals: null, platformBalance: null, pendingBalance: null, stock: null, realProfit: null,
    });
    expect(r.withdrawnVsDeposited.ratio).toBeNull();
  });

  test('só saque sem loja: aviso só de WITHDRAWALS', () => {
    const r = profit({ stores, rate: null, deposits: [deposit(1000)], withdrawals: [legacyWithdrawal(100)] });
    expect(r.withdrawalsNetUsdCents).toBeNull();
    expect(r.depositsUsdCents).toBe(1000);
    expect(sources(r)).toEqual(['WITHDRAWALS']);
    expect(r.realProfitUsdCents).toBeNull();
    expect(r.withdrawnVsDeposited).toMatchObject({ withdrawnUsdCents: null, depositedUsdCents: 1000, ratio: null });
  });

  test('só saldo da Steam: aviso STORE da Steam (uma vez), depósitos e saques exatos', () => {
    const r = profit({ stores, rate: null, deposits: [deposit(1000)], latestBalances: [latest(2, 4590), latest(1, 100)] });
    expect(r.platformBalanceUsdCents).toBeNull();
    expect(r.depositsUsdCents).toBe(1000);
    expect(sources(r)).toEqual(['STORE:Steam']);
    expect(r.realProfitUsdCents).toBeNull();
  });

  test('os três de uma vez: ordem STORE, DEPOSITS, WITHDRAWALS; pendente e estoque seguem', () => {
    const items = [
      { status: 'VENDIDO', saleStoreId: 1, saleCurrency: 'USD', netReceivedCents: 7500, soldAt: '2026-11-20T18:00:00.000Z', saleHoldDaysApplied: 7, purchaseStoreId: null, acquiredAt: '2026-01-01T00:00:00.000Z' },
    ];
    const r = profit({
      stores, rate: null, deposits: [legacyDeposit(100)], withdrawals: [legacyWithdrawal(100)],
      latestBalances: [latest(2, 4590)], items, stockItems: [stockItem(1500, 'BRL', 5.0), stockItem(1000)],
    });
    expect(sources(r)).toEqual(['STORE:Steam', 'DEPOSITS', 'WITHDRAWALS']);
    expect(r.pendingBalanceUsdCents).toBe(7500);
    expect(r.stockUsdCents).toBe(1300); // 1500 / 5,0 = 300 (gravada) + 1000
    expect(r.realProfitUsdCents).toBeNull();
    expect(r.warnings.some((w) => w.source === 'STOCK')).toBe(false);
  });

  test('sem nenhuma parcela em BRL, sem cotação não gera aviso nenhum e o lucro é exato', () => {
    const r = profit({ stores, rate: null, deposits: [deposit(1000)], withdrawals: [withdrawal(700, 0)], latestBalances: [latest(1, 500)], stockItems: [stockItem(100)] });
    expect(r.realProfitUsdCents).toBe(700 + 500 + 100 - 1000);
    expect(r.warnings).toEqual([]);
    expect(r.approxBrl.realProfit).toBeNull();
    expect(r.estimated).toBe(false);
  });

  test.each([[0], [-1], [NaN], ['5,4'], [Infinity]])('cotação inválida %p equivale a sem cotação', (rate) => {
    const r = profit({ stores, rate, deposits: [legacyDeposit(100)] });
    expect(r.depositsUsdCents).toBeNull();
    expect(sources(r)).toEqual(['DEPOSITS']);
  });
});

describe('ratio "já sacado vs. colocado"', () => {
  test('aportes > 0 e nenhum saque: 0', () => {
    expect(profit({ deposits: [deposit(1000)] }).withdrawnVsDeposited).toEqual({ withdrawnUsdCents: 0, depositedUsdCents: 1000, ratio: 0 });
  });
  test('sem aportes: null mesmo com saques; saques maiores que aportes: ratio > 1', () => {
    expect(profit({ withdrawals: [withdrawal(1000, 0)] }).withdrawnVsDeposited.ratio).toBeNull();
    expect(profit({ deposits: [deposit(1000)], withdrawals: [withdrawal(1500, 0)] }).withdrawnVsDeposited.ratio).toBe(1.5);
  });
  test('usa o saque líquido (taxa descontada)', () => {
    expect(profit({ deposits: [deposit(1000)], withdrawals: [withdrawal(500, 100)] }).withdrawnVsDeposited.ratio).toBe(0.4);
  });
  test('é a razão dos campos do próprio resumo', () => {
    const r = profit({ deposits: [deposit(3000), legacyDeposit(1001, 2)], withdrawals: [withdrawal(777, 7)] });
    expect(r.withdrawnVsDeposited.withdrawnUsdCents).toBe(r.withdrawalsNetUsdCents);
    expect(r.withdrawnVsDeposited.depositedUsdCents).toBe(r.depositsUsdCents);
    expect(r.withdrawnVsDeposited.ratio).toBe(r.withdrawalsNetUsdCents / r.depositsUsdCents);
  });
});

describe('fórmula e "≈ R$"', () => {
  test('lucro = saques + saldo + pendente + liberado + estoque - aportes, com lucro negativo', () => {
    const r = profit({ deposits: [deposit(5000)], withdrawals: [withdrawal(1000, 0)], latestBalances: [latest(1, 500)], stockItems: [stockItem(200)] });
    expect(r.realProfitUsdCents).toBe(1000 + 500 + 200 - 5000);
  });

  test('"≈ R$" de cada total é o ROUND do total em US$ pela cotação, e não a soma dos "≈ R$" das linhas', () => {
    const r = profit({ rate: 5.4321, deposits: [deposit(3), deposit(3, 2)] });
    expect(r.depositsUsdCents).toBe(6);
    expect(r.approxBrl.deposits).toBe(Math.round(6 * 5.4321)); // 33, enquanto 2 × ROUND(3 × 5,4321 = 16,3) = 32
  });

  test('o "≈ R$" do lucro negativo nunca é -0', () => {
    const r = profit({ rate: 5, deposits: [deposit(0 + 1)], withdrawals: [withdrawal(1, 0)] });
    expect(Object.is(r.approxBrl.realProfit, -0)).toBe(false);
    expect(r.approxBrl.realProfit).toBe(0);
  });

  test('entradas vazias ou ausentes: tudo 0, sem avisos e sem estimativa', () => {
    const r = computeRealProfit({ settings: { usdBrlRate: 5 } });
    expect(r).toMatchObject({ depositsUsdCents: 0, withdrawalsNetUsdCents: 0, stockUsdCents: 0, realProfitUsdCents: 0, estimated: false });
    expect(r.warnings).toEqual([]);
  });
});

describe('estimateStockUsd: bordas', () => {
  test('ignora vendidos e itens sem status; BRL sem cotação gravada deixa o total nulo (salvaguarda)', () => {
    expect(estimateStockUsd([soldBrl, stockItem(100)])).toEqual({ totalUsdCents: 100, estimated: false });
    expect(estimateStockUsd([stockItem(100), stockItem(500, 'BRL', null)]).totalUsdCents).toBeNull();
  });
  test('lista vazia', () => {
    expect(estimateStockUsd([])).toEqual({ totalUsdCents: 0, estimated: false });
  });
});

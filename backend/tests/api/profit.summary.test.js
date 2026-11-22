// GET /api/profit/summary (8.5: D205, D226, D229). Exemplo de D226 centavo a centavo, em US$ com "≈ R$" do backend.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const Item = require('../../src/models/Item');
const Withdrawal = require('../../src/models/Withdrawal');
const Deposit = require('../../src/models/Deposit');
const StoreBalance = require('../../src/models/StoreBalance');
const Setting = require('../../src/models/Setting');
const { freshDb, wonSkin, soldFields } = require('../helpers/fixtures');
const { makeApp, storeId, expectError } = require('../helpers/apiFixtures');

const D206_NOW = new Date('2026-11-21T12:00:00.000Z');
let app;

afterAll(() => closeDb());

const summary = async () => {
  const res = await request(app).get('/api/profit/summary');
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  return res.body.data;
};

function seedD206({ rate = 5.4321 } = {}) {
  const csf = storeId('CSFloat');
  const steam = storeId('Steam');
  const csm = storeId('CSMoney');
  Setting.update({ usdBrlRate: rate }, { now: D206_NOW });
  const mk = (name, saleStoreId, soldAt, net, days, currency = 'USD') =>
    Item.create(
      wonSkin({
        name,
        ...soldFields(saleStoreId, {
          soldAt, netReceivedCents: net, salePriceCents: net, saleCurrency: currency, saleHoldDaysApplied: days,
          fxRateAtSale: currency === 'BRL' ? 5.4321 : null,
        }),
        acquiredAt: '2026-10-01T12:00:00.000Z',
      }),
      { now: D206_NOW }
    );
  mk('B', csf, '2026-11-20T18:00:00.000Z', 2500, 7);
  mk('C', csf, '2026-11-21T01:30:00.000Z', 2000, 7);
  mk('G', csf, '2026-11-18T09:00:00.000Z', 3000, 7);
  mk('F', csf, '2026-11-13T20:00:00.000Z', 1200, 7);
  mk('D', csf, '2026-11-12T10:00:00.000Z', 1500, 7);
  mk('E', csm, '2026-11-19T12:00:00.000Z', 1000, 7);
  mk('I', csm, '2026-11-10T12:00:00.000Z', 600, 7);
  mk('H', steam, '2026-11-21T10:00:00.000Z', 800, 0, 'BRL');
  Item.create(wonSkin({
    name: 'estoque usd', acquisitionType: 'COMPRA', purchaseStoreId: csf, purchasePriceCents: 1000, purchaseCurrency: 'USD',
    acquiredAt: '2026-11-01T12:00:00.000Z', status: 'EM_ESTOQUE',
  }), { now: D206_NOW });
  Item.create(wonSkin({
    name: 'estoque brl', acquisitionType: 'COMPRA', purchaseStoreId: steam, purchasePriceCents: 2500, purchaseCurrency: 'BRL',
    fxRateAtPurchase: 5.0, acquiredAt: '2026-11-01T12:00:00.000Z', status: 'EM_ESTOQUE',
  }), { now: D206_NOW });
  Item.create(wonSkin({ name: 'estoque ganhei', status: 'EM_ESTOQUE' }), { now: D206_NOW });
  // Aporte A: creditado US$ 92,00 (pago R$ 500,00, só informativo); aporte B: legado, só R$ 300,00 (sem loja)
  Deposit.create({ storeId: csf, amountStoreCents: 9200, amountBrlCents: 50000, depositedAt: '2026-10-01T12:00:00.000Z', note: null }, { now: D206_NOW });
  Deposit.create({ storeId: null, amountStoreCents: null, amountBrlCents: 30000, depositedAt: '2026-10-05T12:00:00.000Z', note: null }, { now: D206_NOW });
  Withdrawal.create({ storeId: csf, amountStoreCents: 10000, feeCents: 250, amountBrlCents: 52037, withdrawnAt: '2026-11-10T12:00:00.000Z' }, { now: D206_NOW });
  Withdrawal.create({ storeId: null, amountStoreCents: null, feeCents: null, amountBrlCents: 10000, withdrawnAt: '2026-11-02T12:00:00.000Z' }, { now: D206_NOW });
  StoreBalance.create({ storeId: csf, balanceCents: 12346, fxRate: null, recordedAt: '2026-11-20T15:00:00.000Z' }, { now: D206_NOW });
  StoreBalance.create({ storeId: steam, balanceCents: 4590, fxRate: 5.4321, recordedAt: '2026-11-21T09:00:00.000Z' }, { now: D206_NOW });
  return { csf, steam, csm };
}

describe('GET /api/profit/summary: vazio', () => {
  beforeEach(() => { freshDb(); app = makeApp(D206_NOW); });

  test('tudo zerado, ratio nulo, sem avisos e lojas do seed sem saldo', async () => {
    Setting.update({ usdBrlRate: 5 }, { now: D206_NOW });
    const data = await summary();
    expect(data).toMatchObject({
      baseCurrency: 'USD',
      depositsUsdCents: 0, withdrawalsNetUsdCents: 0, platformBalanceUsdCents: 0, pendingBalanceUsdCents: 0,
      releasedAfterBalanceUsdCents: 0, nextReleaseAt: null, stockUsdCents: 0, realProfitUsdCents: 0,
      estimated: false, warnings: [], computedAt: '2026-11-21T12:00:00.000Z',
      approxBrl: { deposits: 0, withdrawals: 0, platformBalance: 0, pendingBalance: 0, releasedAfterBalance: 0, stock: 0, realProfit: 0 },
      withdrawnVsDeposited: { withdrawnUsdCents: 0, depositedUsdCents: 0, ratio: null },
      counts: {
        deposits: 0, legacyDeposits: 0, withdrawals: 0, legacyWithdrawals: 0, withdrawalsWithoutFee: 0, stockItems: 0,
        pendingSales: 0, releasedAfterBalanceSales: 0,
      },
    });
    expect(data).not.toHaveProperty('realProfitBrlCents');
    expect(data.balancesByStore).toHaveLength(3);
  });

  test('sem cotação: tudo zerado continua 0 (parcelas 0 nunca ficam nulas)', async () => {
    const data = await summary();
    expect(data.realProfitUsdCents).toBe(0);
    expect(data.approxBrl.realProfit).toBeNull();
    expect(data.fx).toEqual({ usdBrlRate: null, source: null, updatedAt: null, quotedAt: null });
  });

  test('Host estranho -> 403; POST -> 404 padrão', async () => {
    expectError(await request(app).get('/api/profit/summary').set('Host', 'evil.example'), 403, 'FORBIDDEN_HOST');
    expect((await request(app).post('/api/profit/summary').send({})).status).toBe(404);
  });
});

describe('GET /api/profit/summary: exemplo de D206 centavo a centavo', () => {
  let ids;
  beforeEach(() => { freshDb(); app = makeApp(D206_NOW); ids = seedD206(); });

  test('parcelas em US$, lucro real 21859 (≈ US$ 218,59) e ≈ R$ 1.187,40', async () => {
    const data = await summary();
    expect(data).toMatchObject({
      baseCurrency: 'USD',
      depositsUsdCents: 14723,
      withdrawalsNetUsdCents: 11591,
      platformBalanceUsdCents: 13191,
      pendingBalanceUsdCents: 8500,
      releasedAfterBalanceUsdCents: 1800,
      nextReleaseAt: '2026-11-25T09:00:00.000Z',
      stockUsdCents: 1500,
      realProfitUsdCents: 21859,
      estimated: true,
      estimatedParts: { deposits: true, withdrawals: true, platformBalance: true, pendingBalance: false, releasedAfterBalance: false, stock: true },
      approxBrl: {
        deposits: 79977, withdrawals: 62963, platformBalance: 71655, pendingBalance: 46173, releasedAfterBalance: 9778, stock: 8148,
        realProfit: 118740,
      },
      counts: {
        deposits: 2, legacyDeposits: 1, withdrawals: 2, legacyWithdrawals: 1, withdrawalsWithoutFee: 0, stockItems: 3,
        pendingSales: 4, releasedAfterBalanceSales: 2,
      },
      fx: { usdBrlRate: 5.4321 },
    });
    expect(data.withdrawnVsDeposited).toMatchObject({ withdrawnUsdCents: 11591, depositedUsdCents: 14723 });
    expect(data.withdrawnVsDeposited.ratio).toBeCloseTo(0.78727, 5);
    for (const gone of ['depositsBrlCents', 'withdrawalsBrlCents', 'realProfitBrlCents', 'realProfitUsdCentsApprox', 'platformBalanceEstimatedBrlCents']) {
      expect(data).not.toHaveProperty(gone);
    }
  });

  test('o valor em R$ informativo dos aportes e saques não altera o lucro (D226)', async () => {
    getDb().prepare('UPDATE deposits SET amount_brl_cents = 1 WHERE amount_store_cents IS NOT NULL').run();
    getDb().prepare('UPDATE withdrawals SET amount_brl_cents = NULL WHERE store_id IS NOT NULL').run();
    expect((await summary()).realProfitUsdCents).toBe(21859);
  });

  test('referência só em USD: sem o aporte B, o saque sem loja e a Steam, o lucro seria 24196 e exato', async () => {
    getDb().prepare('DELETE FROM deposits WHERE amount_store_cents IS NULL').run();
    getDb().prepare('DELETE FROM withdrawals WHERE store_id IS NULL').run();
    getDb().prepare('DELETE FROM store_balances WHERE store_id = ?').run(ids.steam);
    getDb().prepare("DELETE FROM items WHERE name = 'estoque brl' OR name = 'H'").run();
    const data = await summary();
    expect(data.realProfitUsdCents).toBe(24196);
    expect(data.estimated).toBe(false);
    expect(data.estimatedParts).toEqual({
      deposits: false, withdrawals: false, platformBalance: false, pendingBalance: false, releasedAfterBalance: false, stock: false,
    });
  });

  test('balancesByStore tem o formato do /current', async () => {
    const data = await summary();
    const current = (await request(app).get('/api/store-balances/current')).body.data;
    expect(data.balancesByStore).toEqual(current.stores);
  });

  test('warnings: objetos com source, storeId, storeName, code e text (BALANCE_MAYBE_OUTDATED da CSFloat e da Steam)', async () => {
    const data = await summary();
    expect(data.warnings).toEqual([
      { source: 'STORE', storeId: ids.csf, storeName: 'CSFloat', code: 'BALANCE_MAYBE_OUTDATED', text: expect.any(String) },
      { source: 'STORE', storeId: ids.steam, storeName: 'Steam', code: 'BALANCE_MAYBE_OUTDATED', text: expect.any(String) },
    ]);
  });

  test('loja não sacável entra no lucro e trocar allowsWithdrawal não muda nada', async () => {
    const before = await summary();
    getDb().prepare('UPDATE stores SET allows_withdrawal = 1 WHERE id = ?').run(ids.steam);
    getDb().prepare('UPDATE stores SET allows_withdrawal = 0 WHERE id = ?').run(ids.csf);
    const after = await summary();
    expect(after.realProfitUsdCents).toBe(21859);
    expect(after.realProfitUsdCents).toBe(before.realProfitUsdCents);
    expect(after.platformBalanceUsdCents).toBe(13191);
  });

  test('mudar a taxa de saque da loja não muda o resumo', async () => {
    getDb().prepare('UPDATE stores SET withdrawal_fee_rate = 0.5 WHERE id = ?').run(ids.csf);
    expect((await summary()).realProfitUsdCents).toBe(21859);
  });

  test('a taxa paga reduz só o saque líquido; sem taxa informada conta 0 e aparece em counts', async () => {
    getDb().prepare('UPDATE withdrawals SET fee_cents = NULL WHERE store_id IS NOT NULL').run();
    const data = await summary();
    expect(data.withdrawalsNetUsdCents).toBe(10000 + 1841);
    expect(data.realProfitUsdCents).toBe(21859 + 250);
    expect(data.counts.withdrawalsWithoutFee).toBe(1);
  });

  test('unsell de uma venda pendente tira o valor do pendente e do lucro na hora', async () => {
    const g = getDb().prepare("SELECT id FROM items WHERE name = 'G'").get().id;
    expect((await request(app).post(`/api/items/${g}/unsell`).send({})).status).toBe(200);
    const data = await summary();
    // G (3000 USD) sai do pendente e volta ao estoque com custo 0 (GANHEI): CSFloat 4500 + CSMoney 1000
    expect(data.pendingBalanceUsdCents).toBe(4500 + 1000);
    expect(data.realProfitUsdCents).toBe(21859 - 3000);
    expect(data.counts.pendingSales).toBe(3);
  });
});

describe('GET /api/profit/summary: sem cotação', () => {
  beforeEach(() => { freshDb(); app = makeApp(D206_NOW); });

  test('pendente em loja USD sem cotação: parcela exata e lucro calculado; só o "≈ R$" some', async () => {
    const csf = storeId('CSFloat');
    Item.create(wonSkin({
      name: 'P', ...soldFields(csf, { soldAt: '2026-11-20T18:00:00.000Z', netReceivedCents: 2500, saleHoldDaysApplied: 7 }),
    }), { now: D206_NOW });
    const data = await summary();
    expect(data.pendingBalanceUsdCents).toBe(2500);
    expect(data.platformBalanceUsdCents).toBe(0);
    expect(data.realProfitUsdCents).toBe(2500);
    expect(data.approxBrl.pendingBalance).toBeNull();
    expect(data.approxBrl.realProfit).toBeNull();
    expect(data.warnings.some((w) => w.code === 'FX_NOT_CONFIGURED')).toBe(false);
  });

  test('saldo da Steam (BRL) sem cotação: parcela e lucro nulos, aviso FX_NOT_CONFIGURED da loja', async () => {
    const steam = storeId('Steam');
    StoreBalance.create({ storeId: steam, balanceCents: 4590, fxRate: null, recordedAt: '2026-11-21T09:00:00.000Z' }, { now: D206_NOW });
    const data = await summary();
    expect(data.platformBalanceUsdCents).toBeNull();
    expect(data.realProfitUsdCents).toBeNull();
    expect(data.warnings).toContainEqual({ source: 'STORE', storeId: steam, storeName: 'Steam', code: 'FX_NOT_CONFIGURED', text: expect.any(String) });
  });

  test('liberado após o registro em loja USD sem cotação: exato, lucro calculado', async () => {
    const csf = storeId('CSFloat');
    StoreBalance.create({ storeId: csf, balanceCents: 0, fxRate: null, recordedAt: '2026-11-01T12:00:00.000Z' }, { now: D206_NOW });
    Item.create(wonSkin({
      name: 'R', ...soldFields(csf, { soldAt: '2026-11-10T12:00:00.000Z', netReceivedCents: 2500, saleHoldDaysApplied: 7 }),
    }), { now: D206_NOW });
    const data = await summary();
    expect(data.releasedAfterBalanceUsdCents).toBe(2500);
    expect(data.realProfitUsdCents).toBe(2500);
    expect(data.warnings.map((w) => w.code)).toEqual(['BALANCE_MAYBE_OUTDATED']);
  });

  test('estoque USD com custo > 0 sem cotação: exato, sem aviso de estoque', async () => {
    Item.create(wonSkin({
      name: 'S', acquisitionType: 'COMPRA', purchaseStoreId: storeId('CSFloat'), purchasePriceCents: 1000, purchaseCurrency: 'USD', status: 'EM_ESTOQUE',
    }), { now: D206_NOW });
    const data = await summary();
    expect(data.stockUsdCents).toBe(1000);
    expect(data.realProfitUsdCents).toBe(1000);
    expect(data.warnings.some((w) => w.source === 'STOCK')).toBe(false);
  });

  test('aporte legado e saque sem loja sem cotação: nulos, lucro nulo e avisos DEPOSITS e WITHDRAWALS', async () => {
    Deposit.create({ storeId: null, amountStoreCents: null, amountBrlCents: 1000, depositedAt: '2026-11-01T12:00:00.000Z', note: null }, { now: D206_NOW });
    Withdrawal.create({ amountBrlCents: 500, withdrawnAt: '2026-11-02T12:00:00.000Z' }, { now: D206_NOW });
    const data = await summary();
    expect(data.depositsUsdCents).toBeNull();
    expect(data.withdrawalsNetUsdCents).toBeNull();
    expect(data.realProfitUsdCents).toBeNull();
    expect(data.warnings.map((w) => w.source).sort()).toEqual(['DEPOSITS', 'WITHDRAWALS']);
    expect(data.counts).toMatchObject({ legacyDeposits: 1, legacyWithdrawals: 1 });
  });

  test('aporte novo em USD sem cotação é exato e o lucro segue', async () => {
    Deposit.create({ storeId: storeId('CSFloat'), amountStoreCents: 1000, amountBrlCents: null, depositedAt: '2026-11-01T12:00:00.000Z', note: null }, { now: D206_NOW });
    const data = await summary();
    expect(data.depositsUsdCents).toBe(1000);
    expect(data.realProfitUsdCents).toBe(-1000);
  });
});

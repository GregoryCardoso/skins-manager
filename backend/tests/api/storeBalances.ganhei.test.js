// 8.6 (D239): GANHEI com loja informativa nunca afeta o saldo calculado; COMPRA sempre desconta da loja de compra.
// Vale pela API (/current e /summary).
const request = require('supertest');
const Item = require('../../src/models/Item');
const Deposit = require('../../src/models/Deposit');
const Setting = require('../../src/models/Setting');
const { closeDb } = require('../../src/config/database');
const { freshDb, wonSkin } = require('../helpers/fixtures');
const { makeApp, storeId } = require('../helpers/apiFixtures');

const NOW = new Date('2026-11-21T12:00:00.000Z');
let app;
let csf;
beforeEach(() => {
  freshDb();
  app = makeApp(NOW);
  csf = storeId('CSFloat');
  Setting.update({ usdBrlRate: 5 }, { now: NOW });
  Deposit.create({ storeId: csf, amountStoreCents: 10000, amountBrlCents: null, depositedAt: '2026-11-15T12:00:00.000Z', note: null }, { now: NOW });
});
afterAll(() => closeDb());

const current = async () => (await request(app).get('/api/store-balances/current')).body.data.stores.find((s) => s.storeName === 'CSFloat');
const summary = async () => (await request(app).get('/api/profit/summary')).body.data;
const gift = (o = {}) => Item.create(wonSkin({ name: 'presente', purchaseStoreId: csf, acquiredAt: '2026-11-20T12:00:00.000Z', status: 'EM_ESTOQUE', ...o }), { now: NOW });
const purchase = (o = {}) => Item.create(wonSkin({
  name: 'compra', acquisitionType: 'COMPRA', purchaseStoreId: csf, purchasePriceCents: 500, purchaseCurrency: 'USD',
  acquiredAt: '2026-11-20T12:00:00.000Z', status: 'EM_ESTOQUE', ...o,
}), { now: NOW });

test('GANHEI com loja, depois do aporte: o disponível não muda, sem aviso em /current e em /summary', async () => {
  gift();
  expect(await current()).toMatchObject({ availableCents: 10000, breakdown: { purchasesCents: 0 }, warningCode: null });
  expect((await summary()).warnings).toEqual([]);
});

test('COMPRA na mesma loja depois do aporte: desconta do disponível, também no /summary', async () => {
  purchase();
  expect(await current()).toMatchObject({ availableCents: 9500, breakdown: { purchasesCents: 500 }, warningCode: null });
  expect((await summary()).platformBalanceUsdCents).toBe(9500);
});

test('GANHEI + COMPRA: só a COMPRA desconta; toda COMPRA desconta, de qualquer data (sem corte por data)', async () => {
  gift();
  purchase({ acquiredAt: '2026-11-20T13:00:00.000Z' });
  purchase({ name: 'antiga', acquiredAt: '2026-11-14T13:00:00.000Z' });
  expect((await current()).availableCents).toBe(9000);
});

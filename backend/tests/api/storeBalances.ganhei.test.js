// Revisão final da Etapa 8 (D215): GANHEI com loja informativa não dispara o aviso de saldo desatualizado,
// também pela API (/current e /summary); COMPRA na mesma situação dispara.
const request = require('supertest');
const Item = require('../../src/models/Item');
const StoreBalance = require('../../src/models/StoreBalance');
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
  StoreBalance.create({ storeId: csf, balanceCents: 10000, fxRate: null, recordedAt: '2026-11-15T12:00:00.000Z' }, { now: NOW });
});
afterAll(() => closeDb());

const current = async () => (await request(app).get('/api/store-balances/current')).body.data.stores.find((s) => s.storeName === 'CSFloat');
const summary = async () => (await request(app).get('/api/profit/summary')).body.data;
const csfWarnings = (data) => data.warnings.filter((w) => w.code === 'BALANCE_MAYBE_OUTDATED' && w.storeName === 'CSFloat');
const gift = (o = {}) => Item.create(wonSkin({ name: 'presente', purchaseStoreId: csf, acquiredAt: '2026-11-20T12:00:00.000Z', status: 'EM_ESTOQUE', ...o }), { now: NOW });
const purchase = (o = {}) => Item.create(wonSkin({
  name: 'compra', acquisitionType: 'COMPRA', purchaseStoreId: csf, purchasePriceCents: 500, purchaseCurrency: 'USD',
  acquiredAt: '2026-11-20T12:00:00.000Z', status: 'EM_ESTOQUE', ...o,
}), { now: NOW });

test('GANHEI com loja, depois do saldo: sem aviso em /current e em /summary', async () => {
  gift();
  expect(await current()).toMatchObject({ outdated: false, outdatedReasons: [], warningCode: null });
  expect(csfWarnings(await summary())).toEqual([]);
});

test('COMPRA na mesma loja depois do saldo: ACTIVITY_AFTER_BALANCE em /current e aviso em /summary', async () => {
  purchase();
  expect(await current()).toMatchObject({ outdated: true, outdatedReasons: ['ACTIVITY_AFTER_BALANCE'], warningCode: 'BALANCE_MAYBE_OUTDATED' });
  expect(csfWarnings(await summary())).toHaveLength(1);
});

test('GANHEI + COMPRA: só a COMPRA conta (um único motivo)', async () => {
  gift();
  expect((await current()).outdatedReasons).toEqual([]);
  purchase({ acquiredAt: '2026-11-20T13:00:00.000Z' });
  expect((await current()).outdatedReasons).toEqual(['ACTIVITY_AFTER_BALANCE']);
});

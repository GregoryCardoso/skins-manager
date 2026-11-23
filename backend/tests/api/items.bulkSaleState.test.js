// 9.5.1a (D332, D334): holding em lote no inventário agrupado e QTD do grupo inteiro. Banco :memory: novo a cada teste.
const request = require('supertest');
const { closeDb, getDb } = require('../../src/config/database');
const { freshDb } = require('../helpers/fixtures');
const { makeCatalogApp, storeId, purchaseBody, createItemViaApi, expectError, NOW, CAT } = require('../helpers/apiFixtures');
const { pickUnitsForSaleState } = require('../../src/services/inventoryGroupService');

let app;
beforeEach(() => { freshDb(); app = makeCatalogApp(); });
afterAll(() => closeDb());

const DAY = 86400000;
const iso = (days) => new Date(NOW.getTime() + days * DAY).toISOString();
const groups = async (query = '') => (await request(app).get(`/api/items/groups${query}`)).body.data;
const create = (overrides = {}) => createItemViaApi(app, purchaseBody({ acquiredAt: iso(-40), ...overrides }));
const bulk = (dir, body) => request(app).post(`/api/items/bulk/${dir}`).set('Content-Type', 'application/json').send(body);
const state = () => Object.fromEntries(getDb().prepare('SELECT id, off_sale_at, for_sale_since FROM items').all().map((r) => [r.id, r]));

async function fiveCases() {
  const ids = [];
  for (let i = 0; i < 5; i += 1) ids.push((await create({ catalogId: CAT.CASE_REVOLVER, acquiredAt: iso(-50 + i) })).id); // ids[0] = mais antiga
  return ids;
}

describe('pickUnitsForSaleState (pura)', () => {
  const u = (id, days, extra = {}) => ({ id, status: 'EM_ESTOQUE', acquiredAt: iso(days), offSaleAt: null, ...extra });
  test('holding leva as mais recentes; a volta traz as mais antigas; sem quantidade, todas', () => {
    const units = [u(1, -10), u(2, -5), u(3, -1), u(4, -20, { offSaleAt: iso(-2) }), u(5, -30, { offSaleAt: iso(-2) }), u(6, -1, { status: 'VENDIDO' })];
    expect(pickUnitsForSaleState(units, { direction: 'OFF_SALE', quantity: 2 })).toEqual({ available: 3, picked: [3, 2] });
    expect(pickUnitsForSaleState(units, { direction: 'FOR_SALE', quantity: 1 })).toEqual({ available: 2, picked: [5] });
    expect(pickUnitsForSaleState(units, { direction: 'OFF_SALE' }).picked).toEqual([3, 2, 1]);
  });
  test('quantidade acima do disponível ou nada disponível: exceeded', () => {
    expect(pickUnitsForSaleState([u(1, -1)], { direction: 'OFF_SALE', quantity: 2 })).toEqual({ available: 1, exceeded: true });
    expect(pickUnitsForSaleState([u(1, -1)], { direction: 'FOR_SALE' })).toEqual({ available: 0, exceeded: true });
  });
});

describe('POST /api/items/bulk/off-sale e /bulk/for-sale por grupo', () => {
  test('move N de uma vez (as mais recentes) e volta as mais antigas; QTD = total do grupo nas duas abas', async () => {
    const ids = await fiveCases();
    const { key } = (await groups()).groups[0];
    const res = await bulk('off-sale', { groupKey: key, quantity: 3 });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ movedIds: [ids[4], ids[3], ids[2]], movedCount: 3, unchangedCount: 0 });
    const s = state();
    expect(ids.map((id) => s[id].off_sale_at !== null)).toEqual([false, false, true, true, true]);

    const forSale = (await groups('?saleState=FOR_SALE')).groups[0];
    expect(forSale).toMatchObject({ quantity: 5, stock: { total: 5, forSale: 2, offSale: 3 } });
    expect(forSale.units).toHaveLength(2);

    const back = await bulk('for-sale', { groupKey: key, quantity: 2 });
    expect(back.body.data.movedIds).toEqual([ids[2], ids[3]]);
    const after = state();
    expect(after[ids[2]]).toMatchObject({ off_sale_at: null, for_sale_since: NOW.toISOString() });
    expect(after[ids[4]].off_sale_at).not.toBeNull();
  });

  test('sem quantidade: todas as disponíveis', async () => {
    await fiveCases();
    const { key } = (await groups()).groups[0];
    expect((await bulk('off-sale', { groupKey: key })).body.data.movedCount).toBe(5);
    expect((await groups('?saleState=FOR_SALE')).groups).toEqual([]);
    expect((await bulk('for-sale', { groupKey: key })).body.data.movedCount).toBe(5);
  });

  test('quantidade acima do disponível: 409 BULK_QUANTITY_EXCEEDS_AVAILABLE e nada muda', async () => {
    await fiveCases();
    const { key } = (await groups()).groups[0];
    const before = state();
    const res = await bulk('off-sale', { groupKey: key, quantity: 6 });
    expectError(res, 409, 'BULK_QUANTITY_EXCEEDS_AVAILABLE', { field: 'quantity' });
    expect(res.body.error.params).toEqual({ available: 5 });
    expect(state()).toEqual(before);
    expectError(await bulk('for-sale', { groupKey: key }), 409, 'BULK_QUANTITY_EXCEEDS_AVAILABLE');
    expectError(await bulk('off-sale', { groupKey: 'nao-existe' }), 409, 'BULK_QUANTITY_EXCEEDS_AVAILABLE');
  });

  test('unidade em trade lock também vai para o holding; vendidas nunca', async () => {
    const locked = await create({ catalogId: CAT.CASE_REVOLVER, tradeUnlockAt: iso(3) });
    const sold = await create({ catalogId: CAT.CASE_REVOLVER });
    await request(app).post(`/api/items/${sold.id}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 200, soldAt: NOW.toISOString() });
    const { key } = (await groups()).groups[0];
    expect((await bulk('off-sale', { groupKey: key })).body.data.movedIds).toEqual([locked.id]);
  });
});

describe('por seleção (itemIds)', () => {
  test('move só as marcadas; as que já estavam no estado contam como sem mudança', async () => {
    const ids = await fiveCases();
    await request(app).post(`/api/items/${ids[0]}/off-sale`).send({});
    const res = await bulk('off-sale', { itemIds: [ids[0], ids[1], ids[3]] });
    expect(res.body.data).toEqual({ movedIds: [ids[1], ids[3]], movedCount: 2, unchangedCount: 1 });
    expect((await bulk('for-sale', { itemIds: [ids[1]] })).body.data.movedCount).toBe(1);
  });

  test('id inexistente ou vendido: erro e nada muda (tudo ou nada)', async () => {
    const ids = await fiveCases();
    await request(app).post(`/api/items/${ids[4]}/sell`).send({ saleStoreId: storeId('CSFloat'), salePriceCents: 200, soldAt: NOW.toISOString() });
    const before = state();
    const missing = await bulk('off-sale', { itemIds: [ids[0], 9999] });
    expectError(missing, 404, 'ITEM_NOT_FOUND');
    expect(missing.body.error.params).toEqual({ itemId: 9999 });
    expectError(await bulk('off-sale', { itemIds: [ids[0], ids[4]] }), 409, 'ITEM_ALREADY_SOLD');
    expect(state()).toEqual(before);
  });
});

describe('validação', () => {
  test.each([
    [{}, 'INVALID_FIELD', 'groupKey'],
    [{ groupKey: 'x', itemIds: [1] }, 'INVALID_FIELD', 'itemIds'],
    [{ groupKey: '' }, 'INVALID_FIELD', 'groupKey'],
    [{ groupKey: 'x', quantity: 0 }, 'INVALID_FIELD', 'quantity'],
    [{ groupKey: 'x', quantity: 1.5 }, 'INVALID_FIELD', 'quantity'],
    [{ itemIds: [] }, 'INVALID_FIELD', 'itemIds'],
    [{ itemIds: [1, 1] }, 'INVALID_FIELD', 'itemIds'],
    [{ itemIds: [1], quantity: 1 }, 'INVALID_FIELD', 'quantity'],
    [{ groupKey: 'x', extra: 1 }, 'UNKNOWN_FIELD', 'extra'],
  ])('%j -> %s', async (body, code, field) => {
    expectError(await bulk('off-sale', body), 400, code, { field });
  });

  test('exige JSON', async () => {
    const res = await request(app).post('/api/items/bulk/off-sale').set('Content-Type', 'text/plain').send('x');
    expect(res.status).toBe(415);
  });
});

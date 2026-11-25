// 10.8 (M1, QA): o custo efetivo da arma separada aparece igual no inventário, na venda, na lista de vendas e no lucro real.
// Banco em memória; sem rede.
const request = require('supertest');
const { freshDb } = require('../helpers/fixtures');
const { closeDb } = require('../../src/config/database');
const { CAT, makeCatalogApp, purchaseBody, createItemViaApi, storeId } = require('../helpers/apiFixtures');

let app;
afterAll(() => closeDb());

const get = (url) => request(app).get(url);
const post = (url, body = {}) => request(app).post(url).send(body);
const SOLD_AT = '2026-11-18T12:00:00.000Z';
const DETACH_AT = '2026-11-17T12:00:00.000Z';

async function scenario({ detachShareBp = null, sellWeapon = true }) {
  freshDb();
  app = makeCatalogApp();
  await post('/api/deposits', { storeId: storeId('CSFloat'), amountStoreCents: 100000, depositedAt: '2026-11-01T12:00:00.000Z' });
  const ak = await createItemViaApi(app, purchaseBody({
    exterior: 'FT', floatValue: 0.2, purchasePriceCents: 1000, components: [{ kind: 'CHARM', catalogId: CAT.CHARM_LIL_AVA, pattern: 42 }],
  }));
  let detachedItem = null;
  let weaponAfterDetach = ak;
  if (detachShareBp !== null) {
    const hanging = ak.components.find((c) => c.kind === 'CHARM');
    const res = await post(`/api/items/${ak.id}/components/${hanging.id}/detach`, { detachedAt: DETACH_AT, hangingShareBp: detachShareBp });
    expect(res.status).toBe(201);
    detachedItem = res.body.data.detachedItem;
    weaponAfterDetach = res.body.data.item;
  }
  let sold = null;
  if (sellWeapon) {
    sold = await post(`/api/items/${ak.id}/sell`, { saleStoreId: storeId('CSFloat'), salePriceCents: 2000, soldAt: SOLD_AT });
    expect(sold.status).toBe(200);
  }
  const profit = (await get('/api/profit/summary')).body.data;
  return { ak, detachedItem, weaponAfterDetach, sold: sold && sold.body.data.item, profit };
}

describe('M1: custo efetivo da arma separada coerente nas telas', () => {
  test('inventário: a arma em estoque mostra o custo efetivo (menor que o próprio) e a flag, e a lista de estoque traz o mesmo', async () => {
    const { ak, weaponAfterDetach } = await scenario({ detachShareBp: 2000, sellWeapon: false });
    expect(weaponAfterDetach.cost).toMatchObject({ ownUsdCents: 1000, effectiveUsdCents: 800, inheritedUsdCents: -200, hasOperationCost: true });
    const listed = (await get('/api/items?status=EM_ESTOQUE')).body.data;
    const row = (listed.items ?? listed).find((i) => i.id === ak.id);
    expect(row.cost).toMatchObject({ effectiveUsdCents: 800, inheritedUsdCents: -200, hasOperationCost: true });
    expect(row.purchasePriceCents).toBe(1000); // o que a compra descontou da loja nunca muda
  });

  test('arma sem separação continua com a flag falsa e herdado 0 (nada muda para quem não usa)', async () => {
    const { weaponAfterDetach } = await scenario({ sellWeapon: false });
    expect(weaponAfterDetach.cost).toMatchObject({ ownUsdCents: 1000, effectiveUsdCents: 1000, inheritedUsdCents: 0, hasOperationCost: false });
  });

  test('vendas: item vendido e a lista de vendidos usam o mesmo custo efetivo, e o lucro da venda é líquido - efetivo', async () => {
    const { ak, sold } = await scenario({ detachShareBp: 2000 });
    expect(sold.cost).toMatchObject({ effectiveUsdCents: 800, inheritedUsdCents: -200, hasOperationCost: true });
    expect(sold.saleInfo).toMatchObject({ ownCostUsdCents: 1000, inheritedCostUsdCents: -200, purchaseCostUsdCents: 800 });
    expect(sold.saleProfitUsdCents).toBe(sold.saleInfo.netReceivedUsdCents - 800);
    const list = (await get('/api/items?status=VENDIDO')).body.data;
    const row = (list.items ?? list).find((i) => i.id === ak.id);
    expect(row.saleInfo.purchaseCostUsdCents).toBe(800);
    expect(row.saleProfitUsdCents).toBe(sold.saleProfitUsdCents);
    expect(row.cost).toMatchObject({ effectiveUsdCents: 800, hasOperationCost: true });
  });

  test('lucro real: com a separação e a venda da arma, o estoque é o chaveiro separado e o lucro real sobe exatamente o custo dele', async () => {
    const without = await scenario({ sellWeapon: true });
    const withDetach = await scenario({ detachShareBp: 2000, sellWeapon: true });
    // o saldo e o líquido da venda não dependem da separação
    expect(withDetach.profit.platformBalanceUsdCents).toBe(without.profit.platformBalanceUsdCents);
    expect(without.profit.stockUsdCents).toBe(0);
    expect(withDetach.profit.stockUsdCents).toBe(200); // o chaveiro separado, ainda em estoque, pelo custo dele
    // a venda da arma agora carrega só 800 de custo: o lucro realizado sobe 200 e o lucro real fica coerente com o estoque
    expect(withDetach.sold.saleProfitUsdCents - without.sold.saleProfitUsdCents).toBe(200);
    expect(withDetach.profit.realProfitUsdCents - without.profit.realProfitUsdCents).toBe(200);
    // as parcelas da venda coerentes entre si: custo efetivo da venda + custo do separado = custo próprio original
    expect(withDetach.sold.cost.effectiveUsdCents + withDetach.detachedItem.cost.effectiveUsdCents).toBe(without.sold.cost.effectiveUsdCents);
  });

  test('separar e vender a arma: o custo total (arma + separado) se conserva em qualquer porcentagem, inclusive nos extremos', async () => {
    for (const bp of [0, 1, 3333, 5000, 10000]) {
      const r = await scenario({ detachShareBp: bp, sellWeapon: true });
      expect(r.sold.cost.effectiveUsdCents + r.detachedItem.cost.effectiveUsdCents).toBe(1000);
      expect(r.sold.cost.effectiveUsdCents).toBeGreaterThanOrEqual(0);
      expect(r.sold.cost.hasOperationCost).toBe(r.sold.cost.ownUsdCents !== r.sold.cost.effectiveUsdCents); // 0 % e 0,01 % de 10,00 arredondam para 0: nada mudou
      if (bp === 10000) expect(r.sold.cost).toMatchObject({ effectiveUsdCents: 0, inheritedUsdCents: -1000, hasOperationCost: true });
    }
  });
});

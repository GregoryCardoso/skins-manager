'use strict';

// 8.9 (D283): estoque pelo custo dividido em à venda e holding. splitStockUsd puro e integração com computeRealProfit.
const { splitStockUsd, estimateStockUsd, computeRealProfit } = require('../../src/services/profitService');

const NOW = '2026-11-19T12:00:00.000Z';
const stock = (cost, currency = 'USD', extra = {}) => ({
  status: 'EM_ESTOQUE', acquisitionType: 'COMPRA', purchasePriceCents: cost, purchaseCurrency: currency,
  fxRateAtPurchase: currency === 'BRL' ? 5 : null, ...extra,
});
const holding = (cost, currency = 'USD', extra = {}) => stock(cost, currency, { offSaleAt: NOW, ...extra });

describe('splitStockUsd', () => {
  test('lista vazia: 0/0 em cada parte, sem estimativa', () => {
    expect(splitStockUsd([])).toEqual({
      forSale: { totalUsdCents: 0, estimated: false, count: 0 },
      offSale: { totalUsdCents: 0, estimated: false, count: 0 },
    });
  });

  test('separa à venda e holding, com contagem', () => {
    const r = splitStockUsd([stock(100), stock(250), holding(400)]);
    expect(r.forSale).toMatchObject({ totalUsdCents: 350, count: 2, estimated: false });
    expect(r.offSale).toMatchObject({ totalUsdCents: 400, count: 1, estimated: false });
  });

  test('forSale + offSale = total de estimateStockUsd (mistura USD/BRL, GANHEI, vendidos)', () => {
    const items = [
      stock(1000), stock(2500, 'BRL'), holding(333), holding(1001, 'BRL'),
      { status: 'EM_ESTOQUE', acquisitionType: 'GANHEI', purchasePriceCents: 0, purchaseCurrency: 'USD', fxRateAtPurchase: null },
      { ...holding(0), acquisitionType: 'GANHEI' },
      { status: 'VENDIDO', purchasePriceCents: 99999, purchaseCurrency: 'USD', fxRateAtPurchase: null },
      { status: 'VENDIDO', purchasePriceCents: 5000, purchaseCurrency: 'USD', fxRateAtPurchase: null, offSaleAt: NOW },
    ];
    const r = splitStockUsd(items);
    expect(r.forSale.totalUsdCents + r.offSale.totalUsdCents).toBe(estimateStockUsd(items).totalUsdCents);
    expect(r.forSale.count).toBe(3);
    expect(r.offSale.count).toBe(3);
  });

  test('"estimated" é por parte: só a que tem item em R$ convertido', () => {
    const r = splitStockUsd([stock(1000, 'USD'), holding(2500, 'BRL')]);
    expect(r.forSale).toMatchObject({ totalUsdCents: 1000, estimated: false });
    expect(r.offSale).toMatchObject({ totalUsdCents: 500, estimated: true });
  });

  test('cotação gravada na compra (não a atual) converte cada item em R$', () => {
    const r = splitStockUsd([
      stock(1000, 'BRL', { fxRateAtPurchase: 4 }), stock(1000, 'BRL', { fxRateAtPurchase: 5 }),
    ]);
    expect(r.forSale.totalUsdCents).toBe(250 + 200);
    expect(r.forSale.estimated).toBe(true);
  });

  test('GANHEI custa 0 e conta na quantidade', () => {
    const won = { status: 'EM_ESTOQUE', acquisitionType: 'GANHEI', purchasePriceCents: 0, purchaseCurrency: 'USD', fxRateAtPurchase: null };
    const r = splitStockUsd([won, { ...won, offSaleAt: NOW }]);
    expect(r.forSale).toMatchObject({ totalUsdCents: 0, count: 1, estimated: false });
    expect(r.offSale).toMatchObject({ totalUsdCents: 0, count: 1, estimated: false });
  });

  test('holding em trade lock conta em offSale; vendido (mesmo com offSaleAt) fica fora das duas partes', () => {
    const lockedHolding = holding(700, 'USD', { tradeUnlockAt: '2027-01-01T00:00:00.000Z' });
    const sold = { status: 'VENDIDO', purchasePriceCents: 900, purchaseCurrency: 'USD', fxRateAtPurchase: null, offSaleAt: NOW };
    const r = splitStockUsd([lockedHolding, sold]);
    expect(r.offSale).toMatchObject({ totalUsdCents: 700, count: 1 });
    expect(r.forSale).toMatchObject({ totalUsdCents: 0, count: 0 });
  });

  test('item em trade lock sem holding conta como à venda', () => {
    const r = splitStockUsd([stock(300, 'USD', { tradeUnlockAt: '2027-01-01T00:00:00.000Z' })]);
    expect(r.forSale).toMatchObject({ totalUsdCents: 300, count: 1 });
  });

  test('offSaleAt nulo não é holding', () => {
    const r = splitStockUsd([stock(100, 'USD', { offSaleAt: null })]);
    expect(r.forSale.count).toBe(1);
  });
});

describe('computeRealProfit com stockBreakdown', () => {
  const settings = { usdBrlRate: 5 };

  test('total e lucro real iguais com ou sem holding; breakdown soma o total; ≈ R$ pela cotação das configurações', () => {
    const plain = [stock(1000), stock(2500, 'BRL'), stock(400)];
    const withHolding = [stock(1000), holding(2500, 'BRL'), holding(400)];
    const a = computeRealProfit({ stockItems: plain, settings });
    const b = computeRealProfit({ stockItems: withHolding, settings });
    expect(b.stockUsdCents).toBe(a.stockUsdCents);
    expect(b.realProfitUsdCents).toBe(a.realProfitUsdCents);
    expect(b.estimatedParts).toEqual(a.estimatedParts);
    expect(b.approxBrl).toEqual(a.approxBrl);
    const { forSale, offSale } = b.stockBreakdown;
    expect(forSale.usdCents + offSale.usdCents).toBe(b.stockUsdCents);
    expect(forSale).toEqual({ usdCents: 1000, estimated: false, approxBrl: 5000, count: 1 });
    expect(offSale).toEqual({ usdCents: 900, estimated: true, approxBrl: 4500, count: 2 });
  });

  test('sem cotação: approxBrl nulo nas duas partes, USD continua', () => {
    const r = computeRealProfit({ stockItems: [stock(1000), holding(400)], settings: { usdBrlRate: null } });
    expect(r.stockBreakdown.forSale).toMatchObject({ usdCents: 1000, approxBrl: null });
    expect(r.stockBreakdown.offSale).toMatchObject({ usdCents: 400, approxBrl: null });
  });

  test('sem itens: partes zeradas', () => {
    const r = computeRealProfit({ stockItems: [], settings });
    expect(r.stockBreakdown.forSale).toEqual({ usdCents: 0, estimated: false, approxBrl: 0, count: 0 });
    expect(r.stockBreakdown.offSale).toEqual({ usdCents: 0, estimated: false, approxBrl: 0, count: 0 });
  });
});

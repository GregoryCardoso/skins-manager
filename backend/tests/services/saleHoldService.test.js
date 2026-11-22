'use strict';

// 8.3 (D211, D214, D215): funções puras da retenção do saldo, com `now` fixo.
const { DAY_MS, computeSaleRelease, releaseInstantOf, splitStoreSales } = require('../../src/services/saleHoldService');

const SOLD_AT = '2026-11-20T18:00:00.000Z';
const SOLD_MS = Date.parse(SOLD_AT);
const RELEASE_MS = SOLD_MS + 7 * DAY_MS;
const RELEASE_ISO = '2026-11-27T18:00:00.000Z';
const at = (ms) => new Date(ms);

const sold = (extra = {}) => ({
  status: 'VENDIDO', saleStoreId: 1, soldAt: SOLD_AT, saleHoldDaysApplied: 7, netReceivedCents: 1000, ...extra,
});

describe('computeSaleRelease', () => {
  test('7 dias = soldAt + 7 x 86 400 000 ms', () => {
    expect(DAY_MS).toBe(86400000);
    expect(computeSaleRelease(sold(), at(SOLD_MS)).releasesAt).toBe(RELEASE_ISO);
  });

  test('1 ms antes da liberação: retida; na igualdade: liberada; depois: liberada', () => {
    expect(computeSaleRelease(sold(), at(RELEASE_MS - 1)).isHeld).toBe(true);
    expect(computeSaleRelease(sold(), at(RELEASE_MS)).isHeld).toBe(false);
    expect(computeSaleRelease(sold(), at(RELEASE_MS + 1)).isHeld).toBe(false);
  });

  test('snapshot 0: releasesAt = soldAt e liberada', () => {
    expect(computeSaleRelease(sold({ saleHoldDaysApplied: 0 }), at(SOLD_MS))).toEqual({ releasesAt: SOLD_AT, isHeld: false });
  });

  test('snapshot nulo (venda anterior à v6): releasesAt nulo e liberada', () => {
    expect(computeSaleRelease(sold({ saleHoldDaysApplied: null }), at(SOLD_MS))).toEqual({ releasesAt: null, isHeld: false });
    expect(computeSaleRelease(sold({ saleHoldDaysApplied: undefined }), at(SOLD_MS))).toEqual({ releasesAt: null, isHeld: false });
  });

  test('soldAt inválido ou nulo com snapshot: releasesAt nulo, sem lançar', () => {
    expect(computeSaleRelease(sold({ soldAt: null }), at(SOLD_MS))).toEqual({ releasesAt: null, isHeld: false });
    expect(computeSaleRelease(sold({ soldAt: 'lixo' }), at(SOLD_MS))).toEqual({ releasesAt: null, isHeld: false });
  });

  test('item em estoque (ou ausente) -> null', () => {
    expect(computeSaleRelease({ status: 'EM_ESTOQUE', soldAt: null, saleHoldDaysApplied: null }, at(SOLD_MS))).toBeNull();
    expect(computeSaleRelease(null, at(SOLD_MS))).toBeNull();
  });

  test('virada de dia: 2026-11-21T02:30Z (20/11 23:30 BRT) + 7 -> 2026-11-28T02:30Z', () => {
    const item = sold({ soldAt: '2026-11-21T02:30:00.000Z' });
    expect(computeSaleRelease(item, at(Date.parse('2026-11-21T02:30:00.000Z'))).releasesAt).toBe('2026-11-28T02:30:00.000Z');
  });

  test('sem now usa o relógio atual (venda antiga: liberada)', () => {
    expect(computeSaleRelease(sold({ soldAt: '2000-01-01T00:00:00.000Z' })).isHeld).toBe(false);
  });
});

describe('releaseInstantOf', () => {
  test('soldAt + retenção x 24 h; retenção nula vale 0; soldAt ausente ou inválido -> null', () => {
    expect(releaseInstantOf(sold())).toBe(RELEASE_MS);
    expect(releaseInstantOf(sold({ saleHoldDaysApplied: 0 }))).toBe(SOLD_MS);
    expect(releaseInstantOf(sold({ saleHoldDaysApplied: null }))).toBe(SOLD_MS);
    expect(releaseInstantOf(sold({ soldAt: null }))).toBeNull();
    expect(releaseInstantOf(sold({ soldAt: 'lixo' }))).toBeNull();
  });
});

// D239, D252: vendas liberadas e pendentes de uma loja num instante `at`, sem corte por data.
describe('splitStoreSales', () => {
  const run = (sales, _unused, atMs, storeId = 1) => splitStoreSales({ storeId, sales, at: at(atMs) });
  const NOW = Date.parse('2026-11-21T12:00:00.000Z');

  test('sem vendas: tudo zerado e nextReleaseAt nulo', () => {
    expect(run([], null, NOW)).toEqual({ released: { cents: 0, count: 0 }, pending: { cents: 0, count: 0, nextReleaseAt: null } });
  });

  test('retidas ficam pendentes e as já liberadas vão para liberadas', () => {
    const sales = [
      sold({ netReceivedCents: 100 }), // libera 27/11 18:00
      sold({ netReceivedCents: 40, soldAt: '2026-11-10T12:00:00.000Z' }), // libera 17/11 12:00
    ];
    const result = run(sales, null, NOW);
    expect(result.pending).toEqual({ cents: 100, count: 1, nextReleaseAt: RELEASE_ISO });
    expect(result.released).toEqual({ cents: 40, count: 1 });
  });

  test('venda antiga já liberada conta; venda feita há tempo e ainda retida fica pendente e depois vira liberada (sem contar duas vezes)', () => {
    const sale = sold({ soldAt: '2026-11-18T09:00:00.000Z', netReceivedCents: 3000 }); // libera 25/11 09:00
    const before = run([sale], null, NOW);
    expect(before.pending).toEqual({ cents: 3000, count: 1, nextReleaseAt: '2026-11-25T09:00:00.000Z' });
    expect(before.released.count).toBe(0);
    const after = run([sale], null, Date.parse('2026-11-26T00:00:00.000Z'));
    expect(after.pending.count).toBe(0);
    expect(after.released).toEqual({ cents: 3000, count: 1 });
    expect(run([sold({ soldAt: '2000-01-01T00:00:00.000Z' })], null, NOW).released.count).toBe(1);
  });

  test('liberação igual a `at` já está liberada; 1 ms antes, pendente', () => {
    expect(run([sold()], null, RELEASE_MS).released.count).toBe(1);
    expect(run([sold()], null, RELEASE_MS).pending.count).toBe(0);
    expect(run([sold()], null, RELEASE_MS - 1).pending.count).toBe(1);
  });

  test('venda posterior a `at` não entra', () => {
    expect(run([sold()], null, SOLD_MS - 1)).toEqual({ released: { cents: 0, count: 0 }, pending: { cents: 0, count: 0, nextReleaseAt: null } });
  });

  test('retenção 0 ou nula: liberada na hora da venda', () => {
    const sales = [sold({ saleHoldDaysApplied: 0 }), sold({ saleHoldDaysApplied: null })];
    expect(run(sales, null, SOLD_MS).released).toEqual({ cents: 2000, count: 2 });
  });

  test('outra loja, em estoque e soldAt nulo ou inválido não entram', () => {
    const sales = [sold({ saleStoreId: 2 }), { status: 'EM_ESTOQUE', saleStoreId: null }, sold({ soldAt: null }), sold({ soldAt: 'x' }), sold()];
    expect(run(sales, null, SOLD_MS).pending).toMatchObject({ count: 1, cents: 1000 });
  });

  test('nextReleaseAt é a menor liberação pendente; soma os centavos; a virada de dia UTC/BRT não muda nada', () => {
    const sales = [
      sold({ soldAt: '2026-11-20T18:00:00.000Z', netReceivedCents: 2500 }), // 27/11 18:00
      sold({ soldAt: '2026-11-21T01:30:00.000Z', netReceivedCents: 2000 }), // 28/11 01:30 (20/11 22:30 BRT)
      sold({ soldAt: '2026-11-18T09:00:00.000Z', netReceivedCents: 3000 }), // 25/11 09:00
      sold({ soldAt: '2026-11-10T12:00:00.000Z', netReceivedCents: 600 }), // 17/11 12:00
    ];
    const result = run(sales, null, NOW);
    expect(result.pending).toEqual({ cents: 7500, count: 3, nextReleaseAt: '2026-11-25T09:00:00.000Z' });
    expect(result.released).toEqual({ cents: 600, count: 1 });
  });

  test('aceita datas ISO como `at` e âncora', () => {
    expect(splitStoreSales({ storeId: 1, sales: [sold()], at: RELEASE_ISO }).released.count).toBe(1);
  });
});

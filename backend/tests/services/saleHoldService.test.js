'use strict';

// 8.3 (D211, D214, D215): funções puras da retenção do saldo, com `now` fixo.
const { DAY_MS, computeSaleRelease, computeHeldSalesForStore } = require('../../src/services/saleHoldService');

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

describe('computeHeldSalesForStore', () => {
  const run = (sales, latestBalance, now, storeId = 1) => computeHeldSalesForStore({ storeId, sales, latestBalance, now });
  const balanceAt = (iso) => ({ recordedAt: iso, balanceCents: 1 });

  test('sem vendas e sem saldo: duas categorias zeradas e datas nulas', () => {
    expect(run([], null, at(RELEASE_MS))).toEqual({
      pending: { cents: 0, count: 0, nextReleaseAt: null },
      releasedAfterBalance: { cents: 0, count: 0, earliestReleasedAt: null },
    });
  });

  test('sem saldo registrado: retidas em pending, já liberadas em releasedAfterBalance', () => {
    const sales = [
      sold({ netReceivedCents: 100 }), // libera 27/11 18:00
      sold({ netReceivedCents: 40, soldAt: '2026-11-10T12:00:00.000Z' }), // libera 17/11 12:00
    ];
    const result = run(sales, null, at(Date.parse('2026-11-21T12:00:00.000Z')));
    expect(result.pending).toEqual({ cents: 100, count: 1, nextReleaseAt: RELEASE_ISO });
    expect(result.releasedAfterBalance).toEqual({ cents: 40, count: 1, earliestReleasedAt: '2026-11-17T12:00:00.000Z' });
  });

  test('venda feita antes do registro e liberada depois conta (G e F de D206)', () => {
    const recorded = balanceAt('2026-11-20T15:00:00.000Z');
    const g = sold({ soldAt: '2026-11-18T09:00:00.000Z', netReceivedCents: 3000 }); // libera 25/11 09:00
    const f = sold({ soldAt: '2026-11-13T20:00:00.000Z', netReceivedCents: 1200 }); // libera 20/11 20:00
    const result = run([g, f], recorded, at(Date.parse('2026-11-21T12:00:00.000Z')));
    expect(result.pending).toMatchObject({ cents: 3000, count: 1, nextReleaseAt: '2026-11-25T09:00:00.000Z' });
    expect(result.releasedAfterBalance).toMatchObject({ cents: 1200, count: 1, earliestReleasedAt: '2026-11-20T20:00:00.000Z' });
  });

  test('releasesAt igual ao recordedAt NAO conta; 1 ms depois conta', () => {
    const now = at(RELEASE_MS + DAY_MS);
    const equal = run([sold()], balanceAt(RELEASE_ISO), now);
    expect(equal.pending.count + equal.releasedAfterBalance.count).toBe(0);
    const oneMs = run([sold()], balanceAt(new Date(RELEASE_MS - 1).toISOString()), now);
    expect(oneMs.releasedAfterBalance).toMatchObject({ count: 1, cents: 1000 });
  });

  test('soldAt igual ao recordedAt com retenção 7: conta como pendente', () => {
    const result = run([sold()], balanceAt(SOLD_AT), at(SOLD_MS + 1000));
    expect(result.pending).toMatchObject({ count: 1, cents: 1000 });
  });

  test('releasesAt igual a now: liberado após o registro; now 1 ms antes: pendente', () => {
    const recorded = balanceAt('2026-11-20T00:00:00.000Z');
    expect(run([sold()], recorded, at(RELEASE_MS)).releasedAfterBalance.count).toBe(1);
    expect(run([sold()], recorded, at(RELEASE_MS)).pending.count).toBe(0);
    expect(run([sold()], recorded, at(RELEASE_MS - 1)).pending.count).toBe(1);
    expect(run([sold()], recorded, at(RELEASE_MS - 1)).releasedAfterBalance.count).toBe(0);
    // 1 ms depois de now = liberação: segue na mesma categoria
    expect(run([sold()], recorded, at(RELEASE_MS + 1)).releasedAfterBalance.count).toBe(1);
  });

  test('venda liberada antes do registro (D) não conta', () => {
    const d = sold({ soldAt: '2026-11-12T10:00:00.000Z', netReceivedCents: 1500 }); // libera 19/11 10:00
    const result = run([d], balanceAt('2026-11-20T15:00:00.000Z'), at(Date.parse('2026-11-21T12:00:00.000Z')));
    expect(result.pending.count + result.releasedAfterBalance.count).toBe(0);
  });

  test('registrar saldo novo depois da liberação tira a venda de releasedAfterBalance', () => {
    const sale = sold({ soldAt: '2026-11-13T20:00:00.000Z' }); // libera 20/11 20:00
    const now = at(Date.parse('2026-11-21T12:00:00.000Z'));
    expect(run([sale], balanceAt('2026-11-20T15:00:00.000Z'), now).releasedAfterBalance.count).toBe(1);
    expect(run([sale], balanceAt('2026-11-21T08:00:00.000Z'), now).releasedAfterBalance.count).toBe(0);
  });

  test('recordedAt futuro (mais tarde hoje): venda que libera entre now e esse instante não conta', () => {
    const now = at(Date.parse('2026-11-21T12:00:00.000Z'));
    const sale = sold({ soldAt: '2026-11-14T15:00:00.000Z' }); // libera 21/11 15:00, depois de now
    expect(run([sale], balanceAt('2026-11-21T20:00:00.000Z'), now).pending.count).toBe(0);
    expect(run([sale], balanceAt('2026-11-21T14:00:00.000Z'), now).pending.count).toBe(1);
  });

  test('vendas de outra loja, em estoque e sem loja não entram', () => {
    const sales = [sold({ saleStoreId: 2 }), { status: 'EM_ESTOQUE', saleStoreId: null }, sold()];
    expect(run(sales, null, at(SOLD_MS)).pending).toMatchObject({ count: 1, cents: 1000 });
  });

  test('retenção 0 ou nula nunca entra (H de D206)', () => {
    const sales = [sold({ saleHoldDaysApplied: 0 }), sold({ saleHoldDaysApplied: null })];
    const result = run(sales, null, at(SOLD_MS + 1));
    expect(result.pending.count + result.releasedAfterBalance.count).toBe(0);
  });

  test('nextReleaseAt e earliestReleasedAt são os menores; cada categoria soma centavos', () => {
    const now = at(Date.parse('2026-11-21T12:00:00.000Z'));
    const sales = [
      sold({ soldAt: '2026-11-20T18:00:00.000Z', netReceivedCents: 2500 }), // 27/11 18:00
      sold({ soldAt: '2026-11-21T01:30:00.000Z', netReceivedCents: 2000 }), // 28/11 01:30
      sold({ soldAt: '2026-11-18T09:00:00.000Z', netReceivedCents: 3000 }), // 25/11 09:00
      sold({ soldAt: '2026-11-10T12:00:00.000Z', netReceivedCents: 600 }), // 17/11 12:00
      sold({ soldAt: '2026-11-11T12:00:00.000Z', netReceivedCents: 7 }), // 18/11 12:00
    ];
    const result = run(sales, null, now);
    expect(result.pending).toEqual({ cents: 7500, count: 3, nextReleaseAt: '2026-11-25T09:00:00.000Z' });
    expect(result.releasedAfterBalance).toEqual({ cents: 607, count: 2, earliestReleasedAt: '2026-11-17T12:00:00.000Z' });
  });

  test('soldAt nulo com retenção > 0 é ignorado, sem lançar', () => {
    expect(run([sold({ soldAt: null })], null, at(SOLD_MS)).pending.count).toBe(0);
  });
});

'use strict';

const {
  daysBetween,
  classifyStock,
  classifyTurnaround,
  toSaoPauloDate,
  assertAcquiredAtNotFuture,
  getAging,
  sortByAge,
  sortByTurnaround,
  filterStagnant,
  listingStart,
  resolveAgingThresholds,
} = require('../../src/services/inventoryAgingService');
const { ValidationError } = require('../../src/errors/AppError');

const NOW = new Date('2026-11-19T12:00:00.000Z');
const DAY = 86400000;
const MIN = 60000;
const ago = (ms, from = NOW) => new Date(from.getTime() - ms).toISOString();
const SLOW = 21;
const TH = { fastTurnoverDays: 7, slowItemDays: SLOW };

const stock = (id, days, extra = {}) => ({ id, status: 'EM_ESTOQUE', acquiredAt: ago(days * DAY), ...extra });
const sold = (id, turnaroundDays, extra = {}) => {
  const acquiredAt = '2026-10-01T12:00:00.000Z';
  const soldAt = new Date(Date.parse(acquiredAt) + turnaroundDays * DAY).toISOString();
  return { id, status: 'VENDIDO', acquiredAt, soldAt, ...extra };
};

describe('inventoryAgingService — faixas de estoque (slow = 21)', () => {
  test('7 dias → RECENTE', () => {
    expect(getAging(stock(1, 7), { thresholds: TH, now: NOW })).toEqual({ daysInInventory: 7, daysForSale: 7, agingBucket: 'RECENTE' });
  });

  test('7d 23h59 → RECENTE (floor)', () => {
    const item = { id: 1, status: 'EM_ESTOQUE', acquiredAt: ago(8 * DAY - MIN) };
    expect(getAging(item, { thresholds: TH, now: NOW })).toEqual({ daysInInventory: 7, daysForSale: 7, agingBucket: 'RECENTE' });
  });

  test.each([
    [8, 'EM_GIRO'],
    [21, 'EM_GIRO'],
    [22, 'AGARRADO'],
  ])('%i dias → %s', (days, bucket) => {
    expect(getAging(stock(1, days), { thresholds: TH, now: NOW })).toEqual({ daysInInventory: days, daysForSale: days, agingBucket: bucket });
  });

  test('SLOW_ITEM_DAYS customizado 30: 22 dias → EM_GIRO; 31 → AGARRADO', () => {
    expect(getAging(stock(1, 22), { thresholds: { fastTurnoverDays: 7, slowItemDays: 30 }, now: NOW }).agingBucket).toBe('EM_GIRO');
    expect(getAging(stock(1, 30), { thresholds: { fastTurnoverDays: 7, slowItemDays: 30 }, now: NOW }).agingBucket).toBe('EM_GIRO');
    expect(getAging(stock(1, 31), { thresholds: { fastTurnoverDays: 7, slowItemDays: 30 }, now: NOW }).agingBucket).toBe('AGARRADO');
  });

  test('T81: sem thresholds lança Error de programação (não lê o banco nem o .env)', () => {
    expect(() => classifyStock(21)).toThrow(Error);
    expect(() => getAging(stock(1, 3), { now: NOW })).toThrow(Error);
    expect(() => filterStagnant([], undefined, NOW)).toThrow(Error);
  });

  test('acquiredAt minutos após now no mesmo dia → 0 dias (RECENTE)', () => {
    const item = { id: 1, status: 'EM_ESTOQUE', acquiredAt: new Date(NOW.getTime() + 5 * MIN).toISOString() };
    expect(getAging(item, { thresholds: TH, now: NOW })).toEqual({ daysInInventory: 0, daysForSale: 0, agingBucket: 'RECENTE' });
    expect(daysBetween(item.acquiredAt, NOW)).toBe(0);
  });
});

describe('inventoryAgingService — giro dos vendidos', () => {
  test.each([
    [7, 'GIRO_RAPIDO'],
    [8, 'GIRO_NORMAL'],
    [21, 'GIRO_NORMAL'],
    [22, 'DEMOROU_VENDER'],
  ])('vendido em %i dias → %s', (days, bucket) => {
    expect(getAging(sold(1, days), { thresholds: TH, now: NOW })).toEqual({ turnaroundDays: days, turnaroundBucket: bucket, daysHeld: days });
  });

  test('vendido ignora now', () => {
    const item = sold(1, 10);
    const a = getAging(item, { thresholds: TH, now: NOW });
    const b = getAging(item, { thresholds: TH, now: new Date('2030-01-01T00:00:00.000Z') });
    expect(a).toEqual(b);
  });
});

describe('inventoryAgingService — limites configuráveis (D159)', () => {
  test.each([
    [{ fastTurnoverDays: 0, slowItemDays: 21 }],
    [{ fastTurnoverDays: 7, slowItemDays: 7 }],
    [{ fastTurnoverDays: 10, slowItemDays: 7 }],
    [{ fastTurnoverDays: 7, slowItemDays: 366 }],
    [{ fastTurnoverDays: 7.5, slowItemDays: 21 }],
    [{ fastTurnoverDays: '7', slowItemDays: 21 }],
    [{ fastTurnoverDays: 7 }],
    [null],
  ])('limites %p → erro de programação', (th) => {
    expect(() => classifyStock(10, th)).toThrow();
    expect(() => classifyTurnaround(10, th)).toThrow();
  });

  test('fronteiras com F=7/S=21: 7 rápido, 8 e 21 mediano, 22 lento', () => {
    const th = { fastTurnoverDays: 7, slowItemDays: 21 };
    expect([7, 8, 21, 22].map((d) => classifyStock(d, th))).toEqual(['RECENTE', 'EM_GIRO', 'EM_GIRO', 'AGARRADO']);
    expect([7, 8, 21, 22].map((d) => classifyTurnaround(d, th))).toEqual([
      'GIRO_RAPIDO', 'GIRO_NORMAL', 'GIRO_NORMAL', 'DEMOROU_VENDER',
    ]);
  });

  test('fronteiras com F=1/S=2 (1, 2, 3), em estoque e vendido', () => {
    const th = { fastTurnoverDays: 1, slowItemDays: 2 };
    expect([0, 1, 2, 3].map((d) => classifyStock(d, th))).toEqual(['RECENTE', 'RECENTE', 'EM_GIRO', 'AGARRADO']);
    expect([1, 2, 3].map((d) => classifyTurnaround(d, th))).toEqual(['GIRO_RAPIDO', 'GIRO_NORMAL', 'DEMOROU_VENDER']);
    expect(getAging(stock(1, 3), { thresholds: th, now: NOW }).agingBucket).toBe('AGARRADO');
    expect(getAging(sold(1, 2), { thresholds: th, now: NOW }).turnaroundBucket).toBe('GIRO_NORMAL');
  });

  test('F=14/S=30 desloca as faixas', () => {
    const th = { fastTurnoverDays: 14, slowItemDays: 30 };
    expect(classifyStock(14, th)).toBe('RECENTE');
    expect(classifyStock(15, th)).toBe('EM_GIRO');
    expect(classifyStock(31, th)).toBe('AGARRADO');
  });

  test('T81: classifyTurnaround sem limites lança', () => {
    expect(() => classifyTurnaround(22)).toThrow(Error);
  });

  describe('resolveAgingThresholds (salvaguarda de leitura)', () => {
    test('nulos usam 7 e o .env', () => {
      expect(resolveAgingThresholds({ envSlowItemDays: 21 })).toEqual({ fastTurnoverDays: 7, slowItemDays: 21, adjusted: false });
    });
    test('valores salvos prevalecem', () => {
      expect(resolveAgingThresholds({ fastSaved: 3, slowSaved: 10, envSlowItemDays: 21 })).toEqual({
        fastTurnoverDays: 3, slowItemDays: 10, adjusted: false,
      });
    });
    test('combinação incoerente → rápido = agarrado − 1 e adjusted', () => {
      expect(resolveAgingThresholds({ fastSaved: 10, envSlowItemDays: 8 })).toEqual({
        fastTurnoverDays: 7, slowItemDays: 8, adjusted: true,
      });
      expect(resolveAgingThresholds({ envSlowItemDays: 5 })).toEqual({ fastTurnoverDays: 4, slowItemDays: 5, adjusted: true });
      expect(resolveAgingThresholds({ envSlowItemDays: 2 })).toEqual({ fastTurnoverDays: 1, slowItemDays: 2, adjusted: true });
    });
  });
});

describe('inventoryAgingService — giro desde a liberação do trade lock (D160)', () => {
  const unlockAgo = (d) => ago(d * DAY);
  const unlockIn = (d) => new Date(NOW.getTime() + d * DAY).toISOString();

  test('listingStart: tradeUnlockAt posterior a acquiredAt vence; anterior ou nulo usa acquiredAt', () => {
    expect(listingStart({ acquiredAt: '2026-11-01T00:00:00.000Z', tradeUnlockAt: '2026-11-08T00:00:00.000Z' })).toBe('2026-11-08T00:00:00.000Z');
    expect(listingStart({ acquiredAt: '2026-11-10T00:00:00.000Z', tradeUnlockAt: '2026-11-08T00:00:00.000Z' })).toBe('2026-11-10T00:00:00.000Z');
    expect(listingStart({ acquiredAt: '2026-11-10T00:00:00.000Z', tradeUnlockAt: null })).toBe('2026-11-10T00:00:00.000Z');
    expect(listingStart({ acquiredAt: '2026-11-10T00:00:00.000Z' })).toBe('2026-11-10T00:00:00.000Z');
  });

  test('em estoque liberado: daysForSale conta da liberação; daysInInventory da aquisição', () => {
    const item = stock(1, 20, { tradeUnlockAt: unlockAgo(13) });
    expect(getAging(item, { thresholds: TH, now: NOW })).toEqual({ daysInInventory: 20, daysForSale: 13, agingBucket: 'EM_GIRO' });
  });

  test('item de 30 dias com lock de 10 dias não é agarrado com S=21', () => {
    const item = stock(1, 30, { tradeUnlockAt: unlockAgo(20) });
    expect(getAging(item, { thresholds: TH, now: NOW }).agingBucket).toBe('EM_GIRO');
  });

  test('now antes do tradeUnlockAt → EM_TRADE_LOCK sem dias à venda', () => {
    const item = stock(1, 2, { tradeUnlockAt: unlockIn(5) });
    expect(getAging(item, { thresholds: TH, now: NOW })).toEqual({ daysInInventory: 2, daysForSale: null, agingBucket: 'EM_TRADE_LOCK' });
  });

  test('now igual a tradeUnlockAt → liberado, 0 dias, RECENTE', () => {
    const item = stock(1, 7, { tradeUnlockAt: NOW.toISOString() });
    expect(getAging(item, { thresholds: TH, now: NOW })).toEqual({ daysInInventory: 7, daysForSale: 0, agingBucket: 'RECENTE' });
  });

  test('1 ms depois do tradeUnlockAt → liberado com 0 dias', () => {
    const item = stock(1, 10, { tradeUnlockAt: new Date(NOW.getTime() - 1).toISOString() });
    expect(getAging(item, { thresholds: TH, now: NOW }).daysForSale).toBe(0);
  });

  test('tradeUnlockAt anterior à aquisição conta de acquiredAt', () => {
    const item = stock(1, 9, { tradeUnlockAt: unlockAgo(30) });
    expect(getAging(item, { thresholds: TH, now: NOW })).toEqual({ daysInInventory: 9, daysForSale: 9, agingBucket: 'EM_GIRO' });
  });

  test('vendido com tradeUnlockAt: turnaround menor que daysHeld', () => {
    const item = sold(1, 15, { tradeUnlockAt: '2026-10-08T12:00:00.000Z' });
    expect(getAging(item, { thresholds: TH, now: NOW })).toEqual({ turnaroundDays: 8, turnaroundBucket: 'GIRO_NORMAL', daysHeld: 15 });
  });

  test('vendido com soldAt antes do tradeUnlockAt (dado antigo) → 0 dias, GIRO_RAPIDO, sem erro', () => {
    const item = sold(1, 3, { tradeUnlockAt: '2026-10-20T12:00:00.000Z' });
    expect(getAging(item, { thresholds: TH, now: NOW })).toEqual({ turnaroundDays: 0, turnaroundBucket: 'GIRO_RAPIDO', daysHeld: 3 });
  });

  test('vendido com tradeUnlockAt futuro nunca vira EM_TRADE_LOCK', () => {
    const item = sold(1, 3, { tradeUnlockAt: '2030-01-01T00:00:00.000Z' });
    expect(getAging(item, { thresholds: TH, now: NOW })).toEqual({ turnaroundDays: 0, turnaroundBucket: 'GIRO_RAPIDO', daysHeld: 3 });
  });

  test('sortByAge: itens em lock vão ao fim nas duas direções, por tradeUnlockAt crescente e depois id', () => {
    const lockLater = stock(10, 1, { tradeUnlockAt: unlockIn(5) });
    const lockSooner = stock(11, 1, { tradeUnlockAt: unlockIn(2) });
    const lockTie = stock(9, 1, { tradeUnlockAt: unlockIn(2) });
    const items = [lockLater, stock(2, 3), lockSooner, stock(1, 30), lockTie];
    expect(sortByAge(items, 'desc', NOW).map((i) => i.id)).toEqual([1, 2, 9, 11, 10]);
    expect(sortByAge(items, 'asc', NOW).map((i) => i.id)).toEqual([2, 1, 9, 11, 10]);
  });

  test('sortByAge usa o instante da liberação, não a aquisição', () => {
    const a = stock(1, 30, { tradeUnlockAt: unlockAgo(5) }); // à venda há 5
    const b = stock(2, 10); // à venda há 10
    expect(sortByAge([a, b], 'desc', NOW).map((i) => i.id)).toEqual([2, 1]);
  });

  test('filterStagnant ignora itens em lock e conta da liberação', () => {
    const locked = stock(1, 40, { tradeUnlockAt: unlockIn(1) });
    const lateUnlock = stock(2, 40, { tradeUnlockAt: unlockAgo(5) });
    const stagnant = stock(3, 40, { tradeUnlockAt: unlockAgo(25) });
    expect(filterStagnant([locked, lateUnlock, stagnant], TH, NOW).map((i) => i.id)).toEqual([3]);
  });

  test('sortByTurnaround usa a contagem desde a liberação', () => {
    const a = sold(1, 20, { tradeUnlockAt: '2026-10-16T12:00:00.000Z' }); // 5 dias
    const b = sold(2, 10); // 10 dias
    expect(sortByTurnaround([b, a], 'asc').map((i) => i.id)).toEqual([1, 2]);
    expect(sortByTurnaround([a, b], 'desc').map((i) => i.id)).toEqual([2, 1]);
  });

  test('GANHEI segue a mesma regra', () => {
    const item = stock(1, 12, { acquisitionType: 'GANHEI', tradeUnlockAt: unlockAgo(4) });
    expect(getAging(item, { thresholds: TH, now: NOW }).daysForSale).toBe(4);
  });
});

describe('inventoryAgingService — ordenação e filtro', () => {
  test('sortByAge desc, desempate por id ASC, não muta a entrada', () => {
    const items = [stock(3, 5), stock(1, 30), stock(4, 10), stock(2, 10)];
    const copy = JSON.parse(JSON.stringify(items));
    const sorted = sortByAge(items, 'desc', NOW);
    expect(sorted.map((i) => i.id)).toEqual([1, 2, 4, 3]);
    expect(items).toEqual(copy);
  });

  test('sortByAge asc', () => {
    const items = [stock(3, 5), stock(1, 30), stock(4, 10), stock(2, 10)];
    expect(sortByAge(items, 'asc', NOW).map((i) => i.id)).toEqual([3, 2, 4, 1]);
  });

  test('sortByAge padrão é desc', () => {
    const items = [stock(1, 5), stock(2, 30)];
    expect(sortByAge(items, undefined, NOW).map((i) => i.id)).toEqual([2, 1]);
  });

  test('sortByTurnaround asc, desempate por id ASC, não muta a entrada', () => {
    const items = [sold(5, 20), sold(2, 3), sold(9, 10), sold(1, 10)];
    const copy = JSON.parse(JSON.stringify(items));
    expect(sortByTurnaround(items, 'asc').map((i) => i.id)).toEqual([2, 1, 9, 5]);
    expect(sortByTurnaround(items).map((i) => i.id)).toEqual([2, 1, 9, 5]);
    expect(sortByTurnaround(items, 'desc').map((i) => i.id)).toEqual([5, 1, 9, 2]);
    expect(items).toEqual(copy);
  });

  test('filterStagnant exclui vendidos e não agarrados', () => {
    const items = [stock(1, 22), stock(2, 21), stock(3, 3), sold(4, 40), stock(5, 100)];
    expect(filterStagnant(items, TH, NOW).map((i) => i.id)).toEqual([1, 5]);
  });

  test('filterStagnant com SLOW_ITEM_DAYS customizado (30)', () => {
    const items = [stock(1, 22), stock(2, 31)];
    expect(filterStagnant(items, { fastTurnoverDays: 7, slowItemDays: 30 }, NOW).map((i) => i.id)).toEqual([2]);
  });
});

describe('inventoryAgingService — P8 (aquisição futura, America/Sao_Paulo)', () => {
  const code = expect.objectContaining({ name: 'ValidationError', code: 'ACQUIRED_AT_IN_FUTURE' });

  test('toSaoPauloDate', () => {
    expect(toSaoPauloDate('2026-11-20T02:59:00Z')).toBe('2026-11-19');
    expect(toSaoPauloDate('2026-11-20T03:00:00Z')).toBe('2026-11-20');
    expect(toSaoPauloDate(new Date('2026-11-20T03:00:00Z'))).toBe('2026-11-20');
  });

  describe('now = 2026-11-19T15:00:00Z (12:00 BRT)', () => {
    const now = new Date('2026-11-19T15:00:00Z');

    test('2026-11-20T02:59:00Z (23:59 BRT do dia 19) aceito', () => {
      expect(() => assertAcquiredAtNotFuture('2026-11-20T02:59:00Z', now)).not.toThrow();
    });

    test('2026-11-20T02:59:59.999Z aceito', () => {
      expect(() => assertAcquiredAtNotFuture('2026-11-20T02:59:59.999Z', now)).not.toThrow();
    });

    test('2026-11-20T03:00:00Z (00:00 BRT do dia 20) recusado', () => {
      expect(() => assertAcquiredAtNotFuture('2026-11-20T03:00:00Z', now)).toThrow(code);
    });

    test('data passada aceita', () => {
      expect(() => assertAcquiredAtNotFuture('2026-01-01T00:00:00Z', now)).not.toThrow();
    });

    test('data inválida → ValidationError', () => {
      expect(() => assertAcquiredAtNotFuture('ontem', now)).toThrow(ValidationError);
      expect(() => assertAcquiredAtNotFuture(null, now)).toThrow(ValidationError);
    });
  });

  test('virada UTC: now = 2026-11-20T02:30:00Z (23:30 BRT do dia 19)', () => {
    const now = new Date('2026-11-20T02:30:00Z');
    expect(() => assertAcquiredAtNotFuture('2026-11-20T02:59:00Z', now)).not.toThrow();
    expect(() => assertAcquiredAtNotFuture('2026-11-20T03:00:00Z', now)).toThrow(code);
  });

  test('virada UTC: now = 2026-11-20T03:30:00Z (00:30 BRT do dia 20)', () => {
    const now = new Date('2026-11-20T03:30:00Z');
    expect(() => assertAcquiredAtNotFuture('2026-11-20T23:00:00Z', now)).not.toThrow();
    expect(() => assertAcquiredAtNotFuture('2026-11-21T03:00:00Z', now)).toThrow(code);
  });
});

describe('assertNotFutureDay com anos < 1000 (comparação numérica)', () => {
  const { assertNotFutureDay, toSaoPauloDate } = require('../../src/services/inventoryAgingService');
  const opts = { code: 'X', message: 'm' };
  const now = new Date('2026-11-19T15:00:00.000Z');
  test.each(['0999-06-01T00:00:00Z', '0100-01-01T00:00:00Z'])('%s é passado', (d) => {
    expect(() => assertNotFutureDay(new Date(d), now, opts)).not.toThrow();
  });
  test('dia seguinte em São Paulo continua futuro; mesmo dia civil passa', () => {
    expect(() => assertNotFutureDay(new Date('2026-11-20T03:00:00Z'), now, opts)).toThrow();
    expect(() => assertNotFutureDay(new Date('2026-11-20T02:59:00Z'), now, opts)).not.toThrow();
  });
  test('toSaoPauloDate devolve ano com 4 dígitos', () => {
    expect(toSaoPauloDate(new Date('0999-06-01T12:00:00Z'))).toBe('0999-06-01');
  });
});

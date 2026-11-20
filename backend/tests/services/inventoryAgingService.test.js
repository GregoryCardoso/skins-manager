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
} = require('../../src/services/inventoryAgingService');
const { ValidationError } = require('../../src/errors/AppError');

const NOW = new Date('2026-11-19T12:00:00.000Z');
const DAY = 86400000;
const MIN = 60000;
const ago = (ms, from = NOW) => new Date(from.getTime() - ms).toISOString();
const SLOW = 21;

const stock = (id, days, extra = {}) => ({ id, status: 'EM_ESTOQUE', acquiredAt: ago(days * DAY), ...extra });
const sold = (id, turnaroundDays, extra = {}) => {
  const acquiredAt = '2026-10-01T12:00:00.000Z';
  const soldAt = new Date(Date.parse(acquiredAt) + turnaroundDays * DAY).toISOString();
  return { id, status: 'VENDIDO', acquiredAt, soldAt, ...extra };
};

describe('inventoryAgingService — faixas de estoque (slow = 21)', () => {
  test('7 dias → RECENTE', () => {
    expect(getAging(stock(1, 7), { slowItemDays: SLOW, now: NOW })).toEqual({ daysInInventory: 7, agingBucket: 'RECENTE' });
  });

  test('7d 23h59 → RECENTE (floor)', () => {
    const item = { id: 1, status: 'EM_ESTOQUE', acquiredAt: ago(8 * DAY - MIN) };
    expect(getAging(item, { slowItemDays: SLOW, now: NOW })).toEqual({ daysInInventory: 7, agingBucket: 'RECENTE' });
  });

  test.each([
    [8, 'EM_GIRO'],
    [21, 'EM_GIRO'],
    [22, 'AGARRADO'],
  ])('%i dias → %s', (days, bucket) => {
    expect(getAging(stock(1, days), { slowItemDays: SLOW, now: NOW })).toEqual({ daysInInventory: days, agingBucket: bucket });
  });

  test('SLOW_ITEM_DAYS customizado 30: 22 dias → EM_GIRO; 31 → AGARRADO', () => {
    expect(getAging(stock(1, 22), { slowItemDays: 30, now: NOW }).agingBucket).toBe('EM_GIRO');
    expect(getAging(stock(1, 30), { slowItemDays: 30, now: NOW }).agingBucket).toBe('EM_GIRO');
    expect(getAging(stock(1, 31), { slowItemDays: 30, now: NOW }).agingBucket).toBe('AGARRADO');
  });

  test('padrão slowItemDays vem do env (21)', () => {
    expect(classifyStock(21)).toBe('EM_GIRO');
    expect(classifyStock(22)).toBe('AGARRADO');
  });

  test('acquiredAt minutos após now no mesmo dia → 0 dias (RECENTE)', () => {
    const item = { id: 1, status: 'EM_ESTOQUE', acquiredAt: new Date(NOW.getTime() + 5 * MIN).toISOString() };
    expect(getAging(item, { slowItemDays: SLOW, now: NOW })).toEqual({ daysInInventory: 0, agingBucket: 'RECENTE' });
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
    expect(getAging(sold(1, days), { slowItemDays: SLOW, now: NOW })).toEqual({ turnaroundDays: days, turnaroundBucket: bucket });
  });

  test('vendido ignora now', () => {
    const item = sold(1, 10);
    const a = getAging(item, { slowItemDays: SLOW, now: NOW });
    const b = getAging(item, { slowItemDays: SLOW, now: new Date('2030-01-01T00:00:00.000Z') });
    expect(a).toEqual(b);
  });
});

describe('inventoryAgingService — P4 (SLOW_ITEM_DAYS mínimo 8)', () => {
  test.each([7, 8.5, 0, '21', null])('slowItemDays %p → erro', (slow) => {
    expect(() => classifyStock(10, slow)).toThrow();
    expect(() => classifyTurnaround(10, slow)).toThrow();
  });

  test('slowItemDays 8: 7 → RECENTE, 8 → EM_GIRO, 9 → AGARRADO', () => {
    expect(classifyStock(7, 8)).toBe('RECENTE');
    expect(classifyStock(8, 8)).toBe('EM_GIRO');
    expect(classifyStock(9, 8)).toBe('AGARRADO');
    expect(classifyTurnaround(7, 8)).toBe('GIRO_RAPIDO');
    expect(classifyTurnaround(8, 8)).toBe('GIRO_NORMAL');
    expect(classifyTurnaround(9, 8)).toBe('DEMOROU_VENDER');
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
    expect(filterStagnant(items, SLOW, NOW).map((i) => i.id)).toEqual([1, 5]);
  });

  test('filterStagnant com SLOW_ITEM_DAYS customizado (30)', () => {
    const items = [stock(1, 22), stock(2, 31)];
    expect(filterStagnant(items, 30, NOW).map((i) => i.id)).toEqual([2]);
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

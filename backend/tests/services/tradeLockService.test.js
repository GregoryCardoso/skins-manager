'use strict';

const { getTradeLockStatus, formatRemaining } = require('../../src/services/tradeLockService');
const { ValidationError } = require('../../src/errors/AppError');

const NOW = new Date('2026-11-19T12:00:00.000Z');
const MIN = 60000;
const plus = (ms) => new Date(NOW.getTime() + ms).toISOString();

describe('tradeLockService.getTradeLockStatus', () => {
  test('null → Liberado', () => {
    expect(getTradeLockStatus(null, NOW)).toEqual({ isLocked: false, remainingMs: 0, formatted: 'Liberado', tradeUnlockAt: null });
  });

  test('undefined → Liberado', () => {
    expect(getTradeLockStatus(undefined, NOW)).toMatchObject({ isLocked: false, remainingMs: 0, formatted: 'Liberado' });
  });

  test('now == unlock → Liberado', () => {
    expect(getTradeLockStatus(NOW.toISOString(), NOW)).toMatchObject({ isLocked: false, remainingMs: 0, formatted: 'Liberado' });
  });

  test('now após unlock (no passado) → Liberado', () => {
    expect(getTradeLockStatus(plus(-5 * MIN), NOW)).toMatchObject({ isLocked: false, remainingMs: 0, formatted: 'Liberado' });
  });

  test('faltando 2d 14h 20min exatos → "2d 14h 20min restantes" e remainingMs correto', () => {
    const ms = (2 * 1440 + 14 * 60 + 20) * MIN;
    expect(getTradeLockStatus(plus(ms), NOW)).toEqual({
      isLocked: true,
      remainingMs: ms,
      formatted: '2d 14h 20min restantes',
      tradeUnlockAt: plus(ms),
    });
  });

  test('30 s → "1min restantes"', () => {
    const r = getTradeLockStatus(plus(30000), NOW);
    expect(r.isLocked).toBe(true);
    expect(r.remainingMs).toBe(30000);
    expect(r.formatted).toBe('1min restantes');
  });

  test('1 ms → "1min restantes" (nunca 0min enquanto bloqueado)', () => {
    expect(getTradeLockStatus(plus(1), NOW).formatted).toBe('1min restantes');
  });

  test('3h 4min 1s → "3h 5min restantes"', () => {
    expect(getTradeLockStatus(plus((3 * 60 + 4) * MIN + 1000), NOW).formatted).toBe('3h 5min restantes');
  });

  test('exatamente 1 dia → "1d 0h 0min restantes"', () => {
    expect(getTradeLockStatus(plus(1440 * MIN), NOW).formatted).toBe('1d 0h 0min restantes');
  });

  test('data inválida → ValidationError', () => {
    expect(() => getTradeLockStatus('não é data', NOW)).toThrow(ValidationError);
    expect(() => getTradeLockStatus(new Date('x'), NOW)).toThrow(ValidationError);
  });

  test('aceita Date e string (mesmo resultado)', () => {
    const iso = plus(90 * MIN);
    expect(getTradeLockStatus(new Date(iso), NOW)).toEqual(getTradeLockStatus(iso, NOW));
    expect(getTradeLockStatus(iso, NOW.toISOString()).formatted).toBe('1h 30min restantes');
  });
});

describe('tradeLockService.formatRemaining', () => {
  test('formatos', () => {
    expect(formatRemaining(20 * MIN)).toBe('20min restantes');
    expect(formatRemaining(60 * MIN)).toBe('1h 0min restantes');
    expect(formatRemaining((1440 + 5) * MIN)).toBe('1d 0h 5min restantes');
  });
});

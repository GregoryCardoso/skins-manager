'use strict';

const { nextAction, WINDOW_MS, MAX_RESTARTS, DELAYS_MS } = require('../src/lib/restartPolicy');

const T0 = 1_000_000;
const MIN = 60 * 1000;

describe('restartPolicy: janela deslizante', () => {
  test('quedas espaçadas de 2 min nunca desistem (as antigas saem da janela)', () => {
    const crashes = [];
    for (let i = 0; i < 10; i += 1) {
      const now = T0 + i * 2 * MIN;
      crashes.push(now);
      expect(nextAction({ crashTimes: crashes, now }).action).toBe('restart');
    }
  });

  test('4 quedas em 4 min desistem; quando a mais antiga sai da janela, volta a reiniciar', () => {
    const crashTimes = [T0, T0 + MIN, T0 + 2 * MIN, T0 + 4 * MIN];
    expect(nextAction({ crashTimes, now: T0 + 4 * MIN }).action).toBe('give-up');
    expect(nextAction({ crashTimes, now: T0 + 5 * MIN }).action).toBe('restart');
    expect(nextAction({ crashTimes, now: T0 + 5 * MIN - 1 }).action).toBe('give-up');
  });

  test('a espera usa as quedas DENTRO da janela, não o total', () => {
    const crashTimes = [T0, T0 + 1000, T0 + 2000, T0 + 10 * MIN];
    expect(nextAction({ crashTimes, now: T0 + 10 * MIN })).toEqual({ action: 'restart', delayMs: 1000, attempt: 1 });
  });

  test('3 quedas ainda reiniciam; a 4a não', () => {
    expect(nextAction({ crashTimes: [T0, T0, T0], now: T0 }).action).toBe('restart');
    expect(nextAction({ crashTimes: [T0, T0, T0, T0], now: T0 }).action).toBe('give-up');
  });

  test('constantes da política', () => {
    expect(MAX_RESTARTS).toBe(3);
    expect(WINDOW_MS).toBe(5 * MIN);
    expect([...DELAYS_MS]).toEqual([1000, 3000, 9000]);
    expect(Object.isFrozen(DELAYS_MS)).toBe(true);
  });
});

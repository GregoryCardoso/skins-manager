'use strict';

const { nextAction, pruneCrashes, WINDOW_MS } = require('../src/lib/restartPolicy');

const T0 = 1_000_000;

describe('restartPolicy.nextAction', () => {
  test('1a, 2a e 3a queda: reinicia com 1 s, 3 s e 9 s', () => {
    expect(nextAction({ crashTimes: [T0], now: T0 })).toEqual({ action: 'restart', delayMs: 1000, attempt: 1 });
    expect(nextAction({ crashTimes: [T0, T0 + 10], now: T0 + 10 })).toEqual({ action: 'restart', delayMs: 3000, attempt: 2 });
    expect(nextAction({ crashTimes: [T0, T0 + 10, T0 + 20], now: T0 + 20 })).toEqual({ action: 'restart', delayMs: 9000, attempt: 3 });
  });

  test('4a queda dentro de 5 minutos: desiste', () => {
    const crashTimes = [T0, T0 + 1000, T0 + 2000, T0 + 3000];
    expect(nextAction({ crashTimes, now: T0 + 3000 })).toEqual({ action: 'give-up', crashes: 4 });
  });

  test('quedas fora da janela de 5 minutos não contam', () => {
    const crashTimes = [T0, T0 + 1000, T0 + 2000, T0 + WINDOW_MS + 5000];
    expect(nextAction({ crashTimes, now: T0 + WINDOW_MS + 5000 })).toEqual({ action: 'restart', delayMs: 1000, attempt: 1 });
  });

  test('queda exatamente no limite da janela já saiu dela', () => {
    expect(pruneCrashes([T0], T0 + WINDOW_MS)).toEqual([]);
    expect(pruneCrashes([T0], T0 + WINDOW_MS - 1)).toEqual([T0]);
  });

  test('aceita Date em now', () => {
    expect(nextAction({ crashTimes: [T0], now: new Date(T0) }).action).toBe('restart');
  });
});

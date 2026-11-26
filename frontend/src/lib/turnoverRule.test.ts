import { describe, expect, test } from 'vitest';
import { PIN_MAX_PERCENT, PIN_MIN_PERCENT, boundaryPercents, pinPercent, ruleSegments, type TurnoverLimits } from './turnoverRule';

const DEFAULT: TurnoverLimits = { fastTurnoverDays: 7, slowItemDays: 21 };
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe('ruleSegments', () => {
  test('7/21: 7 : 14 : 14 sobre 35 (20%, 40%, 40%)', () => {
    const [a, b, c] = ruleSegments(DEFAULT);
    expect(a).toBeCloseTo(0.2, 6);
    expect(b).toBeCloseTo(0.4, 6);
    expect(c).toBeCloseTo(0.4, 6);
  });

  test('as frações sempre somam 1', () => {
    for (const limits of [DEFAULT, { fastTurnoverDays: 1, slowItemDays: 365 }, { fastTurnoverDays: 20, slowItemDays: 21 }, { fastTurnoverDays: 100, slowItemDays: 101 }]) {
      expect(sum(ruleSegments(limits))).toBeCloseTo(1, 9);
    }
  });

  test('mínimo de 12% por faixa com 1/365 (a primeira faixa seria 0,1%)', () => {
    const [a, b, c] = ruleSegments({ fastTurnoverDays: 1, slowItemDays: 365 });
    expect(a).toBeCloseTo(0.12, 6);
    expect(b).toBeCloseTo(0.44, 6);
    expect(c).toBeCloseTo(0.44, 6);
  });

  test('mínimo de 12% com 20/21 (as duas últimas faixas seriam 4,5%)', () => {
    const [a, b, c] = ruleSegments({ fastTurnoverDays: 20, slowItemDays: 21 });
    expect(b).toBeCloseTo(0.12, 6);
    expect(c).toBeCloseTo(0.12, 6);
    expect(a).toBeCloseTo(0.76, 6);
  });
});

describe('pinPercent (os quatro valores do protótipo, com 7/21)', () => {
  test('4 dias: 11,4%', () => expect(pinPercent({ days: 4, bucket: 'RECENTE', limits: DEFAULT })).toBeCloseTo(11.4, 1));
  test('13 dias: 37,1%', () => expect(pinPercent({ days: 13, bucket: 'EM_GIRO', limits: DEFAULT })).toBeCloseTo(37.1, 1));
  test('26 dias: 74,3%', () => expect(pinPercent({ days: 26, bucket: 'AGARRADO', limits: DEFAULT })).toBeCloseTo(74.3, 1));
  test('31 dias: 88,6%', () => expect(pinPercent({ days: 31, bucket: 'AGARRADO', limits: DEFAULT })).toBeCloseTo(88.6, 1));
});

describe('pinPercent, casos de borda', () => {
  test('o pino fica na faixa do bucket, mesmo que os dias discordem', () => {
    // 30 dias com bucket RECENTE (limite trocado e cache velho): o pino fica no fim da primeira faixa (20%), não na terceira.
    expect(pinPercent({ days: 30, bucket: 'RECENTE', limits: DEFAULT })).toBeCloseTo(20, 6);
    // 2 dias com bucket AGARRADO: começo da terceira faixa (60%).
    expect(pinPercent({ days: 2, bucket: 'AGARRADO', limits: DEFAULT })).toBeCloseTo(60, 6);
    // 2 dias com bucket EM_GIRO: começo da segunda faixa (20%).
    expect(pinPercent({ days: 2, bucket: 'EM_GIRO', limits: DEFAULT })).toBeCloseTo(20, 6);
  });

  test('o pino fica entre 1,5% e 98,5%', () => {
    expect(pinPercent({ days: 0, bucket: 'RECENTE', limits: DEFAULT })).toBe(PIN_MIN_PERCENT);
    expect(pinPercent({ days: -5, bucket: 'RECENTE', limits: DEFAULT })).toBe(PIN_MIN_PERCENT);
    expect(pinPercent({ days: 35, bucket: 'AGARRADO', limits: DEFAULT })).toBe(PIN_MAX_PERCENT);
  });

  test('dias muito maiores que a escala ficam presos no fim', () => {
    expect(pinPercent({ days: 5000, bucket: 'AGARRADO', limits: DEFAULT })).toBe(PIN_MAX_PERCENT);
    expect(pinPercent({ days: 400, bucket: 'AGARRADO', limits: { fastTurnoverDays: 1, slowItemDays: 365 } })).toBeLessThanOrEqual(PIN_MAX_PERCENT);
  });

  test('dias não finitos caem no começo da faixa', () => {
    expect(pinPercent({ days: Number.NaN, bucket: 'EM_GIRO', limits: DEFAULT })).toBeCloseTo(20, 6);
  });

  test('com 1/365 e 20/21 o pino continua dentro da faixa do bucket', () => {
    const wide: TurnoverLimits = { fastTurnoverDays: 1, slowItemDays: 365 };
    const [a, b] = ruleSegments(wide);
    const middle = pinPercent({ days: 200, bucket: 'EM_GIRO', limits: wide });
    expect(middle).toBeGreaterThan(a * 100);
    expect(middle).toBeLessThan((a + b) * 100);
    const tight: TurnoverLimits = { fastTurnoverDays: 20, slowItemDays: 21 };
    const [t1] = ruleSegments(tight);
    expect(pinPercent({ days: 15, bucket: 'RECENTE', limits: tight })).toBeLessThan(t1 * 100);
  });
});

describe('boundaryPercents', () => {
  test('7/21: divisas em 20% e 60%', () => {
    const [first, second] = boundaryPercents(DEFAULT);
    expect(first).toBeCloseTo(20, 6);
    expect(second).toBeCloseTo(60, 6);
  });
});

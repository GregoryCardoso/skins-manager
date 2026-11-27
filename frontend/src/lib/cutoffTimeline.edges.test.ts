import { describe, expect, test } from 'vitest';
import { cutoffTimeline } from './cutoffTimeline';
import { tabFromHash } from './importsTabs';

const NOW = new Date('2026-11-27T12:00:00Z');

// 12.9 (QA): bordas de mesma data, fuso e eixo.
describe('cutoffTimeline: bordas', () => {
  test('o mesmo instante escrito em fusos diferentes é SAME (sem trecho)', () => {
    const g = cutoffTimeline('2026-10-01T00:00:00Z', '2026-09-30T21:00:00-03:00', NOW);
    expect(g.move).toBe('SAME');
    expect(g.segment).toBeNull();
    expect(g.currentPct).toBe(g.nextPct);
  });

  test('um segundo de diferença já é movimento (LATER) com trecho', () => {
    const g = cutoffTimeline('2026-10-01T00:00:00Z', '2026-10-01T00:00:01Z', NOW);
    expect(g.move).toBe('LATER');
    expect(g.segment).not.toBeNull();
    expect((g.segment as { fromPct: number; toPct: number }).toPct).toBeGreaterThan((g.segment as { fromPct: number }).fromPct);
  });

  test('data igual a "agora": eixo não degenera (0 a 100, sem NaN)', () => {
    const g = cutoffTimeline(NOW.toISOString(), NOW.toISOString(), NOW);
    for (const v of [g.currentPct, g.nextPct]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(g.move).toBe('SAME');
  });

  test('só a data nova (sem atual): marcador da nova e sem movimento', () => {
    const g = cutoffTimeline(null, '2026-10-01T00:00:00Z', NOW);
    expect(g.currentPct).toBeNull();
    expect(g.nextPct).not.toBeNull();
    expect(g.move).toBe('NONE');
    expect(g.segment).toBeNull();
  });

  test('uma data inválida e uma válida: só a válida ganha posição', () => {
    const g = cutoffTimeline('lixo', '2026-10-01T00:00:00Z', NOW);
    expect(g.currentPct).toBeNull();
    expect(g.nextPct).not.toBeNull();
    expect(g.move).toBe('NONE');
  });

  test('o trecho é sempre ordenado (de <= até) e as posições respeitam a ordem das datas', () => {
    for (const [a, b] of [['2026-01-01T00:00:00Z', '2026-11-01T00:00:00Z'], ['2026-11-01T00:00:00Z', '2026-01-01T00:00:00Z']] as const) {
      const g = cutoffTimeline(a, b, NOW);
      const seg = g.segment as { fromPct: number; toPct: number };
      expect(seg.fromPct).toBeLessThan(seg.toPct);
      expect(seg.fromPct).toBe(Math.min(g.currentPct as number, g.nextPct as number));
    }
  });
});

describe('tabFromHash: bordas', () => {
  test('só "#", maiúsculas e hash com sufixo desconhecido', () => {
    expect(tabFromHash('#')).toEqual({ tab: 'review', scrollTo: null });
    expect(tabFromHash('#CUTOFF')).toEqual({ tab: 'history', scrollTo: 'cutoff' });
    expect(tabFromHash('#cutoff-x')).toEqual({ tab: 'review', scrollTo: null });
    expect(tabFromHash('#ignored/')).toEqual({ tab: 'review', scrollTo: null });
  });
});

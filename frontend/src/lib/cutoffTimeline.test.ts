import { describe, expect, test } from 'vitest';
import { cutoffTimeline } from './cutoffTimeline';

const NOW = new Date('2026-11-27T12:00:00Z');

describe('cutoffTimeline', () => {
  test('sem datas: tudo nulo', () => {
    expect(cutoffTimeline(null, null, NOW)).toEqual({ currentPct: null, nextPct: null, segment: null, move: 'NONE' });
    expect(cutoffTimeline('x', 'y', NOW).move).toBe('NONE');
  });

  test('só a data atual: um marcador entre 0 e 100, sem trecho', () => {
    const g = cutoffTimeline('2026-10-01T00:00:00Z', null, NOW);
    expect(g.currentPct).toBeGreaterThan(0);
    expect(g.currentPct).toBeLessThan(100);
    expect(g.nextPct).toBeNull();
    expect(g.segment).toBeNull();
    expect(g.move).toBe('NONE');
  });

  test('data nova mais antiga: o corte recua e o trecho passa a ser importado', () => {
    const g = cutoffTimeline('2026-10-01T00:00:00Z', '2026-09-01T00:00:00Z', NOW);
    expect(g.move).toBe('EARLIER');
    expect(g.nextPct as number).toBeLessThan(g.currentPct as number);
    expect(g.segment).toEqual({ fromPct: g.nextPct, toPct: g.currentPct });
  });

  test('data nova mais recente: o corte avança e o trecho deixa de ser importado', () => {
    const g = cutoffTimeline('2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z', NOW);
    expect(g.move).toBe('LATER');
    expect(g.segment?.fromPct).toBe(g.currentPct);
  });

  test('datas iguais: SAME, sem trecho; ordem das posições acompanha a das datas', () => {
    expect(cutoffTimeline('2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', NOW).move).toBe('SAME');
    const g = cutoffTimeline('2026-11-20T00:00:00Z', '2026-10-01T00:00:00Z', NOW);
    expect(g.currentPct as number).toBeGreaterThan(g.nextPct as number);
  });

  test('data futura não sai do eixo (0 a 100)', () => {
    const g = cutoffTimeline('2026-10-01T00:00:00Z', '2027-05-01T00:00:00Z', NOW);
    expect(g.nextPct).toBeLessThanOrEqual(100);
    expect(g.currentPct).toBeGreaterThanOrEqual(0);
  });
});

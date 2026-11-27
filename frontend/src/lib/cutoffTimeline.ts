// Geometria da linha do tempo da data de corte (12.9). Só posição relativa (0 a 100) de duas datas e qual trecho muda de lado;
// nenhuma regra de negócio (a prévia do efeito vem do backend).

export type CutoffMove = 'EARLIER' | 'LATER' | 'SAME' | 'NONE';

export interface CutoffTimelineGeometry {
  // Posição (0 a 100) da data atual e da nova; nula quando a data não existe ou é inválida.
  currentPct: number | null;
  nextPct: number | null;
  // Trecho entre as duas datas (só quando as duas existem e são diferentes).
  segment: { fromPct: number; toPct: number } | null;
  // EARLIER: o corte recua (o trecho passa a ser importado). LATER: avança (o trecho deixa de ser importado).
  move: CutoffMove;
}

const DAY_MS = 86_400_000;

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

// O eixo vai de um pouco antes da data mais antiga até `now` (ou até a data mais nova, se ela passar de `now`).
export function cutoffTimeline(currentIso: string | null, nextIso: string | null, now: Date): CutoffTimelineGeometry {
  const current = toMs(currentIso);
  const next = toMs(nextIso);
  const dates = [current, next].filter((v): v is number => v !== null);
  if (dates.length === 0) return { currentPct: null, nextPct: null, segment: null, move: 'NONE' };

  const lo = Math.min(...dates);
  const hi = Math.max(now.getTime(), ...dates);
  const span = Math.max(hi - lo, DAY_MS);
  const start = lo - span * 0.15;
  const end = start + span * 1.15;
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - start) / (end - start)) * 100));

  const currentPct = current === null ? null : pct(current);
  const nextPct = next === null ? null : pct(next);
  if (current === null || next === null) return { currentPct, nextPct, segment: null, move: 'NONE' };
  if (current === next) return { currentPct, nextPct, segment: null, move: 'SAME' };
  const a = pct(Math.min(current, next));
  const b = pct(Math.max(current, next));
  return { currentPct, nextPct, segment: { fromPct: a, toPct: b }, move: next < current ? 'EARLIER' : 'LATER' };
}

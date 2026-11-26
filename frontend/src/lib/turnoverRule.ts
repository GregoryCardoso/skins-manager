// Geometria da régua de giro (D370, 12.3b). PURA e só visual: a faixa do item (`bucket`) vem do backend (`agingBucket`) e nunca é
// recalculada aqui; os limites vêm de GET /api/settings. Esta função só decide onde fica o pino e a largura de cada faixa.

export interface TurnoverLimits {
  // "Giro rápido até" (dias) e "agarrado acima de" (dias), das configurações. 1 <= fast < slow <= 365.
  fastTurnoverDays: number;
  slowItemDays: number;
}

// As três faixas com trilho. Os outros buckets (trade lock, holding, consumido) não têm pino.
export type RuleBucket = 'RECENTE' | 'EM_GIRO' | 'AGARRADO';

// Cada faixa ocupa pelo menos 12% do trilho, para continuar visível com limites extremos (1/365, 20/21).
export const MIN_SEGMENT = 0.12;
// O pino nunca encosta nas pontas do trilho.
export const PIN_MIN_PERCENT = 1.5;
export const PIN_MAX_PERCENT = 98.5;

// Escala: giro rápido (0..fast), em giro (fast..slow) e encalhado (slow..slow + (slow - fast)). Com 7/21 vira 7 : 14 : 14.
function rawSpans(limits: TurnoverLimits): [number, number, number] {
  const fast = Math.max(limits.fastTurnoverDays, 0);
  const middle = Math.max(limits.slowItemDays - limits.fastTurnoverDays, 1);
  return [Math.max(fast, 1), middle, middle];
}

// Frações do trilho (somam 1) com o mínimo de 12% por faixa e as demais renormalizadas.
export function ruleSegments(limits: TurnoverLimits): [number, number, number] {
  const spans = rawSpans(limits);
  const total = spans[0] + spans[1] + spans[2];
  const fractions = spans.map((span) => span / total);
  const pinned = new Set<number>();
  // Poucas passadas bastam: são 3 faixas.
  for (let pass = 0; pass < 3; pass += 1) {
    const free = fractions.map((_, index) => index).filter((index) => !pinned.has(index));
    const room = 1 - MIN_SEGMENT * pinned.size;
    const freeRaw = free.reduce((sum, index) => sum + spans[index], 0);
    let changed = false;
    for (const index of free) {
      const next = (spans[index] / freeRaw) * room;
      fractions[index] = next;
      if (next < MIN_SEGMENT) {
        pinned.add(index);
        changed = true;
      }
    }
    for (const index of pinned) fractions[index] = MIN_SEGMENT;
    if (!changed) break;
  }
  const sum = fractions[0] + fractions[1] + fractions[2];
  return [fractions[0] / sum, fractions[1] / sum, fractions[2] / sum];
}

const BUCKET_INDEX: Record<RuleBucket, 0 | 1 | 2> = { RECENTE: 0, EM_GIRO: 1, AGARRADO: 2 };

// Posição do pino (0 a 100). Interpola dentro da faixa DO BUCKET: se os dias e o bucket discordarem (borda, ou limite trocado com
// cache velho), o pino fica na faixa do bucket, nunca em outra. Limitado a [1,5; 98,5].
export function pinPercent({ days, bucket, limits }: { days: number; bucket: RuleBucket; limits: TurnoverLimits }): number {
  const segments = ruleSegments(limits);
  const spans = rawSpans(limits);
  const index = BUCKET_INDEX[bucket];
  const starts = [0, limits.fastTurnoverDays, limits.slowItemDays];
  const start = starts[index];
  const length = spans[index];
  const position = Number.isFinite(days) ? (days - start) / length : 0;
  const within = Math.min(Math.max(position, 0), 1);
  let before = 0;
  for (let i = 0; i < index; i += 1) before += segments[i];
  const percent = (before + within * segments[index]) * 100;
  return Math.min(Math.max(percent, PIN_MIN_PERCENT), PIN_MAX_PERCENT);
}

// Onde ficam os limites (em % do trilho): fim da primeira faixa e fim da segunda. Para os rótulos da escala.
export function boundaryPercents(limits: TurnoverLimits): [number, number] {
  const [first, second] = ruleSegments(limits);
  return [first * 100, (first + second) * 100];
}

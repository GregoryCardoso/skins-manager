// Data de corte da primeira importação (9.2, D296, D318): sugestão -> valor do <input type="datetime-local"> e validação.
// Funções puras; a conversão usa os helpers de `dateInput` (hora local).
import { isoToLocalInput, localInputToDate, localInputToIso } from './dateInput';

// Sugestão do backend (ISO) -> valor inicial do campo (hora local). Sem sugestão ou inválida: vazio.
export function suggestionToInputValue(suggestedIso: string | null | undefined): string {
  return isoToLocalInput(suggestedIso);
}

export type CutoffValidation =
  | { ok: true; iso: string }
  | { ok: false; reason: 'EMPTY' | 'INVALID' | 'FUTURE' };

// Valor do campo -> ISO com o fuso local. Vazio, inválido ou depois de `now` é recusado.
export function validateCutoffInput(value: string, now: Date = new Date()): CutoffValidation {
  const text = value.trim();
  if (text === '') return { ok: false, reason: 'EMPTY' };
  const date = localInputToDate(text);
  const iso = localInputToIso(text);
  if (!date || iso === null) return { ok: false, reason: 'INVALID' };
  if (date.getTime() > now.getTime()) return { ok: false, reason: 'FUTURE' };
  return { ok: true, iso };
}

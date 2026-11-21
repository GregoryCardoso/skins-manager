// Formulário dos limites de giro (D159). Só monta o PATCH; a validação (faixas e ordem) é do backend.
import type { PreferencesPatch, Settings } from '@/types/api';
import { parseIntegerInput } from './numberInput';

export type AgingField = 'fastTurnoverDays' | 'slowItemDays';

export interface AgingFormState {
  fastText: string;
  slowText: string;
}

export type AgingErrors = Partial<Record<AgingField, string>>;

export type AgingPatchResult =
  | { ok: true; patch: Pick<PreferencesPatch, AgingField> }
  | { ok: false; errors: AgingErrors };

type AgingSettings = Pick<Settings, 'fastTurnoverDays' | 'slowItemDays'>;

// Os campos mostram sempre os valores efetivos (os salvos ou os padrões).
export function agingStateFromSettings(settings: AgingSettings): AgingFormState {
  return { fastText: String(settings.fastTurnoverDays), slowText: String(settings.slowItemDays) };
}

// Só envia o que mudou em relação ao efetivo: digitar o valor que já vale não grava nada (o campo segue "padrão").
export function buildAgingPatch(state: AgingFormState, settings: AgingSettings): AgingPatchResult {
  const errors: AgingErrors = {};
  const patch: Pick<PreferencesPatch, AgingField> = {};
  const entries: [AgingField, string, number][] = [
    ['fastTurnoverDays', state.fastText, settings.fastTurnoverDays],
    ['slowItemDays', state.slowText, settings.slowItemDays],
  ];
  for (const [field, text, current] of entries) {
    const value = parseIntegerInput(text);
    if (value === null) errors[field] = 'settings.aging.invalidNumber';
    else if (value !== current) patch[field] = value;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, patch };
}

export const hasAgingChanges = (patch: Pick<PreferencesPatch, AgingField>): boolean => Object.keys(patch).length > 0;

// Restaurar o padrão de um campo = enviar null só para ele.
export const restoreDefaultPatch = (field: AgingField): Pick<PreferencesPatch, AgingField> => ({ [field]: null });

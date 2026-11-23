// Validação da chave da API digitada (D289, D316): mesma regra do backend (8 a 512 caracteres, sem espaços).
// Funções puras; a chave nunca é guardada fora do estado do campo.
export const API_KEY_MIN_LENGTH = 8;
export const API_KEY_MAX_LENGTH = 512;

// Remove só os espaços das pontas (colar costuma trazer quebra de linha ou espaço no fim).
export function normalizeApiKeyInput(raw: string): string {
  return raw.trim();
}

export type ApiKeyValidation = { ok: true; value: string } | { ok: false; reason: 'EMPTY' | 'FORMAT' };

export function validateApiKeyInput(raw: string): ApiKeyValidation {
  const value = normalizeApiKeyInput(raw);
  if (value === '') return { ok: false, reason: 'EMPTY' };
  if (value.length < API_KEY_MIN_LENGTH || value.length > API_KEY_MAX_LENGTH || /\s/.test(value)) {
    return { ok: false, reason: 'FORMAT' };
  }
  return { ok: true, value };
}

import { describe, expect, test } from 'vitest';
import { suggestionToInputValue, validateCutoffInput } from './importCutoff';

describe('suggestionToInputValue', () => {
  test('sugestão ISO vira o valor do datetime-local na hora local', () => {
    const iso = new Date(2026, 10, 20, 14, 30).toISOString();
    expect(suggestionToInputValue(iso)).toBe('2026-11-20T14:30');
  });
  test('sem sugestão ou inválida: campo vazio', () => {
    expect(suggestionToInputValue(null)).toBe('');
    expect(suggestionToInputValue(undefined)).toBe('');
    expect(suggestionToInputValue('lixo')).toBe('');
  });
});

describe('validateCutoffInput', () => {
  const now = new Date(2026, 10, 22, 12, 0);
  test('data válida e não futura devolve o ISO com o fuso local', () => {
    const result = validateCutoffInput('2026-11-01T00:00', now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.iso).toMatch(/^2026-11-01T00:00:00[+-]\d{2}:\d{2}$/);
      expect(new Date(result.iso).getTime()).toBe(new Date(2026, 10, 1, 0, 0).getTime());
    }
  });
  test('agora (no mesmo minuto) é aceito; um minuto depois é futuro', () => {
    expect(validateCutoffInput('2026-11-22T12:00', now).ok).toBe(true);
    expect(validateCutoffInput('2026-11-22T12:01', now)).toEqual({ ok: false, reason: 'FUTURE' });
  });
  test('vazio e inválido', () => {
    expect(validateCutoffInput('', now)).toEqual({ ok: false, reason: 'EMPTY' });
    expect(validateCutoffInput('   ', now)).toEqual({ ok: false, reason: 'EMPTY' });
    expect(validateCutoffInput('2026-02-30T10:00', now)).toEqual({ ok: false, reason: 'INVALID' });
    expect(validateCutoffInput('ontem', now)).toEqual({ ok: false, reason: 'INVALID' });
  });
});

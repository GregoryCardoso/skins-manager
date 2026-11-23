import { describe, expect, test } from 'vitest';
import { API_KEY_MAX_LENGTH, API_KEY_MIN_LENGTH, normalizeApiKeyInput, validateApiKeyInput } from './apiKeyInput';

describe('apiKeyInput (mesma regra do backend)', () => {
  test('normalize remove só os espaços das pontas', () => {
    expect(normalizeApiKeyInput('  abc def \n')).toBe('abc def');
  });

  test('vazio, só espaços e tamanhos fora de 8 a 512 são recusados', () => {
    expect(validateApiKeyInput('   ')).toEqual({ ok: false, reason: 'EMPTY' });
    expect(validateApiKeyInput('a'.repeat(API_KEY_MIN_LENGTH - 1))).toEqual({ ok: false, reason: 'FORMAT' });
    expect(validateApiKeyInput('a'.repeat(API_KEY_MAX_LENGTH + 1))).toEqual({ ok: false, reason: 'FORMAT' });
  });

  test('espaço interno é recusado; limites 8 e 512 e espaços nas pontas são aceitos', () => {
    expect(validateApiKeyInput('abcd efgh')).toEqual({ ok: false, reason: 'FORMAT' });
    expect(validateApiKeyInput('a'.repeat(8))).toEqual({ ok: true, value: 'a'.repeat(8) });
    expect(validateApiKeyInput(` ${'b'.repeat(512)}\n`)).toEqual({ ok: true, value: 'b'.repeat(512) });
  });
});

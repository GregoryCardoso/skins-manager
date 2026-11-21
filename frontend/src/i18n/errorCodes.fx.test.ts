import { describe, expect, test } from 'vitest';
import { API_ERROR_CODES, WARNING_CODES } from './errorCodes';
import ptBR from './pt-BR.json';
import en from './en.json';

const NEW_CODES = ['FX_FETCH_FAILED', 'FX_RATE_LIMITED', 'FX_INVALID_RESPONSE', 'FX_REFRESH_IN_PROGRESS', 'INVALID_FX_SOURCE'];
const REMOVED = ['PTAX_FETCH_FAILED', 'PTAX_INVALID_RESPONSE', 'PTAX_REFRESH_IN_PROGRESS'];

describe('códigos de cotação (D162/D165)', () => {
  test.each(NEW_CODES)('%s está na lista e traduzido nos dois idiomas', (code) => {
    expect(API_ERROR_CODES as readonly string[]).toContain(code);
    for (const dict of [ptBR, en] as { errors: Record<string, string> }[]) {
      expect(typeof dict.errors[code]).toBe('string');
      expect(dict.errors[code].length).toBeGreaterThan(0);
    }
  });

  test.each(REMOVED)('%s saiu da lista e dos dois dicionários', (code) => {
    expect(API_ERROR_CODES as readonly string[]).not.toContain(code);
    expect((ptBR.errors as Record<string, string>)[code]).toBeUndefined();
    expect((en.errors as Record<string, string>)[code]).toBeUndefined();
  });

  test('BELOW_FEE saiu dos avisos e dos dicionários', () => {
    expect(WARNING_CODES as readonly string[]).not.toContain('BELOW_FEE');
    expect((ptBR.warnings as Record<string, string>).BELOW_FEE).toBeUndefined();
    expect((en.warnings as Record<string, string>).BELOW_FEE).toBeUndefined();
  });

  test('FX_* com {source} usam o mesmo placeholder nos dois idiomas', () => {
    for (const code of ['FX_FETCH_FAILED', 'FX_RATE_LIMITED', 'FX_INVALID_RESPONSE']) {
      const ph = (s: string) => (s.match(/\{(\w+)\}/g) || []).sort().join(',');
      expect(ph((ptBR.errors as Record<string, string>)[code])).toBe(ph((en.errors as Record<string, string>)[code]));
    }
  });
});

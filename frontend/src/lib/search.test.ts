import { describe, expect, test } from 'vitest';
import { matchesSearch, normalizeForSearch } from './search';

describe('normalizeForSearch', () => {
  test('tira caixa e acentos', () => {
    expect(normalizeForSearch('Ação  Ñandú', 'pt-BR')).toBe('acao  nandu');
    expect(normalizeForSearch('ÉCLAIR', 'fr')).toBe('eclair');
  });

  test('turco: İ e ı comparam com i', () => {
    expect(normalizeForSearch('İZMİR', 'tr')).toBe('izmir');
    expect(normalizeForSearch('LIRA', 'tr')).toBe('lira');
    expect(normalizeForSearch('Türk Lirası', 'tr')).toContain('lirasi');
  });

  test('CJK passa sem alteração de significado', () => {
    expect(normalizeForSearch('日本円', 'ja')).toBe('日本円');
    expect(normalizeForSearch('한국 원', 'ko')).toContain('원');
  });

  test('locale inválido não quebra', () => {
    expect(normalizeForSearch('ABC', 'xx-invalid-locale-!!')).toBe('abc');
  });
});

describe('matchesSearch', () => {
  test('"contém" em qualquer campo; vazio casa com tudo', () => {
    expect(matchesSearch('real', ['BRL — Brazilian Real', 'BRL'], 'en')).toBe(true);
    expect(matchesSearch('brl', ['Real brasileiro', 'BRL'], 'pt-BR')).toBe(true);
    expect(matchesSearch('xyz', ['BRL'], 'en')).toBe(false);
    expect(matchesSearch('  ', ['BRL'], 'en')).toBe(true);
  });
});

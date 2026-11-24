import { describe, expect, test } from 'vitest';
import { ApiRequestError } from '@/services/api';
import { API_ERROR_CODES } from './errorCodes';
import { errorMessageFor } from './errorMessage';
import en from './en.json';
import ptBR from './pt-BR.json';
import { translate } from './translate';

const tPt = (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params);
const tEn = (key: string, params?: Record<string, string | number>) => translate(en, key, params);
const err = (code: string, extra: { field?: string; params?: unknown } = {}) => new ApiRequestError(code, 'msg do backend', 400, extra);

const CODES = [
  'COMPONENTS_NOT_ALLOWED', 'COMPONENT_LIMIT_EXCEEDED', 'COMPONENT_CATALOG_REQUIRED', 'COMPONENT_CATALOG_MISMATCH',
  'COMPONENT_SLOT_TAKEN', 'INVALID_COMPONENT_FIELD',
];

describe('erros dos componentes (10.1)', () => {
  test('todos os códigos estão na lista e traduzidos nos dois idiomas', () => {
    for (const code of CODES) {
      expect(API_ERROR_CODES).toContain(code);
      expect(tPt(`errors.${code}`)).not.toBe(`errors.${code}`);
      expect(tEn(`errors.${code}`)).not.toBe(`errors.${code}`);
    }
  });

  test('com params.index a mensagem aponta o componente (base 1); sem index vale o texto geral', () => {
    const slot = err('COMPONENT_SLOT_TAKEN', { field: 'components', params: { index: 1, slot: 0 } });
    expect(errorMessageFor(slot, tPt, 'pt-BR')).toBe('Componente 2: o slot 0 já está ocupado.');
    expect(errorMessageFor(slot, tEn, 'en')).toBe('Component 2: slot 0 is already used.');
    const limit = err('COMPONENT_LIMIT_EXCEEDED', { field: 'components', params: { max: 5 } });
    expect(errorMessageFor(limit, tPt, 'pt-BR')).toMatch(/^Limite de componentes excedido/);
  });
});

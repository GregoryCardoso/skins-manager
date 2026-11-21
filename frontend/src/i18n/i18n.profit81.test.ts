import { describe, expect, test } from 'vitest';
import { API_ERROR_CODES } from './errorCodes';
import { errorDetailParams, errorMessageFor } from './errorMessage';
import en from './en.json';
import ptBR from './pt-BR.json';
import { translate } from './translate';
import { ApiRequestError } from '@/services/api';

function flatten(node: unknown, prefix = ''): string[] {
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => {
    const full = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? [full] : flatten(value, full);
  });
}

const NEW_CODES = ['INVALID_SALE_HOLD_DAYS', 'DEPOSITED_AT_IN_FUTURE', 'DEPOSIT_NOT_FOUND'] as const;

describe('Etapa 8.1: chaves e códigos', () => {
  test('paridade pt-BR/en nos grupos novos (nav.profit, profit.*, deposits.*)', () => {
    const pick = (dict: unknown) => flatten(dict).filter((k) => /^(nav\.profit|profit\.|deposits\.)/.test(k)).sort();
    expect(pick(en)).toEqual(pick(ptBR));
    expect(pick(ptBR).length).toBeGreaterThan(20);
    expect(pick(ptBR)).toContain('nav.profit');
  });

  test('os códigos novos estão em errorCodes e têm texto nos dois idiomas', () => {
    for (const code of NEW_CODES) {
      expect(API_ERROR_CODES as readonly string[]).toContain(code);
      expect(translate(ptBR, `errors.${code}`), code).not.toBe(`errors.${code}`);
      expect(translate(en, `errors.${code}`), code).not.toBe(`errors.${code}`);
    }
  });

  test('INVALID_SALE_HOLD_DAYS interpola min e max a partir de params', () => {
    const error = new ApiRequestError('INVALID_SALE_HOLD_DAYS', 'm', 400, { field: 'saleHoldDays', params: { min: 0, max: 30 } });
    const tPt = (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params);
    const tEn = (key: string, params?: Record<string, string | number>) => translate(en, key, params);
    expect(errorDetailParams(error, tPt, 'pt-BR')).toEqual({ min: 0, max: 30 });
    expect(errorMessageFor(error, tPt, 'pt-BR')).toBe('A retenção deve ser um número inteiro de dias, de 0 a 30.');
    expect(errorMessageFor(error, tEn, 'en')).toBe('The hold must be a whole number of days, from 0 to 30.');
    // sem params: cai no texto genérico do código
    const bare = new ApiRequestError('INVALID_SALE_HOLD_DAYS', 'm', 400);
    expect(errorMessageFor(bare, tPt, 'pt-BR')).toContain('0 a 30');
  });

  test('rótulos de campo usados em erros de aporte existem nos dois idiomas', () => {
    for (const field of ['amountBrlCents', 'depositedAt', 'storeId', 'note', 'saleHoldDays']) {
      expect(translate(ptBR, `fields.${field}`), field).not.toBe(`fields.${field}`);
      expect(translate(en, `fields.${field}`), field).not.toBe(`fields.${field}`);
    }
  });
});

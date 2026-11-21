import { describe, expect, test } from 'vitest';
import { API_ERROR_CODES } from './errorCodes';
import { errorMessageFor } from './errorMessage';
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

const NEW_CODES = ['STORE_REQUIRED', 'WITHDRAWAL_FEE_ABOVE_AMOUNT', 'WITHDRAWN_AT_IN_FUTURE', 'WITHDRAWAL_NOT_ALLOWED', 'WITHDRAWAL_NOT_FOUND'] as const;

describe('Etapa 8.2: chaves e códigos', () => {
  test('paridade pt-BR/en em withdrawals.*', () => {
    const pick = (dict: unknown) => flatten(dict).filter((k) => k.startsWith('withdrawals.')).sort();
    expect(pick(en)).toEqual(pick(ptBR));
    expect(pick(ptBR).length).toBeGreaterThan(40);
  });

  test('paridade geral das chaves pt-BR/en continua', () => {
    expect(flatten(en).sort()).toEqual(flatten(ptBR).sort());
  });

  test('os códigos novos estão em errorCodes e têm texto nos dois idiomas', () => {
    for (const code of NEW_CODES) {
      expect(API_ERROR_CODES as readonly string[]).toContain(code);
      expect(translate(ptBR, `errors.${code}`), code).not.toBe(`errors.${code}`);
      expect(translate(en, `errors.${code}`), code).not.toBe(`errors.${code}`);
    }
  });

  test('mensagem traduzida de um código novo', () => {
    const tPt = (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params);
    const error = new ApiRequestError('WITHDRAWAL_FEE_ABOVE_AMOUNT', 'm', 400, { field: 'feeCents' });
    expect(errorMessageFor(error, tPt, 'pt-BR')).toBe('A taxa paga não pode ser maior que o valor sacado.');
  });

  test('rótulos de campo usados em erros de saque existem nos dois idiomas', () => {
    for (const field of ['storeId', 'amountStoreCents', 'feeCents', 'amountBrlCents', 'withdrawnAt', 'note']) {
      expect(translate(ptBR, `fields.${field}`), field).not.toBe(`fields.${field}`);
      expect(translate(en, `fields.${field}`), field).not.toBe(`fields.${field}`);
    }
  });
});

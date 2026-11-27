import { readFileSync } from 'node:fs';
import path from 'node:path';
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
const pick = (dict: unknown, prefix: string) => flatten(dict).filter((k) => k.startsWith(`${prefix}.`)).sort();
const COMPONENTS = ['StoreBalancesPanel', 'BalanceCheckDialog', 'StoreBalanceRow', 'StoreBalanceHistory', 'SaleReleaseNote', 'StoreFormModal'];

describe('Etapa 8.3: chaves e códigos', () => {
  test('paridade pt-BR/en em storeBalances.* e geral', () => {
    expect(pick(en, 'storeBalances')).toEqual(pick(ptBR, 'storeBalances'));
    expect(pick(ptBR, 'storeBalances').length).toBeGreaterThan(30);
    expect(flatten(en).sort()).toEqual(flatten(ptBR).sort());
  });

  test('chaves da retenção existem nos dois idiomas', () => {
    for (const key of ['sales.balanceReleasesAt', 'storeForm.invalidSaleHoldDays', 'warnings.COMPUTED_BALANCE_NEGATIVE', 'storeBalances.pending']) {
      expect(translate(ptBR, key), key).not.toBe(key);
      expect(translate(en, key), key).not.toBe(key);
    }
  });

  test('placeholders iguais nos dois idiomas em todo storeBalances.*', () => {
    const holders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const key of pick(ptBR, 'storeBalances')) {
      expect(holders(translate(en, key)), key).toEqual(holders(translate(ptBR, key)));
    }
  });

  test('toda chave t(...) usada pelos componentes da 8.3 existe nos dois idiomas', () => {
    const missing: string[] = [];
    for (const name of COMPONENTS) {
      const source = readFileSync(path.join(__dirname, '..', 'components', `${name}.tsx`), 'utf-8');
      for (const match of source.matchAll(/\bt(?:Loose)?\(\s*'([A-Za-z0-9_.]+)'/g)) {
        const key = match[1];
        if (translate(ptBR, key) === key) missing.push(`pt-BR:${key}`);
        if (translate(en, key) === key) missing.push(`en:${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test('códigos RECORDED_AT_IN_FUTURE, STORE_BALANCE_NOT_FOUND e INVALID_SALE_HOLD_DAYS: lista e texto nos dois idiomas', () => {
    for (const code of ['RECORDED_AT_IN_FUTURE', 'STORE_BALANCE_NOT_FOUND', 'INVALID_SALE_HOLD_DAYS']) {
      expect(API_ERROR_CODES as readonly string[]).toContain(code);
      expect(translate(ptBR, `errors.${code}`), code).not.toBe(`errors.${code}`);
      expect(translate(en, `errors.${code}`), code).not.toBe(`errors.${code}`);
    }
  });

  test('INVALID_SALE_HOLD_DAYS interpola min e max', () => {
    const tPt = (key: string, params?: Record<string, string | number>) => translate(ptBR, key, params);
    const error = new ApiRequestError('INVALID_SALE_HOLD_DAYS', 'm', 400, { field: 'saleHoldDays', params: { min: 0, max: 30 } });
    const message = errorMessageFor(error, tPt, 'pt-BR');
    expect(message).toContain('30');
    expect(message).not.toMatch(/\{\w+\}/);
  });
});

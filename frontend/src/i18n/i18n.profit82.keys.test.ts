import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import en from './en.json';
import ptBR from './pt-BR.json';
import { translate } from './translate';

// QA da 8.2: toda chave de tradução usada literalmente nos componentes de saque existe nos dois idiomas,
// e os textos dos dois idiomas usam os mesmos marcadores {param}.
const COMPONENTS = ['WithdrawalFormModal.tsx', 'WithdrawalsSection.tsx', 'WithdrawalsTable.tsx'];
const dir = path.join(__dirname, '..', 'components');

function keysUsedIn(file: string): string[] {
  const source = fs.readFileSync(path.join(dir, file), 'utf8');
  const keys = new Set<string>();
  for (const match of source.matchAll(/\bt(?:Loose)?\(\s*['"`]([A-Za-z0-9_.]+)['"`]/g)) keys.add(match[1]);
  return [...keys];
}

function flatten(node: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[full] = value;
    else Object.assign(out, flatten(value, full));
  }
  return out;
}

describe('chaves usadas pelos componentes de saque', () => {
  test.each(COMPONENTS)('%s: todas as chaves literais existem em pt-BR e en', (file) => {
    const keys = keysUsedIn(file);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(translate(ptBR, key), `pt-BR ${key}`).not.toBe(key);
      expect(translate(en, key), `en ${key}`).not.toBe(key);
    }
  });

  test('mensagens de erro de saque: mesmos marcadores {param} nos dois idiomas e nenhum texto vazio', () => {
    const pt = flatten(ptBR);
    const enFlat = flatten(en);
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(pt).filter((k) => k.startsWith('withdrawals.') || /^errors\.(STORE_REQUIRED|WITHDRAWAL_|WITHDRAWN_)/.test(k))) {
      expect(pt[key].trim().length, key).toBeGreaterThan(0);
      expect(enFlat[key].trim().length, key).toBeGreaterThan(0);
      expect(placeholders(enFlat[key]), key).toEqual(placeholders(pt[key]));
    }
  });

  test('os códigos novos não ficam com o texto genérico de erro desconhecido', () => {
    const generic = translate(ptBR, 'errors.UNKNOWN');
    for (const code of ['STORE_REQUIRED', 'WITHDRAWAL_FEE_ABOVE_AMOUNT', 'WITHDRAWN_AT_IN_FUTURE', 'WITHDRAWAL_NOT_ALLOWED', 'WITHDRAWAL_NOT_FOUND']) {
      expect(translate(ptBR, `errors.${code}`)).not.toBe(generic);
    }
  });
});

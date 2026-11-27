import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import en from './en.json';

// 12.12 (M1): toda chave do en.json precisa ser usada em código de produção (nada de texto morto nos 13 dicionários).
// "Usada" = o texto da chave aparece em algum arquivo .ts/.tsx que não seja teste nem fixture de teste.
// Chaves de plural valem pela chave-base (os campos one/other/... são da própria chave).

const SRC = path.join(__dirname, '..');
const PLURAL_FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

// Chaves montadas dinamicamente no código, então a chave inteira não aparece como texto. Há dois casos:
// 1) prefixo antes de `${...}` (ex.: `errors.${code}`, `enums.category.${value}`): detectado sozinho no código de produção;
//    todas as chaves sob esse prefixo valem como usadas (o código escolhe a parte final em tempo de execução);
// 2) exceções escritas à mão, abaixo, com o motivo.
const DYNAMIC_PREFIXES: Record<string, string> = {
  'operations.detach.SPLIT_': 'ItemOperationsList: t(`operations.detach.SPLIT_${detach.share.basis}`), o sufixo vem do backend',
};

function flatten(node: unknown, prefix: string, out: string[]): void {
  if (node === null || typeof node !== 'object') {
    out.push(prefix);
    return;
  }
  const keys = Object.keys(node as Record<string, unknown>);
  if (prefix && keys.length > 0 && keys.every((key) => PLURAL_FORMS.has(key))) {
    out.push(prefix);
    return;
  }
  for (const key of keys) flatten((node as Record<string, unknown>)[key], prefix ? `${prefix}.${key}` : key, out);
}

function productionSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test') continue;
      out.push(...productionSources(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(readFileSync(full, 'utf8'));
    }
  }
  return out;
}

describe('chaves do en.json usadas em produção (12.12, M1)', () => {
  const keys: string[] = [];
  flatten(en, '', keys);
  const source = productionSources(SRC).join('\n');
  const templatePrefixes = new Set<string>();
  for (const match of source.matchAll(/([a-zA-Z][a-zA-Z0-9.]*\.)\$\{/g)) templatePrefixes.add(match[1]);
  const isDynamic = (key: string) => [...templatePrefixes, ...Object.keys(DYNAMIC_PREFIXES)].some((prefix) => key.startsWith(prefix));

  test('toda chave aparece no código de produção (ou tem prefixo dinâmico justificado)', () => {
    const unused = keys.filter((key) => !source.includes(key) && !isDynamic(key));
    expect(unused).toEqual([]);
  });

  test('cada exceção dinâmica tem justificativa e ainda cobre alguma chave', () => {
    for (const [prefix, why] of Object.entries(DYNAMIC_PREFIXES)) {
      expect(why.length).toBeGreaterThan(10);
      expect(keys.some((key) => key.startsWith(prefix))).toBe(true);
    }
  });
});

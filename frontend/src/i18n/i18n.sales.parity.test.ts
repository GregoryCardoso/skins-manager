import { describe, expect, test } from 'vitest';
import en from './en.json';
import ptBR from './pt-BR.json';

function flatten(node: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === 'string') out[key] = v;
      else Object.assign(out, flatten(v, key));
    }
  }
  return out;
}
const params = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const SCOPES = ['sales', 'salesFilters', 'salesSummary', 'history', 'inventory.actions'];

describe('paridade pt-BR x en (4B.4)', () => {
  const a = flatten(ptBR);
  const b = flatten(en);
  test('mesmas chaves nos dois idiomas (dicionário inteiro)', () => {
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });
  test('mesmos {params} por chave e nenhum valor vazio', () => {
    for (const key of Object.keys(a)) {
      expect(params(a[key]), key).toEqual(params(b[key]));
      expect(a[key].trim(), key).not.toBe('');
      expect(b[key].trim(), key).not.toBe('');
    }
  });
  test('escopos da 4B.4 existem', () => {
    for (const scope of SCOPES) expect(Object.keys(a).some((k) => k.startsWith(`${scope}.`)), scope).toBe(true);
  });
});

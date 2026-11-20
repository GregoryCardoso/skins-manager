import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { API_ERROR_CODES, LOCAL_ERROR_CODES, WARNING_CODES } from './errorCodes';
import en from './en.json';
import ptBR from './pt-BR.json';

function flatten(node: unknown, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[full] = value;
    else Object.assign(out, flatten(value, full));
  }
  return out;
}

const pt = flatten(ptBR);
const enFlat = flatten(en);
const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('dicionários', () => {
  test('mesmas chaves nos dois idiomas', () => {
    expect(Object.keys(enFlat).sort()).toEqual(Object.keys(pt).sort());
  });

  test('nenhum texto vazio', () => {
    for (const dict of [pt, enFlat]) {
      for (const [key, value] of Object.entries(dict)) expect(value.trim(), key).not.toBe('');
    }
  });

  test('mesmos {param} em cada chave', () => {
    for (const key of Object.keys(pt)) expect(params(enFlat[key]), key).toEqual(params(pt[key]));
  });

  test('listas de códigos sem duplicatas e sem chaves órfãs em errors/warnings', () => {
    const all = [...API_ERROR_CODES, ...LOCAL_ERROR_CODES];
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(WARNING_CODES).size).toBe(WARNING_CODES.length);
    const errorKeys = Object.keys(pt).filter((k) => k.startsWith('errors.')).map((k) => k.slice(7));
    expect(errorKeys.filter((k) => !all.includes(k as never))).toEqual([]);
    const warnKeys = Object.keys(pt).filter((k) => k.startsWith('warnings.')).map((k) => k.slice(9));
    expect(warnKeys.filter((k) => !WARNING_CODES.includes(k as never))).toEqual([]);
  });

  test('todo código tem tradução nos dois idiomas', () => {
    for (const dict of [pt, enFlat]) {
      for (const code of [...API_ERROR_CODES, ...LOCAL_ERROR_CODES]) expect(dict[`errors.${code}`], code).toBeTruthy();
      for (const code of WARNING_CODES) expect(dict[`warnings.${code}`], code).toBeTruthy();
    }
  });
});

function listJsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsFiles(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

describe('códigos de erro do backend', () => {
  test('todo código usado em backend/src está em API_ERROR_CODES', () => {
    const backendSrc = path.join(__dirname, '..', '..', '..', 'backend', 'src');
    const known = new Set<string>([...API_ERROR_CODES, ...WARNING_CODES]);
    const found = new Set<string>();
    for (const file of listJsFiles(backendSrc)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const m of text.matchAll(/(?:code\s*[:=]\s*|Error\([^)]*?,\s*)'([A-Z][A-Z0-9_]+)'/g)) found.add(m[1]);
    }
    expect(found.size).toBeGreaterThan(20);
    const missing = [...found].filter((code) => !known.has(code) && !code.startsWith('SQLITE_'));
    expect(missing).toEqual([]);
  });
});

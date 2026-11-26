import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import en from '@/i18n/en.json';

// D370, 12.3a: toda chave literal t('ui.…') / tPlural('ui.…') usada em components/ui/*.tsx existe em en.json
// (a paridade com os outros 12 idiomas já é coberta por i18n.languages.parity.test.ts).

function lookup(key: string): unknown {
  let node: unknown = en;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) node = (node as Record<string, unknown>)[part];
    else return undefined;
  }
  return node;
}

function usedKeys(pattern: RegExp): { key: string; file: string }[] {
  const out: { key: string; file: string }[] = [];
  for (const name of fs.readdirSync(__dirname).filter((n) => n.endsWith('.tsx') && !n.endsWith('.test.tsx'))) {
    const code = fs.readFileSync(path.join(__dirname, name), 'utf8');
    for (const m of code.matchAll(pattern)) out.push({ key: m[1], file: name });
  }
  return out;
}

describe('chaves ui.* usadas em components/ui', () => {
  test('t(\'ui.…\') aponta para um texto de en.json', () => {
    const used = usedKeys(/(?<![\w.$])t\(\s*'(ui\.[\w.]+)'/g);
    expect(used.length).toBeGreaterThan(5);
    expect(used.filter(({ key }) => typeof lookup(key) !== 'string').map(({ key, file }) => `${key} (${file})`)).toEqual([]);
  });

  test('tPlural(\'ui.…\') aponta para um nó de plural com `other`', () => {
    const used = usedKeys(/(?<![\w.$])tPlural\(\s*'(ui\.[\w.]+)'/g);
    expect(used.length).toBeGreaterThan(0);
    const bad = used.filter(({ key }) => {
      const node = lookup(key) as Record<string, unknown> | undefined;
      return !node || typeof node !== 'object' || typeof node.other !== 'string';
    });
    expect(bad.map(({ key, file }) => `${key} (${file})`)).toEqual([]);
  });
});

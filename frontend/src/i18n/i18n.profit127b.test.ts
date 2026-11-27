import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { LANGUAGE_REGISTRY } from './languages';

// QA da 12.7b: as chaves novas do Lucro real e do dinheiro existem nos 13 idiomas, não estão vazias, mantêm os marcadores do
// inglês e os nós de plural têm todas as categorias que o idioma usa.
type Json = { [key: string]: Json | string };
const read = (code: string): Json => JSON.parse(fs.readFileSync(path.join(__dirname, `${code}.json`), 'utf8')) as Json;
const get = (dict: Json, key: string): Json | string | undefined =>
  key.split('.').reduce<Json | string | undefined>((node, part) => (typeof node === 'object' ? node[part] : undefined), dict);

const GROUPS = [
  'profit.equation', 'profit.info', 'profit.tabs.label', 'profit.staleRate', 'profit.rowActions',
  'storeBalances.row', 'storeBalances.checkDialog', 'forms.moreDetailsInformative',
];
const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(',');
const codes = LANGUAGE_REGISTRY.map((entry) => entry.code);

function categories(code: string): string[] {
  const rules = new Intl.PluralRules(code);
  const found = new Set<string>(['other']);
  for (let n = 0; n <= 1000; n += 1) found.add(rules.select(n));
  return [...found];
}

// Folhas de texto de um nó; nós de plural (só com categorias) contam como um item.
function leaves(node: Json | string, prefix: string, out: Array<{ key: string; plural: boolean }> = []) {
  if (typeof node === 'string') {
    out.push({ key: prefix, plural: false });
    return out;
  }
  const keys = Object.keys(node);
  if (keys.length > 0 && keys.every((k) => PLURAL_CATEGORIES.includes(k)) && keys.includes('other')) {
    out.push({ key: prefix, plural: true });
    return out;
  }
  for (const k of keys) leaves(node[k], `${prefix}.${k}`, out);
  return out;
}

const en = read('en');
const ITEMS = GROUPS.flatMap((group) => leaves(get(en, group) as Json | string, group));

describe('chaves novas da 12.7b (Lucro real e dinheiro)', () => {
  test('o inglês tem as 39 chaves dos grupos novos (nenhuma some por engano)', () => {
    expect(ITEMS.length).toBeGreaterThanOrEqual(39);
  });

  test.each(codes)('%s: todas as chaves existem, não vazias, com os marcadores e plurais do idioma', (code) => {
    const dict = read(code);
    for (const { key, plural } of ITEMS) {
      const value = get(dict, key);
      const base = get(en, key);
      if (!plural) {
        expect(typeof value, `${code}:${key}`).toBe('string');
        expect((value as string).trim().length, `${code}:${key} vazio`).toBeGreaterThan(0);
        expect(placeholders(value as string), `${code}:${key} marcadores`).toBe(placeholders(base as string));
      } else {
        expect(typeof value, `${code}:${key} plural`).toBe('object');
        const node = value as Json;
        for (const cat of categories(code)) {
          expect(typeof node[cat], `${code}:${key}.${cat}`).toBe('string');
          expect((node[cat] as string).trim().length).toBeGreaterThan(0);
          expect(placeholders(node[cat] as string), `${code}:${key}.${cat} marcadores`).toBe(placeholders((base as Json).other as string));
        }
      }
    }
  });

  test('as chaves dinâmicas usadas pela tela existem em todos os idiomas (aviso de saldo negativo e cotação nula)', () => {
    for (const code of codes) {
      const dict = read(code);
      for (const key of ['warnings.COMPUTED_BALANCE_NEGATIVE', 'warnings.FX_NOT_CONFIGURED', 'deposits.title', 'withdrawals.title']) {
        expect(get(dict, key), `${code}:${key}`).toBeDefined();
      }
    }
  });
});

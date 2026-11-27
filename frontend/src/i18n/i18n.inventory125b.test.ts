import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { LANGUAGE_REGISTRY } from './languages';

// QA da 12.5b: as chaves novas existem nos 13 idiomas, não estão vazias e mantêm os marcadores {x} do inglês; a chave removida saiu de todos.
type Json = { [key: string]: Json | string };
const read = (code: string): Json => JSON.parse(fs.readFileSync(path.join(__dirname, `${code}.json`), 'utf8')) as Json;
const get = (dict: Json, key: string): Json | string | undefined => key.split('.').reduce<Json | string | undefined>((node, part) => (typeof node === 'object' ? node[part] : undefined), dict);

const KEYS = [
  'inventory.toolbar.search',
  'inventory.position.label', 'inventory.position.forSale', 'inventory.position.offSale', 'inventory.position.tradeLocked', 'inventory.position.nextUnlock',
  'inventory.position.stagnant', 'inventory.position.groups', 'inventory.position.stagnantHint', 'inventory.position.costHelp',
  'inventory.bulk.hint', 'inventory.bulk.limit', 'inventory.bulk.selectGroup',
  'inventory.help.minPriceNoFee', 'inventory.help.minPriceBased', 'inventory.help.minPriceRange',
];
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(',');
const codes = LANGUAGE_REGISTRY.map((entry) => entry.code);

describe('chaves da 12.5b', () => {
  test.each(codes)('%s tem as chaves, não vazias e com os mesmos marcadores do inglês', (code) => {
    const en = read('en');
    const dict = read(code);
    for (const key of KEYS) {
      const value = get(dict, key);
      expect(typeof value, `${code}:${key}`).toBe('string');
      expect((value as string).trim().length, `${code}:${key} vazio`).toBeGreaterThan(0);
      expect(placeholders(value as string), `${code}:${key} marcadores`).toBe(placeholders(get(en, key) as string));
    }
  });

  test.each(codes)('%s: limit leva {max}, groups leva {count}, nextUnlock leva {date}, selectGroup leva {name}', (code) => {
    const dict = read(code);
    expect(get(dict, 'inventory.bulk.limit')).toContain('{max}');
    expect(get(dict, 'inventory.position.groups')).toContain('{count}');
    expect(get(dict, 'inventory.position.nextUnlock')).toContain('{date}');
    expect(get(dict, 'inventory.bulk.selectGroup')).toContain('{name}');
  });

  test.each(codes)('%s: a chave antiga inventory.bulk.selectAll saiu', (code) => {
    expect(get(read(code), 'inventory.bulk.selectAll')).toBeUndefined();
  });
});

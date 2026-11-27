import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { LANGUAGE_REGISTRY } from './languages';

// QA da 12.5a: as 15 chaves novas do inventário existem, não estão vazias e mantêm os mesmos marcadores {x} do inglês nos 13 idiomas.
type Json = { [key: string]: Json | string };
const read = (code: string): Json => JSON.parse(fs.readFileSync(path.join(__dirname, `${code}.json`), 'utf8')) as Json;
const get = (dict: Json, key: string): Json | string | undefined => key.split('.').reduce<Json | string | undefined>((node, part) => (typeof node === 'object' ? node[part] : undefined), dict);

const KEYS = [
  'inventory.density.label', 'inventory.density.compact', 'inventory.density.comfortable',
  'inventory.help.minPrice', 'inventory.help.convertedCost', 'inventory.help.marketValue', 'inventory.help.unrealized',
  'inventory.warnings.goToStores', 'inventory.warnings.goToSettings',
  'inventory.actions.viewUnits', 'inventory.actions.moreFor', 'inventory.actions.noSellableUnit',
  'inventory.columns.turnover', 'inventory.emptyTitle', 'inventory.emptyFilteredTitle',
];
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(',');
const codes = LANGUAGE_REGISTRY.map((entry) => entry.code);

describe('chaves novas da 12.5a', () => {
  test('o registro tem os 13 idiomas', () => expect(codes).toHaveLength(13));

  test.each(codes)('%s tem as 15 chaves, textos não vazios, sem texto igual ao inglês onde não faz sentido e com os mesmos marcadores', (code) => {
    const en = read('en');
    const dict = read(code);
    for (const key of KEYS) {
      const value = get(dict, key);
      expect(typeof value, `${code}:${key}`).toBe('string');
      expect((value as string).trim().length, `${code}:${key} vazio`).toBeGreaterThan(0);
      expect(placeholders(value as string), `${code}:${key} marcadores`).toBe(placeholders(get(en, key) as string));
    }
    // "moreFor" leva o nome do item
    expect(get(dict, 'inventory.actions.moreFor')).toContain('{name}');
  });

  test('os nós de plural usados pelo selo de encalhados têm as categorias do idioma', () => {
    for (const [code, needed] of [['ru', ['one', 'few', 'many', 'other']], ['pl', ['one', 'few', 'many', 'other']], ['pt-BR', ['one', 'other']]] as const) {
      const node = get(read(code), 'inventory.group.stagnant') as Json;
      for (const category of needed) expect(typeof node[category], `${code}.${category}`).toBe('string');
    }
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { LANGUAGE_REGISTRY } from './languages';

// QA da 12.7a: as 7 chaves novas da página Vendas existem nos 13 idiomas, não estão vazias, mantêm os marcadores do inglês e os
// nós de plural têm todas as categorias que o idioma usa (ru/uk/pl: one, few, many, other).
type Json = { [key: string]: Json | string };
const read = (code: string): Json => JSON.parse(fs.readFileSync(path.join(__dirname, `${code}.json`), 'utf8')) as Json;
const get = (dict: Json, key: string): Json | string | undefined =>
  key.split('.').reduce<Json | string | undefined>((node, part) => (typeof node === 'object' ? node[part] : undefined), dict);

const TEXT_KEYS = ['ui.turnover.legend.fromSale', 'sales.turnover.header', 'sales.expandedFx', 'sales.emptyTitle', 'sales.emptyFilteredTitle'];
const PLURAL_KEYS = ['ui.turnover.daysAfterRelease', 'ui.turnover.legend.slowSale'];
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(',');
const codes = LANGUAGE_REGISTRY.map((entry) => entry.code);

// Categorias de plural cardinal que os inteiros de 0 a 1000 podem produzir no idioma.
function categories(code: string): string[] {
  const rules = new Intl.PluralRules(code);
  const found = new Set<string>(['other']);
  for (let n = 0; n <= 1000; n += 1) found.add(rules.select(n));
  return [...found];
}

describe('chaves novas da 12.7a (Vendas)', () => {
  test('o registro tem os 13 idiomas', () => expect(codes).toHaveLength(13));

  test.each(codes)('%s: textos simples presentes, não vazios e com os marcadores do inglês', (code) => {
    const en = read('en');
    const dict = read(code);
    for (const key of TEXT_KEYS) {
      const value = get(dict, key);
      expect(typeof value, `${code}:${key}`).toBe('string');
      expect((value as string).trim().length, `${code}:${key} vazio`).toBeGreaterThan(0);
      expect(placeholders(value as string), `${code}:${key} marcadores`).toBe(placeholders(get(en, key) as string));
    }
    expect(get(dict, 'sales.expandedFx')).toContain('{sale}');
    expect(get(dict, 'sales.expandedFx')).toContain('{purchase}');
  });

  test.each(codes)('%s: nós de plural têm as categorias do idioma, todas com {count}', (code) => {
    const dict = read(code);
    for (const key of PLURAL_KEYS) {
      const node = get(dict, key);
      expect(typeof node, `${code}:${key} deve ser objeto de plural`).toBe('object');
      for (const category of categories(code)) {
        const text = (node as Json)[category];
        expect(typeof text, `${code}:${key}.${category}`).toBe('string');
        expect((text as string).trim().length).toBeGreaterThan(0);
        expect(text, `${code}:${key}.${category} sem {count}`).toContain('{count}');
      }
    }
  });

  test('ru, uk e pl têm one, few, many e other nos dois nós; pt-BR tem one e other', () => {
    for (const code of ['ru', 'uk', 'pl']) {
      for (const key of PLURAL_KEYS) {
        for (const category of ['one', 'few', 'many', 'other']) expect(typeof (get(read(code), key) as Json)[category], `${code}:${key}.${category}`).toBe('string');
      }
    }
    for (const key of PLURAL_KEYS) {
      for (const category of ['one', 'other']) expect(typeof (get(read('pt-BR'), key) as Json)[category]).toBe('string');
    }
  });

  test.each(codes.filter((code) => code !== 'en'))('%s: os textos novos não são cópia literal do inglês (traduzidos)', (code) => {
    const en = read('en');
    const dict = read(code);
    // pt-BR, es, fr, it e de compartilham poucas palavras; "Trade lock" pode ficar em inglês, mas a frase inteira não.
    for (const key of ['sales.turnover.header', 'sales.emptyTitle', 'sales.emptyFilteredTitle', 'ui.turnover.legend.fromSale']) {
      expect(get(dict, key), `${code}:${key}`).not.toBe(get(en, key));
    }
  });
});

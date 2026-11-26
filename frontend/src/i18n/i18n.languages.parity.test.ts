import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { API_ERROR_CODES, LOCAL_ERROR_CODES, WARNING_CODES } from './errorCodes';
import { LANGUAGE_REGISTRY, BASE_LANGUAGE } from './languages';

// Teste genérico de idiomas (D369, 11.1): roda sobre o REGISTRO, então um idioma só é testado (e só aparece no seletor) quando o
// arquivo dele está completo. Camada (a): paridade com o inglês (base). Camada (b): código <-> dicionário.

const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];
type Json = { [key: string]: Json | string };

function readDictionary(code: string): Json {
  return JSON.parse(fs.readFileSync(path.join(__dirname, `${code}.json`), 'utf8')) as Json;
}

// Nó de plural: objeto com `other` e só categorias do CLDR.
function isPluralNode(node: Json | string): node is Json {
  if (typeof node === 'string') return false;
  const keys = Object.keys(node);
  return keys.includes('other') && keys.every((key) => PLURAL_CATEGORIES.includes(key)) && keys.every((key) => typeof node[key] === 'string');
}

interface Flat {
  // Textos simples por chave.
  texts: Record<string, string>;
  // Nós de plural por chave: categoria -> texto.
  plurals: Record<string, Record<string, string>>;
}

function flatten(node: Json, prefix = '', out: Flat = { texts: {}, plurals: {} }): Flat {
  for (const [key, value] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.texts[full] = value;
    else if (isPluralNode(value)) out.plurals[full] = value as Record<string, string>;
    else flatten(value, full, out);
  }
  return out;
}

const markers = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();

// Categorias que um número inteiro realmente produz no idioma (russo: one/few/many; francês: one; chinês: nenhuma além de other).
// A forma `many` do francês, do italiano e do espanhol só vale para milhões ("1 milhão de itens"), e cai em `other` por reserva.
function requiredPluralCategories(locale: string): string[] {
  const rules = new Intl.PluralRules(locale);
  const found = new Set<string>(['other']);
  for (let n = 0; n <= 1200; n += 1) found.add(rules.select(n));
  return [...found].sort();
}

const base = flatten(readDictionary(BASE_LANGUAGE));

// Camada (a), texto sem traduzir: fora do inglês, nenhum texto pode ser idêntico ao inglês, salvo as exceções abaixo (comparadas
// pelo TEXTO inglês, não pela chave). Textos sem letras (depois de tirar os {marcadores}), como "—", "≈ {value}" e "{role}: {name}",
// são isentos automaticamente. Ao acrescentar um idioma, rode `npm run i18n:report` e só liste aqui o que é legítimo mesmo.
// Exceções de qualquer idioma: marca, produto, siglas do jogo/da cotação e fórmula com moeda.
const IDENTICAL_EVERYWHERE = new Set([
  'Skins Manager', 'CSFloat', 'StatTrak™', 'PTAX',
  'FN', 'MW', 'FT', 'WW', 'BS', // siglas dos desgastes (Factory New... Battle-Scarred), usadas assim em todo o jogo
  'US$ 1 = {rate}',
]);
// Exceções por idioma: cognatos e termos do jogo que o idioma mantém em inglês.
const IDENTICAL_BY_LANGUAGE: Record<string, readonly string[]> = {
  'pt-BR': [
    'Item', 'Item: {value}', '{count} item', 'Skin', 'Skins', 'Patch', 'Patches', 'Normal', 'Souvenir', 'Manual', 'Individual',
    'Backup', 'Trade lock', 'Float', 'Paint seed', 'Asset ID', 'Sticker', 'Stickers', 'Pattern', 'pattern', 'pattern {n}', 'Sticker Slab',
    'Holding', 'Holding ({count})', '{count} min', '{count} h', '{count} d', 'd', 'h', 'min',
  ],
  es: [
    'Asia', // 12.3a: nome da região igual ao inglês
    '{count} min', '{count} h', '{count} d', 'Skins', 'Stickers', 'Individual', 'Trade lock', 'Holding ({count})', 'd', 'h', 'min', 'Skin',
    'Sticker', 'Normal', 'Souvenir', 'Holding', 'Manual', 'Float', 'Paint seed', 'Asset ID', 'Sticker Slab', 'Pattern', 'pattern',
    'pattern {n}', 'No', 'Stock: {message}',
  ],
  fr: [
    'Europe', // 12.3a: nome da região igual ao inglês
    '{count} min', '{count} h', 'Skins', 'Stickers', 'Agents', 'Image', 'Trade lock', 'Actions', 'Holding ({count})', 'h', 'min', 'Skin',
    'Capsule', 'Sticker', 'Agent', 'Normal', 'Souvenir', 'Holding', 'Commercial', 'Commercial (AwesomeAPI)', 'Float', 'Paint seed', 'Phase',
    'Asset ID', 'inactive', 'Position', 'Type', 'Sticker Slab', 'Pattern', 'position', 'pattern', 'pattern {n}', 'Active', 'Note',
    'Inactive', 'minimum {value}', 'portable', 'Date', '{name} (inactive)', 'Net', '{count} transaction', '{count} transactions',
  ],
  it: [
    'Asia', // 12.3a: nome da região igual ao inglês
    '{count} min', '{count} h', '{items} in {groups}', '{count} in holding', 'Trade lock', 'In trade lock · {time}', 'Holding ({count})',
    'h', 'min', 'Skin', 'Sticker', 'Patch', 'Souvenir', 'In trade lock', 'Holding', 'Float', 'Paint seed', 'Asset ID', 'Sticker Slab',
    'Pattern', 'pattern', 'pattern {n}', 'in trade lock', 'No', 'Backup', 'in holding',
  ],
  de: [
    '(optional)', 'Skins', 'Patches', '{items} in {groups}', 'Status', 'Item', 'Trade lock', 'Holding ({count})', 'Item: {value}', 'Skin',
    'Sticker', 'Agent', 'Patch', 'Normal', 'Souvenir', 'Holding', 'Name', 'Float', 'Phase', 'Position', 'Sticker Slab', 'Pattern', 'Backup',
    'Details',
  ],
  ru: [
    'Skins', 'Skin', 'Stickers', 'Sticker', 'Sticker Slab', 'Souvenir', 'Trade lock', 'Holding', 'Holding ({count})', 'Float', 'Paint seed',
    'Asset ID', 'Pattern', 'pattern', 'pattern {n}', 'GitHub Issues',
  ],
  uk: [
    'Trade lock', 'Holding', 'Holding ({count})', 'Sticker', 'Stickers', 'Sticker Slab', 'Souvenir', 'Float', 'Paint seed', 'Asset ID',
    'Pattern', 'pattern', 'pattern {n}',
  ],
  pl: [
    'Skin', 'Sticker', 'Souvenir', 'Agent', 'Status', 'Trade lock', 'Holding', 'Holding ({count})', 'Float', 'Paint seed', 'Asset ID',
    'Sticker Slab', 'Pattern', 'pattern', 'pattern {n}', 'min', '{count} min', 'GitHub Issues',
  ],
  tr: [
    'Trade lock', 'Holding', 'Holding ({count})', 'Float', 'Paint seed', 'Pattern', 'pattern', 'pattern {n}', 'Asset ID', 'Sticker Slab',
    'Sticker', 'Souvenir', 'Skin', 'Normal', 'Net', 'CSFloat', 'GitHub Issues',
  ],
  'zh-CN': [
    'Trade lock', 'Sticker', 'Sticker Slab', 'Souvenir', 'Holding', 'Float', 'Paint seed', 'Phase', 'Asset ID', 'Pattern', 'pattern',
    'pattern {n}', 'GitHub Issues',
  ],
  ja: [
    'Trade lock', 'Holding', 'Sticker', 'Sticker Slab', 'Souvenir', 'Float', 'Paint seed', 'Pattern', 'pattern', 'pattern {n}', 'Asset ID',
    'GitHub Issues',
  ],
  ko: [
    'Trade lock', 'Holding', 'Holding ({count})', 'Sticker', 'Sticker Slab', 'Souvenir', 'Float', 'Paint seed', 'Asset ID', 'Pattern',
    'pattern', 'pattern {n}', 'GitHub Issues',
  ],
};

const hasLetters = (text: string) => /\p{L}/u.test(text.replace(/\{\w+\}/g, ''));

function untranslated(code: string, dictionary: Flat): string[] {
  const allowed = new Set([...IDENTICAL_EVERYWHERE, ...(IDENTICAL_BY_LANGUAGE[code] ?? [])]);
  const same = (own: string, reference: string) => own === reference && hasLetters(own) && !allowed.has(own);
  const found: string[] = [];
  for (const [key, text] of Object.entries(dictionary.texts)) if (same(text, base.texts[key])) found.push(`${key}: ${text}`);
  for (const [key, forms] of Object.entries(dictionary.plurals)) {
    for (const [category, text] of Object.entries(forms)) if (same(text, base.plurals[key]?.[category])) found.push(`${key}.${category}: ${text}`);
  }
  return found;
}

describe('o inglês é o idioma base', () => {
  test('tem textos e nenhum vazio', () => {
    expect(Object.keys(base.texts).length).toBeGreaterThan(1000);
    for (const [key, text] of Object.entries(base.texts)) expect([key, text.trim() === '']).toEqual([key, false]);
    for (const [key, forms] of Object.entries(base.plurals)) {
      for (const [category, text] of Object.entries(forms)) expect([`${key}.${category}`, text.trim() === '']).toEqual([`${key}.${category}`, false]);
    }
  });
});

describe.each(LANGUAGE_REGISTRY.map((entry) => [entry.code, entry.intlLocale]))('idioma %s', (code, locale) => {
  const dictionary = flatten(readDictionary(code));

  test('tem exatamente as mesmas chaves do inglês', () => {
    expect(Object.keys(dictionary.texts).sort()).toEqual(Object.keys(base.texts).sort());
    expect(Object.keys(dictionary.plurals).sort()).toEqual(Object.keys(base.plurals).sort());
  });

  test('plural: se o inglês tem a categoria `zero` numa chave, todos os idiomas têm (S1, 11.11)', () => {
    for (const [key, forms] of Object.entries(base.plurals)) {
      if (!('zero' in forms)) continue;
      expect([key, 'zero' in (dictionary.plurals[key] ?? {})]).toEqual([key, true]);
    }
  });

  test('mesmos marcadores {x} em cada chave', () => {
    for (const [key, text] of Object.entries(dictionary.texts)) expect([key, markers(text)]).toEqual([key, markers(base.texts[key])]);
  });

  test('nenhum texto vazio', () => {
    for (const [key, text] of Object.entries(dictionary.texts)) expect([key, text.trim() === '']).toEqual([key, false]);
    for (const [key, forms] of Object.entries(dictionary.plurals)) {
      for (const [category, text] of Object.entries(forms)) expect([`${key}.${category}`, text.trim() === '']).toEqual([`${key}.${category}`, false]);
    }
  });

  test('plural: tem as categorias do idioma (Intl.PluralRules), e o `other` com os mesmos marcadores do inglês', () => {
    const required = requiredPluralCategories(locale);
    for (const [key, forms] of Object.entries(dictionary.plurals)) {
      const missing = required.filter((category) => !(category in forms));
      expect([key, missing]).toEqual([key, []]);
      expect([key, markers(forms.other)]).toEqual([key, markers(base.plurals[key].other)]);
      const allowed = new Set(Object.values(base.plurals[key]).flatMap(markers));
      for (const text of Object.values(forms)) expect(markers(text).filter((marker) => !allowed.has(marker))).toEqual([]);
    }
  });

  test('nenhum texto idêntico ao inglês, fora da lista de exceções (texto sem traduzir)', () => {
    // O inglês é a própria base: não se compara com ele mesmo.
    expect(code === BASE_LANGUAGE ? [] : untranslated(code, dictionary)).toEqual([]);
  });

  test('toda exceção por idioma ainda é usada (lista sem sobras)', () => {
    const identical = new Set<string>();
    for (const [key, text] of Object.entries(dictionary.texts)) if (text === base.texts[key]) identical.add(text);
    for (const [key, forms] of Object.entries(dictionary.plurals)) {
      for (const [category, text] of Object.entries(forms)) if (text === base.plurals[key]?.[category]) identical.add(text);
    }
    expect((IDENTICAL_BY_LANGUAGE[code] ?? []).filter((text) => !identical.has(text))).toEqual([]);
  });

  test('todo código de erro e de aviso da API tem texto', () => {
    const missing = [
      ...[...API_ERROR_CODES, ...LOCAL_ERROR_CODES].filter((c) => !dictionary.texts[`errors.${c}`]).map((c) => `errors.${c}`),
      ...WARNING_CODES.filter((c) => !dictionary.texts[`warnings.${c}`]).map((c) => `warnings.${c}`),
    ];
    expect(missing).toEqual([]);
  });
});

describe('plural: categorias exigidas por idioma (as 13 línguas previstas, D369)', () => {
  test.each([
    ['en', ['one', 'other']],
    ['pt-BR', ['one', 'other']],
    ['es', ['one', 'other']],
    ['fr', ['one', 'other']],
    ['it', ['one', 'other']],
    ['de', ['one', 'other']],
    ['tr', ['one', 'other']],
    ['ru', ['few', 'many', 'one', 'other']],
    ['uk', ['few', 'many', 'one', 'other']],
    ['pl', ['few', 'many', 'one', 'other']],
    ['zh-CN', ['other']],
    ['ja', ['other']],
    ['ko', ['other']],
  ])('%s', (locale, expected) => {
    expect(requiredPluralCategories(locale)).toEqual(expected);
  });
});

function listFiles(dir: string, accept: (name: string) => boolean): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listFiles(full, accept);
    return accept(entry.name) ? [full] : [];
  });
}

describe('código <-> dicionário (camada b)', () => {
  const srcDir = path.join(__dirname, '..');
  const sources = listFiles(srcDir, (name) => /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name));

  test('toda chave usada no código com texto literal existe no inglês', () => {
    const used = new Map<string, string>();
    // t('a.b'), tLoose('a.b') e t(`a.b`) sem interpolação; o `(?<![\w.$])` evita `format(`, `.t(` e afins.
    const callPattern = /(?<![\w.$])(?:t|tLoose)\(\s*(?:'([A-Za-z][\w.]*)'|`([A-Za-z][\w.]*)`)/g;
    const pluralPattern = /(?<![\w.$])tPlural\(\s*(?:'([A-Za-z][\w.]*)'|`([A-Za-z][\w.]*)`)/g;
    for (const file of sources) {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(callPattern)) used.set(match[1] ?? match[2], path.relative(srcDir, file));
    }
    const pluralUsed = new Map<string, string>();
    for (const file of sources) {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(pluralPattern)) pluralUsed.set(match[1] ?? match[2], path.relative(srcDir, file));
    }
    expect(used.size).toBeGreaterThan(200);
    const missingTexts = [...used].filter(([key]) => !(key in base.texts)).map(([key, file]) => `${key} (${file})`);
    expect(missingTexts).toEqual([]);
    const missingPlurals = [...pluralUsed].filter(([key]) => !(key in base.plurals)).map(([key, file]) => `${key} (${file})`);
    expect(missingPlurals).toEqual([]);
  });

  test('todo código de erro lançado no backend tem texto em todos os idiomas', () => {
    const backendSrc = path.join(__dirname, '..', '..', '..', 'backend', 'src');
    const found = new Set<string>();
    for (const file of listFiles(backendSrc, (name) => name.endsWith('.js'))) {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(/(?:code\s*[:=]\s*|Error\([^)]*?,\s*)'([A-Z][A-Z0-9_]+)'/g)) found.add(match[1]);
    }
    expect(found.size).toBeGreaterThan(20);
    for (const entry of LANGUAGE_REGISTRY) {
      const dictionary = flatten(readDictionary(entry.code));
      const missing = [...found].filter(
        (code) => !code.startsWith('SQLITE_') && !dictionary.texts[`errors.${code}`] && !dictionary.texts[`warnings.${code}`],
      );
      expect([entry.code, missing]).toEqual([entry.code, []]);
    }
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { LANGUAGE_REGISTRY } from './languages';

// 12.9 (QA): as chaves novas das Importações e do card do CSFloat existem nos 13 idiomas, com os mesmos marcadores do inglês e,
// nos plurais, todas as categorias que o idioma usa.
type Json = { [key: string]: Json | string };
const read = (code: string): Json => JSON.parse(fs.readFileSync(path.join(__dirname, `${code}.json`), 'utf8')) as Json;
const get = (root: Json, key: string): Json | string | undefined => key.split('.').reduce<Json | string | undefined>((node, part) => (typeof node === 'object' ? node[part] : undefined), root);
const markers = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

const EXPLAIN = ['REMOVE', 'KEEP', 'CREATE', 'LINK', 'IGNORE', 'CREATE_PURCHASE', 'MARK_WON', 'APPLY_FROM_STOCK', 'REOPEN'];
const TEXT_KEYS = [
  ...EXPLAIN.map((a) => `imports.actions.explain.${a}`),
  'imports.steps.title', 'imports.steps.bought', 'imports.steps.won', 'imports.steps.skip', 'imports.bulk.tip',
  'imports.tabs.label', 'imports.tabs.review', 'imports.tabs.ignored', 'imports.tabs.history',
  'imports.status.lastImport', 'imports.status.cutoff', 'imports.status.noCutoff', 'imports.status.autoOn', 'imports.status.autoOff', 'imports.status.autoPaused',
  'imports.moreOptions', 'imports.timeline.label', 'imports.timeline.before', 'imports.timeline.after', 'imports.timeline.current', 'imports.timeline.new',
  'imports.timeline.earlier', 'imports.timeline.later', 'imports.cutoffChange.howItWorks', 'imports.fullScanConfirm.timeNote', 'imports.ignoredToast', 'imports.ignoredUndo',
  ...[1, 2, 3, 4, 5].map((n) => `csfloatSetup.illustrationAlt.step${n}`),
  'settings.integrations.csfloat.keyTooShort', 'settings.integrations.csfloat.keyTooLong', 'settings.integrations.csfloat.keyHasSpaces',
];
const PLURAL_KEYS = ['imports.timeline.moves', 'settings.integrations.csfloat.keyValid'];

const en = read('en');
const required = (locale: string) => {
  const rules = new Intl.PluralRules(locale);
  const found = new Set<string>(['other']);
  for (let n = 0; n <= 1200; n += 1) found.add(rules.select(n));
  return [...found];
};

describe.each(LANGUAGE_REGISTRY.map((l) => [l.code, l.intlLocale] as const))('chaves da 12.9 em %s', (code, intl) => {
  const dict = read(code);

  test.each(TEXT_KEYS)('%s: texto não vazio, mesmos marcadores do inglês', (key) => {
    const own = get(dict, key);
    const base = get(en, key) as string;
    expect(typeof base).toBe('string');
    expect(typeof own).toBe('string');
    expect((own as string).trim()).not.toBe('');
    expect(markers(own as string)).toEqual(markers(base));
  });

  test.each(PLURAL_KEYS)('%s: plural com {count} em todas as categorias do idioma', (key) => {
    const own = get(dict, key) as Json;
    expect(typeof own).toBe('object');
    for (const category of required(intl)) {
      expect(typeof own[category], `${key}.${category}`).toBe('string');
      expect(markers(own[category] as string)).toContain('count');
    }
  });
});

test('o inglês traz as chaves (guarda contra renomear sem atualizar o teste)', () => {
  for (const key of TEXT_KEYS) expect(typeof get(en, key)).toBe('string');
  for (const key of PLURAL_KEYS) expect(typeof (get(en, key) as Json).other).toBe('string');
});

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { LANGUAGE_REGISTRY } from './languages';

// QA da 12.8: as chaves novas de Lojas e Configurações existem, não estão vazias e mantêm os marcadores {x} do inglês nos 13 idiomas;
// os nós de plural trazem as categorias do idioma.
type Json = { [key: string]: Json | string };
const read = (code: string): Json => JSON.parse(fs.readFileSync(path.join(__dirname, `${code}.json`), 'utf8')) as Json;
const get = (dict: Json, key: string): Json | string | undefined =>
  key.split('.').reduce<Json | string | undefined>((node, part) => (typeof node === 'object' ? node[part] : undefined), dict);
const placeholders = (text: string) => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort().join(',');
const codes = LANGUAGE_REGISTRY.map((entry) => entry.code);

const TEXT_KEYS = [
  'currency.modal.confirm', 'currency.modal.rateLabel', 'currency.modal.rateOptional', 'currency.modal.fetchFailed',
  'stores.steamCleared', 'stores.card.saleFeeSentence.DEDUCTED', 'stores.card.saleFeeSentence.ADDED', 'stores.card.moreActionsFor',
  'stores.steamTip.title', 'stores.steamTip.body', 'stores.steamTip.action',
  'storeForm.invalidSaleHoldDays', 'storeForm.sections.identity', 'storeForm.sections.status',
  'storeForm.example.title', 'storeForm.example.deducted', 'storeForm.example.added', 'storeForm.example.priceLabel',
  'storeForm.example.notConfigured', 'storeForm.example.incomplete', 'storeForm.example.error',
  'settings.fx.autoFailedWithRate', 'settings.fx.boundsHint', 'settings.fx.outOfBounds', 'settings.aging.scaleTitle', 'settings.aging.scaleInvalid',
  'settings.backup.retention', 'settings.backup.preview.reading', 'settings.backup.preview.fileLine',
  'settings.backup.preview.lastChange', 'settings.backup.preview.lastChangeUnknown', 'settings.backup.preview.schema',
  'settings.backup.preview.willMigrate', 'settings.backup.preview.pickAnother',
  'settings.loadError', 'settings.index.label',
  'settings.status.fxMissing', 'settings.status.aging', 'settings.status.csfloatConnected', 'settings.status.csfloatNoKey',
  'settings.status.backupFolder', 'settings.status.catalog',
];
const PLURAL_KEYS = [
  'settings.backup.preview.counts.items', 'settings.backup.preview.counts.sales', 'settings.backup.preview.counts.stores',
  'settings.backup.preview.counts.deposits', 'settings.backup.preview.counts.withdrawals',
  'settings.status.fxCount', 'settings.status.fxStale', 'settings.status.csfloatReview',
];

describe('chaves novas da 12.8', () => {
  test('o inglês (base) tem todas as chaves da lista', () => {
    const en = read('en');
    for (const key of TEXT_KEYS) expect(typeof get(en, key), key).toBe('string');
    for (const key of PLURAL_KEYS) expect(typeof (get(en, key) as Json).other, key).toBe('string');
  });

  test.each(codes)('%s: textos presentes, não vazios e com os mesmos marcadores do inglês', (code) => {
    const en = read('en');
    const dict = read(code);
    for (const key of TEXT_KEYS) {
      const value = get(dict, key);
      expect(typeof value, `${code}:${key}`).toBe('string');
      expect((value as string).trim().length, `${code}:${key} vazio`).toBeGreaterThan(0);
      expect(placeholders(value as string), `${code}:${key} marcadores`).toBe(placeholders(get(en, key) as string));
    }
  });

  test.each(codes)('%s: nós de plural com as categorias do idioma e marcador {count}', (code) => {
    const dict = read(code);
    const rules = new Intl.PluralRules(code);
    const needed = new Set<string>(['other']);
    for (let n = 0; n <= 1200; n += 1) needed.add(rules.select(n));
    for (const key of PLURAL_KEYS) {
      const node = get(dict, key) as Json;
      expect(typeof node, `${code}:${key}`).toBe('object');
      for (const category of needed) {
        // `many` de fr/it/es só vale para milhões e cai em `other`.
        if (category === 'many' && ['fr', 'it', 'es'].includes(code)) continue;
        expect(typeof node[category], `${code}:${key}.${category}`).toBe('string');
      }
    }
  });

  test.each(codes)('%s: as frases do exemplo da taxa levam preço, taxa e líquido', (code) => {
    const dict = read(code);
    for (const key of ['storeForm.example.deducted', 'storeForm.example.added']) {
      const text = get(dict, key) as string;
      for (const marker of ['{price}', '{fee}', '{net}']) expect(text, `${code}:${key}`).toContain(marker);
    }
  });
});
